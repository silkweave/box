// Database restore points (PHASE1.md "W7 design", R1 to R10): taking one online, and validating
// one before a restore touches anything.
//
// A restore point is a directory: `box.dump` (`pg_dump -Fc` of the Box database), `agents.json`
// (the agent files) and `manifest.json` (written last). Everything the manifest says about the
// database (ledger, roles, per-table content digests, sequences) is read inside the SAME exported
// snapshot the dump reads, so a restore can check that what it loaded is what was backed up.
// The agent files are read while the agents advisory lock is held, between the snapshot export
// and the dump, so a backup never splits an agent change made through the Box (R1). Files are the
// agents' authority; boot reconciliation derives the users rows from them before admitting work.
//
// Lock order on every path: maintenance gate, then the schema lock, then the agents lock.

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { agentIdentity } from '../box-config.js'
import { configPath } from '../io.js'
import { captureAgentFiles, interruptedAgentChange, readAgentFiles, writeAgentFiles, type AgentFiles } from '../warehouse/agent-snapshot.js'
import { CORE_SCHEMA, EXT_SCHEMA } from '../warehouse/pg/areas.js'
import { AGENTS_LOCK_KEY, SCHEMA_LOCK_KEY } from '../warehouse/pg/migrate.js'
export { AGENTS_LOCK_KEY }
import { BOX_DATABASE } from '../warehouse/pg/policy.js'
import { AGENTS_FILE, DUMP_FILE, MANIFEST_FILE, POINT_NAME, REPLACED_PREFIX, STAGING_PREFIX, type BackupLabel } from '../warehouse/restore-points.js'
import { OWNER_LOGIN, type ClusterIdentity } from './cluster.js'
import { fsyncDir, fsyncFile, writeJsonDurable } from './durable.js'
import { resolveClientTools, type ClientTools } from './engines.js'

export const RESTORE_POINT_FORMAT = 'box-db-restore-point/1'

export interface Target { socket: string; port: number }

export interface TableDigest { rows: number; sha256: string }

export interface DatabaseSnapshot {
  ledger: { name: string; checksum: string }[]
  roles: { id: string; default_level: string; areas: Record<string, string> | null }[]
  roleLogins: { role_id: string; login: string }[]
  /** `schema.table` -> content digest. */
  tables: Record<string, TableDigest>
  /** `schema.sequence` -> last value (null when never called). */
  sequences: Record<string, string | null>
  /** Application schemas (core and the areas'). */
  schemas: string[]
  /** Cluster roles the dump's grants name: area groups and role logins (cluster objects are not dumped). */
  clusterRoles: { name: string; login: boolean }[]
}

export interface RestorePointManifest {
  format: typeof RESTORE_POINT_FORMAT
  name: string
  label: BackupLabel | 'seed'
  takenAt: string
  source: { cluster: string; clusterId: string; engine: string; build: string; version: string; major: number; pgvector: string }
  tools: { binDir: string; version: string; major: number }
  dump: { file: typeof DUMP_FILE; bytes: number; sha256: string; tocEntries: number }
  agents: { file: typeof AGENTS_FILE; sha256: string; count: number }
  /** The system principal and its identity lock when the snapshot was taken (R1). */
  systemAgent: { id: string; identityLock: string | null }
  snapshot: DatabaseSnapshot
}

// ---- Tools ----

export interface ToolRun { stdout: string }

/**
 * Run a client tool with a timeout; stderr becomes the error. The promise settles only after the
 * child has exited: a timeout or an abort sends SIGTERM, then SIGKILL after 5 s, and rejects once
 * the process is gone, so a caller can safely remove the files the tool was writing.
 */
export function runClientTool(tools: ClientTools, tool: 'pg_dump' | 'pg_restore', args: string[], timeoutMs: number, signal?: AbortSignal): Promise<ToolRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(join(tools.binDir, tool), args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = '', stopped: string | null = null, killTimer: ReturnType<typeof setTimeout> | null = null
    const stop = (why: string) => {
      if (stopped || child.exitCode !== null) return
      stopped = why
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
    }
    const timer = setTimeout(() => stop(`${tool} did not finish within ${Math.round(timeoutMs / 1000)} s`), timeoutMs)
    const onAbort = () => stop(`${tool} was cancelled`)
    if (signal?.aborted) onAbort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    const done = () => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); signal?.removeEventListener('abort', onAbort) }
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', (e) => { done(); reject(e) })
    child.on('close', (code) => {
      done()
      if (stopped) reject(new Error(stopped))
      else if (code === 0) resolve({ stdout: out })
      else reject(new Error(`${tool} exited ${code}: ${(err || out).trim().split('\n').slice(0, 5).join(' / ')}`))
    })
  })
}

