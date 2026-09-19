// DuckDB access layer - the warehouse is now the **ground truth** (not a rebuildable cache).
// Writes UPSERT straight into the tenant instance dir's warehouse (data/data.db); no JSON source.
//
// Concurrency (DuckDB is single-writer across processes - one read-write OR many read-only):
//   • reads  → ephemeral access_mode:'read_only', so the read-only `warehouse` MCP server and the
//     `duckdb` CLI keep working in between our writes (we never hold a long-lived lock).
//   • writes → ephemeral access_mode:'read_write', serialized in-process (a single write at a time)
//     and retried-with-backoff on a file-lock conflict from another process.
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

/** Run a read-only query and return JSON-safe row objects (no bigint/Date). */
export async function withRead<T = Record<string, unknown>>(sql: string, values?: DuckDBValue[]): Promise<T[]> {
  return open('read_only', async (conn) => {
    const reader = await conn.runAndReadAll(sql, values)
    return reader.getRowObjectsJson() as T[]
  })
}

// In-process write serialization: chain every write so we never open two read-write instances at
// once (DuckDB allows only one writer per file). Cross-process conflicts are handled by retry above.
let writeChain: Promise<unknown> = Promise.resolve()

/** Run `fn` against a read-write connection, serialized in-process and retried on cross-process locks. */
export function withWrite<T>(fn: (conn: DuckDBConnection) => Promise<T>): Promise<T> {
  const next = writeChain.then(() => open('read_write', fn))
  writeChain = next.catch(() => undefined) // keep the chain alive even if a write rejects
  // Stamp the change bus so the data.db fs watcher knows this write was in-process (the precise
  // per-table emit is the caller's job). Stamped on settle either way - a failed write still
  // touches the file's lock/WAL and must not surface as a phantom external change.
  return next.finally(markWarehouseWrite)
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

/**
 * The four signal writers and `SignalRow` moved OUT of this file on 2026-09-13, into
 * `features/data/signals/write.ts`. They write `snapshots` and `legacy_signal_points`, which the
 * `data` feature owns, so core naming them here was core knowing a feature's tables - harmless at
 * runtime (only feature code ever called them) and invisible to `schema:check`'s ownership lint,
 * which reads migrations rather than helpers. Import them from the data feature instead.
 */
