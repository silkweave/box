// DuckDB access layer - the warehouse is now the **ground truth** (not a rebuildable cache).
// Writes UPSERT straight into the tenant instance dir's warehouse (data/data.db); no JSON source.
//
// Concurrency (DuckDB is single-writer across processes - one read-write OR many read-only):
//   • reads  → ephemeral access_mode:'read_only', so the read-only `warehouse` MCP server and the
//     `duckdb` CLI keep working in between our writes (we never hold a long-lived lock).
//   • writes → ephemeral access_mode:'read_write', exclusive in-process (no read or other write
//     overlaps it, see ReadWriteGate) and retried-with-backoff on a file-lock conflict from another
//     process.
// Everything funnels through the one server process, so in-process serialization + cross-process
// retry is enough; ops are tiny (one UPSERT + a re-derive).

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DuckDBInstance, type DuckDBConnection, type DuckDBValue } from '@duckdb/node-api'
import { markWarehouseWrite } from '../changes.js'
import { warehousePath } from '../io.js'
import { ensureBoxConfig } from '../box-config.js'

function dbPath(): string {
  ensureBoxConfig()
  const file = warehousePath()
  mkdirSync(dirname(file), { recursive: true })
  return file
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** DuckDB throws an IO error when another process holds the file lock; detect it to retry. */
function isLockError(err: unknown): boolean {
  const m = String((err as Error)?.message ?? err).toLowerCase()
  return m.includes('lock') || m.includes('conflicting') || m.includes('being used by another')
}

/** Open an ephemeral connection in `mode`, run `fn`, always close. Retries on a lock conflict. */
async function open<T>(mode: 'read_only' | 'read_write', fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
  const attempts = 12
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    let instance: DuckDBInstance | undefined
    let conn: DuckDBConnection | undefined
    try {
      instance = await DuckDBInstance.create(dbPath(), { access_mode: mode })
      conn = await instance.connect()
      // Naive TIMESTAMP columns follow the convention "naive == UTC" (warehouse/model.ts), but
      // DuckDB casts now() to the SESSION timezone - on a host in UTC+8 that is how local
      // wall times leaked into the warehouse for months (migration 003 shifted them back). Pinning
      // the session keeps every remaining SQL now()/current_date UTC-correct, for reads too.
      await conn.run(`SET TimeZone = 'UTC'`)
      return await fn(conn)
    } catch (err) {
      lastErr = err
      if (!isLockError(err)) throw err
      await sleep(Math.min(50 * 2 ** i, 1500)) // exponential backoff, capped
    } finally {
      conn?.disconnectSync()
      instance?.closeSync()
    }
  }
  throw lastErr
}

/**
 * In-process access control: many readers OR one writer, first come first served.
 *
 * DuckDB's file lock is per PROCESS, so it keeps other processes out but does nothing between two
 * instances this process opens. A read-only instance opened while a read-write one is extending or
 * checkpointing the file can see a half-written file and fail with "IO Error: Could not read enough
 * bytes". A large import (thousands of alternating reads and writes, while a dashboard polled and
 * every authenticated request stamped a token) hit it and aborted mid-run. Writes were already
 * serialized against each other; this also keeps reads out of a write's way.
 *
 * FIFO: a waiting writer holds back readers that arrive after it, so a steady stream of reads
 * cannot starve writes. Nothing calls withRead or withWrite from inside a withWrite callback (that
 * would deadlock here, as a nested withWrite always did).
 */
class ReadWriteGate {
  private readers = 0
  private writing = false
  private readonly queue: { write: boolean; grant: () => void }[] = []

  async run<T>(write: boolean, fn: () => Promise<T>): Promise<T> {
    await this.acquire(write)
    try {
      return await fn()
    } finally {
      if (write) this.writing = false
      else this.readers -= 1
      this.drain()
    }
  }

  private acquire(write: boolean): Promise<void> {
    if (this.queue.length === 0 && !this.writing && (!write || this.readers === 0)) {
      if (write) this.writing = true
      else this.readers += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => this.queue.push({ write, grant: resolve }))
  }

  private drain(): void {
    while (this.queue.length > 0 && !this.writing) {
      const next = this.queue[0]
      if (next.write) {
        if (this.readers > 0) return
        this.queue.shift()
        this.writing = true
        next.grant()
        return
      }
      this.queue.shift()
      this.readers += 1
      next.grant()
    }
  }
}

const gate = new ReadWriteGate()

/** Run a read-only query and return JSON-safe row objects (no bigint/Date). */
export async function withRead<T = Record<string, unknown>>(sql: string, values?: DuckDBValue[]): Promise<T[]> {
  return gate.run(false, () =>
    open('read_only', async (conn) => {
      const reader = await conn.runAndReadAll(sql, values)
      return reader.getRowObjectsJson() as T[]
    }),
  )
}

/** Run `fn` against a read-write connection, exclusive in-process and retried on cross-process locks. */
export function withWrite<T>(fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
  // Stamp the change bus so the data.db fs watcher knows this write was in-process (the precise
  // per-table emit is the caller's job). Stamped on settle either way - a failed write still
  // touches the file's lock/WAL and must not surface as a phantom external change.
  return gate.run(true, () => open('read_write', fn)).finally(markWarehouseWrite)
}

// Schema lifecycle (baseline models + versioned migrations) lives in schema.ts; re-exported
// here so the many `import { ensureSchema } from './db.js'` sites keep working. (Import + export
// rather than `export … from` because this file's own helpers below call it too.)
import { ensureSchema } from './schema.js'
export { ensureSchema }

/** Read one kv_state value (JSON-parsed), or null when the key has never been written. */
export async function getKvState<T>(key: string): Promise<T | null> {
  await ensureSchema()
  const rows = await withRead<{ value: unknown }>(`SELECT value FROM kv_state WHERE key = ?`, [key])
  const raw = rows[0]?.value
  if (raw == null) return null
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T
}

/** UPSERT one kv_state value. */
export async function setKvState(key: string, value: unknown): Promise<void> {
  await ensureSchema()
  await withWrite(async (conn) => {
    await conn.run(
      `INSERT INTO kv_state (key, value, updated_at) VALUES (?, ?::JSON, now())
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value)],
    )
  })
}