/** Client tools able to talk to a server of `major` (and restore into `targetMajor`). R7: only
 *  supported pairs: tools of the same major as the newer side; source major never above target. */
export function toolsFor(sourceMajor: number, targetMajor = sourceMajor): ClientTools {
  if (sourceMajor > targetMajor) throw new Error(`a dump from PostgreSQL ${sourceMajor} cannot be restored into ${targetMajor} (no downgrades)`)
  const tools = resolveClientTools(targetMajor)
  if (tools.major !== targetMajor) {
    throw new Error(`client tools ${tools.version} (${tools.binDir}) do not match server major ${targetMajor}; install the PostgreSQL ${targetMajor} client tools`)
  }
  return tools
}

export async function tocEntries(tools: ClientTools, dump: string): Promise<{ count: number; list: string }> {
  const { stdout } = await runClientTool(tools, 'pg_restore', ['-l', dump], 120_000)
  const count = stdout.split('\n').filter((l) => l.trim() && !l.startsWith(';')).length
  return { count, list: stdout }
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

// ---- Snapshot read ----

const SYSTEM_SCHEMAS = new Set(['pg_catalog', 'information_schema', 'pg_toast', EXT_SCHEMA, 'public'])

/** Session settings that make text output canonical across engines and hosts. */
export const CANONICAL_SETTINGS = [
  `set local timezone = 'UTC'`,
  `set local datestyle = 'ISO, YMD'`,
  `set local intervalstyle = 'postgres'`,
  `set local extra_float_digits = 1`,
  `set local bytea_output = 'hex'`,
]

/**
 * Per-table digest: rows in primary-key order (all columns when there is no key), each row's
 * record text with explicit length framing, streamed through a cursor (constant memory). A null
 * column prints as nothing and an empty string as `""` in record text, so the two never collide.
 */
async function tableDigest(c: pg.Client, schema: string, table: string, order: string[]): Promise<TableDigest> {
  const q = (s: string) => `"${s.replaceAll('"', '""')}"`
  const rel = `${q(schema)}.${q(table)}`
  const orderBy = order.length ? order.map((col) => `x.${q(col)}`).join(', ') : `x::text collate "C"`
  const cursor = `box_digest_${randomUUID().replaceAll('-', '').slice(0, 12)}`
  await c.query(`declare ${cursor} no scroll cursor for select x::text as r from ${rel} x order by ${orderBy}`)
  const hash = createHash('sha256')
  let rows = 0
  try {
    for (;;) {
      const batch = (await c.query<{ r: string }>(`fetch forward 2000 from ${cursor}`)).rows
      for (const { r } of batch) { const b = Buffer.from(r, 'utf8'); hash.update(`${b.length}:`); hash.update(b); hash.update('\n') }
      rows += batch.length
      if (batch.length < 2000) break
    }
  } finally { await c.query(`close ${cursor}`) }
  return { rows, sha256: hash.digest('hex') }
}

/**
 * Every application sequence's last value. Sequences are not MVCC: this reads their state NOW,
 * whatever snapshot `c` is in. A restore point reads them BEFORE pg_dump starts, so the dump's
 * values (read later) are never below the manifest's; Box sequences only ascend.
 */
export async function readSequences(c: pg.Client): Promise<Record<string, string | null>> {
  const sequences: Record<string, string | null> = {}
  for (const r of (await c.query<{ s: string; q: string; v: string | null }>(
    `select schemaname s, sequencename q, last_value::text v from pg_sequences order by 1, 2`)).rows) {
    if (!SYSTEM_SCHEMAS.has(r.s) && !r.s.startsWith('pg_')) sequences[`${r.s}.${r.q}`] = r.v
  }
  return sequences
}

/** Read the snapshot facts on `c`, which must be inside the snapshot's transaction. */
export async function readSnapshot(c: pg.Client): Promise<DatabaseSnapshot> {
  for (const s of CANONICAL_SETTINGS) await c.query(s)
  const tables = (await c.query<{ s: string; t: string; oid: number }>(
    `select n.nspname s, c.relname t, c.oid::int8 oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p') order by 1, 2`)).rows.filter((r) => !SYSTEM_SCHEMAS.has(r.s) && !r.s.startsWith('pg_'))
  const keys = new Map<number, string[]>()
  const pk = (await c.query<{ rel: number; k: string }>(`select indrelid::int8 rel, indkey::text k from pg_index where indisprimary`)).rows
  const attrs = (await c.query<{ rel: number; n: number; name: string }>(
    `select attrelid::int8 rel, attnum::int n, attname name from pg_attribute where attnum > 0 and not attisdropped`)).rows
  const attName = new Map(attrs.map((a) => [`${a.rel}:${a.n}`, a.name]))
  for (const { rel, k } of pk) keys.set(Number(rel), k.trim().split(/\s+/).map((n) => attName.get(`${rel}:${n}`)!).filter(Boolean))

  const digests: Record<string, TableDigest> = {}
  for (const { s, t, oid } of tables) digests[`${s}.${t}`] = await tableDigest(c, s, t, keys.get(Number(oid)) ?? [])
  const sequences = await readSequences(c)
  const has = async (t: string) => (await c.query(`select 1 from pg_tables where schemaname = $1 and tablename = $2`, [CORE_SCHEMA, t])).rowCount! > 0
  const ledger = await has('schema_migrations')
    ? (await c.query<{ name: string; checksum: string }>(`select name, checksum from ${CORE_SCHEMA}.schema_migrations order by name`)).rows : []
  const roles = await has('roles')
    ? (await c.query<DatabaseSnapshot['roles'][number]>(`select id, default_level, areas from ${CORE_SCHEMA}.roles order by id`)).rows : []
  const roleLogins = await has('role_logins')
    ? (await c.query<{ role_id: string; login: string }>(`select role_id, login from ${CORE_SCHEMA}.role_logins order by login`)).rows : []
  const clusterRoles = (await c.query<{ name: string; login: boolean }>(
    `select rolname name, rolcanlogin login from pg_roles where rolname ~ '^(area_[a-z0-9_]+_(read|write)|box_role_[1-9][0-9]*)$' order by 1`)).rows
  return { ledger, roles, roleLogins, tables: digests, sequences, schemas: [...new Set(tables.map((t) => t.s))].sort(), clusterRoles }
}

// ---- Taking a restore point ----

export interface TakeOptions {
  target: Target
  /** The directory that holds restore points (`backups/db` or `seeds`). */
  parent: string
  name: string
  label: BackupLabel | 'seed'
  source: { cluster: string; identity: ClusterIdentity }
  /** `take` (default): hold the schema lock shared for the run. `held`: the caller holds it (pre-migrate). */
  schemaLock?: 'take' | 'held'
  timeoutMs?: number
  /** Replace an existing restore point of this name once the new one is complete (seeds). */
  replace?: boolean
  /** Test seam: runs after pg_dump has started, before the snapshot facts are read, on the
   *  exporter's session. */
  duringDump?: (exporter: pg.Client) => Promise<void>
}

function client(t: Target, database = BOX_DATABASE): pg.Client {
  const c = new pg.Client({ host: t.socket, port: t.port, user: OWNER_LOGIN, database })
  c.on('error', () => { /* surfaced by the next query */ })
  return c
}

/** Await cleanup work for at most `ms`; failures and hangs are ignored (the session's end, or the
 *  server dropping a dead connection, releases what it held). */
async function bounded(p: Promise<unknown>, ms = 10_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([p.catch(() => {}), new Promise<void>((r) => { timer = setTimeout(r, ms) })])
  clearTimeout(timer)
}

/** Terminate backend `pid` from a fresh owner connection and wait (bounded) until it is gone. */
async function terminateBackend(t: Target, pid: number): Promise<void> {
  const c = client(t, 'postgres')
  try {
    await c.connect()
    await c.query('select pg_terminate_backend($1)', [pid])
    for (let i = 0; i < 100; i++) {
      if (!(await c.query('select 1 from pg_stat_activity where pid = $1', [pid])).rowCount) return
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error(`backend ${pid} did not exit after termination`)
  } finally { await c.end().catch(() => {}) }
}

function readIdentityLock(): string | null {
  const f = configPath('agent-identity.lock.json')
  return existsSync(f) ? readFileSync(f, 'utf8') : null
}

/**
 * Take a restore point of the running database at `target`, online. Writes into a staging
 * directory and renames it into place once the manifest is written; nothing partial is ever
 * listed. Refuses while an agent replacement is incomplete.
 */
export async function takeRestorePoint(o: TakeOptions): Promise<RestorePointManifest> {
  if (!POINT_NAME.test(o.name)) throw new Error(`invalid restore point name "${o.name}"`)
  const interrupted = interruptedAgentChange()
  if (interrupted) throw new Error(`backup refused: ${interrupted}`)
  const tools = toolsFor(o.source.identity.major)
  const timeoutMs = o.timeoutMs ?? 30 * 60_000
  const final = join(o.parent, o.name)
  if (existsSync(final) && !o.replace) throw new Error(`${final} exists already`)
  const staging = join(o.parent, `${STAGING_PREFIX}${randomUUID().slice(0, 8)}`)
  mkdirSync(staging, { recursive: true, mode: 0o700 })

  const exporter = client(o.target)
  let agentsLocked = false
  try {
    await exporter.connect()
    const exporterPid = (await exporter.query<{ pid: number }>('select pg_backend_pid() pid')).rows[0]!.pid
    await exporter.query(`set statement_timeout = ${Math.min(timeoutMs, 600_000)}`)
    if ((o.schemaLock ?? 'take') === 'take') await exporter.query('select pg_advisory_lock_shared($1)', [SCHEMA_LOCK_KEY])
    await exporter.query('select pg_advisory_lock($1)', [AGENTS_LOCK_KEY])
    agentsLocked = true
    await exporter.query('begin isolation level repeatable read read only')
    const snapshotId = (await exporter.query<{ s: string }>('select pg_export_snapshot() s')).rows[0]!.s
    const files: AgentFiles = captureAgentFiles()
    const systemAgent = { id: agentIdentity().id, identityLock: readIdentityLock() }
    await exporter.query('select pg_advisory_unlock($1)', [AGENTS_LOCK_KEY])
    agentsLocked = false

    // Sequences first: a lower bound for what the dump will read (see readSequences).
    const sequences = await readSequences(exporter)
    const dump = join(staging, DUMP_FILE)
    const cancel = new AbortController()
    const dumping = runClientTool(tools, 'pg_dump', ['-h', o.target.socket, '-p', String(o.target.port), '-U', OWNER_LOGIN,
      '-Fc', `--snapshot=${snapshotId}`, '-f', dump, BOX_DATABASE], timeoutMs, cancel.signal)
    // The facts are read on the exporter's own snapshot while the dump reads the same one. Both
    // tasks settle before anything continues or is cleaned up: a failure of either cancels the
    // other and waits for pg_dump to exit.
    // A failed dump (or the overall deadline) ends the exporter's session. The server only notices a
    // closed socket at its next socket interaction (client_connection_check_interval is 0 by
    // default), so a running statement would keep the snapshot and the shared schema lock: the
    // backend is terminated from an independent owner connection, and the socket is destroyed so
    // the local query settles at once.
    let ended: Promise<void> | null = null
    const endReader = () => {
      ended ??= (async () => {
        (exporter as unknown as { connection?: { stream?: { destroy(): void } } }).connection?.stream?.destroy()
        await bounded(terminateBackend(o.target, exporterPid))
      })()
      return ended
    }
    const deadline = setTimeout(() => { cancel.abort(); endReader() }, timeoutMs)
    const reading = (async () => { await o.duringDump?.(exporter); return readSnapshot(exporter) })()
    let first: { error: unknown } | null = null
    const [, read] = await Promise.allSettled([
      dumping.catch((e) => { first ??= { error: e }; endReader(); throw e }),
      reading.catch((e) => { first ??= { error: e }; cancel.abort(); throw e }),
    ]).finally(() => clearTimeout(deadline))
    // Termination is part of failing: the caller may take the schema lock right after.
    if (ended) await ended
    // The failure that came first is the cause; the other task's is its cancellation.
    if (first) throw (first as { error: unknown }).error
    if (read.status !== 'fulfilled') throw new Error('snapshot read did not complete')
    const snapshot: DatabaseSnapshot = { ...read.value, sequences }
    await exporter.query('commit')
    fsyncFile(dump)

    const toc = await tocEntries(tools, dump)
    const agentsSha = writeAgentFiles(join(staging, AGENTS_FILE), files)
    const manifest: RestorePointManifest = {
      format: RESTORE_POINT_FORMAT,
      name: o.name,
      label: o.label,
      takenAt: new Date().toISOString(),
      source: { cluster: o.source.cluster, clusterId: o.source.identity.id, engine: o.source.identity.engine, build: o.source.identity.build,
        version: o.source.identity.version, major: o.source.identity.major, pgvector: o.source.identity.pgvector },
      tools: { binDir: tools.binDir, version: tools.version, major: tools.major },
      dump: { file: DUMP_FILE, bytes: statSync(dump).size, sha256: await sha256File(dump), tocEntries: toc.count },
      agents: { file: AGENTS_FILE, sha256: agentsSha, count: Object.keys(files).length },
      systemAgent,
      snapshot,
    }
    writeJsonDurable(join(staging, MANIFEST_FILE), manifest)
    fsyncDir(staging)
    const replaced = existsSync(final) ? join(o.parent, `${REPLACED_PREFIX}${o.name}-${randomUUID().slice(0, 8)}`) : null
    if (replaced) { renameSync(final, replaced); fsyncDir(o.parent) }
    renameSync(staging, final)
    fsyncDir(o.parent)
    if (replaced) rmSync(replaced, { recursive: true, force: true })
    return manifest
  } catch (e) {
    await bounded(exporter.query('rollback'))
    rmSync(staging, { recursive: true, force: true })
    throw new Error(`backup failed: ${(e as Error).message}`, { cause: e })
  } finally {
    if (agentsLocked) await bounded(exporter.query('select pg_advisory_unlock($1)', [AGENTS_LOCK_KEY]))
    // Ending the session releases its advisory locks and snapshot even when a query above hung.
    await bounded(exporter.end())
  }
}

// ---- Validating a restore point ----

export interface ValidRestorePoint {
  dir: string
  manifest: RestorePointManifest
  agents: AgentFiles
  dumpPath: string
}

/** Validate a restore point in full (R10) before anything live changes. Throws with the reason. */
export async function validateRestorePoint(dir: string, tools: ClientTools): Promise<ValidRestorePoint> {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    if (!e.isFile()) throw new Error(`${dir}: ${e.name} is not a regular file`)
    if (![DUMP_FILE, AGENTS_FILE, MANIFEST_FILE].includes(e.name)) throw new Error(`${dir}: unexpected file ${e.name}`)
  }
  const mf = join(dir, MANIFEST_FILE)
  if (!existsSync(mf)) throw new Error(`${dir} has no manifest.json`)
  const manifest = JSON.parse(readFileSync(mf, 'utf8')) as RestorePointManifest
  if (manifest.format !== RESTORE_POINT_FORMAT) throw new Error(`${dir}: not a ${RESTORE_POINT_FORMAT} restore point`)
  const dumpPath = join(dir, DUMP_FILE)
  if (!existsSync(dumpPath)) throw new Error(`${dir}: box.dump is missing`)
  if (statSync(dumpPath).size !== manifest.dump.bytes || await sha256File(dumpPath) !== manifest.dump.sha256) throw new Error(`${dir}: box.dump does not match its manifest (damaged or replaced)`)
  const af = join(dir, AGENTS_FILE)
  if (!existsSync(af)) throw new Error(`${dir}: agents.json is missing`)
  if (await sha256File(af) !== manifest.agents.sha256) throw new Error(`${dir}: agents.json does not match its manifest`)
  const agents = readAgentFiles(af)
  const toc = await tocEntries(tools, dumpPath)
  if (toc.count !== manifest.dump.tocEntries) throw new Error(`${dir}: box.dump lists ${toc.count} entries, the manifest ${manifest.dump.tocEntries}`)
  return { dir, manifest, agents, dumpPath }
}

/** Compare a restored database's snapshot with the manifest's (before any forward migration, R6). */
export function compareSnapshots(want: DatabaseSnapshot, got: DatabaseSnapshot): string[] {
  const problems: string[] = []
  const key = (l: { name: string; checksum: string }) => `${l.name}=${l.checksum}`
  const a = want.ledger.map(key).join('\n'), b = got.ledger.map(key).join('\n')
  if (a !== b) problems.push('migration ledger differs from the restore point')
  for (const t of new Set([...Object.keys(want.tables), ...Object.keys(got.tables)])) {
    const w = want.tables[t], g = got.tables[t]
    if (!w || !g) problems.push(`table ${t}: ${w ? 'missing after restore' : 'not in the restore point'}`)
    else if (w.rows !== g.rows || w.sha256 !== g.sha256) problems.push(`table ${t}: ${g.rows} rows restored, ${w.rows} backed up${w.rows === g.rows ? ' (content differs)' : ''}`)
  }
  // Sequences are not MVCC: the manifest's were read before pg_dump started and pg_dump reads its
  // own later, so a restored value may be ahead of the manifest's, never behind.
  for (const [s, v] of Object.entries(want.sequences)) {
    const g = got.sequences[s]
    if (!(s in got.sequences)) problems.push(`sequence ${s}: missing after restore`)
    else if (v !== null && (g === null || g === undefined || BigInt(g) < BigInt(v))) problems.push(`sequence ${s}: restored at ${g}, backed up at ${v}`)
  }
  const roles = (r: DatabaseSnapshot) => JSON.stringify(r.roles) + JSON.stringify(r.roleLogins)
  if (roles(want) !== roles(got)) problems.push('roles or role logins differ from the restore point')
  return problems
}
