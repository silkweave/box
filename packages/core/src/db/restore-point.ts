// Database restore points: taking one online, and validating and unpacking one for a restore.
//
// A restore point is a directory: `pgdata.tar.gz` (an online physical snapshot of the cluster's
// data directory), `agents.json` (the agent files) and `manifest.json` (written last).
//
// Taking one runs on ONE owner session held open throughout: a temporary replication slot keeps
// the WAL the copy needs, `pg_backup_start` checkpoints, the data directory streams into the
// archive (without the WAL directory's contents and the postmaster files), then `pg_backup_stop`
// returns the backup label. The label and exactly the WAL segments from the backup's start to its
// stop go in last. Unpacked into a fresh cluster directory, the server's backup recovery replays
// that WAL and opens with every transaction committed before `pg_backup_stop`.
//
// The agent files are read while the agents advisory lock is held across `pg_backup_stop`, so a
// backup never splits an agent change made through the Box (R1). Files are the agents'
// authority; boot reconciliation derives the users rows from them before admitting work. The
// migration ledger is read under the schema lock (shared, or held by the migrator for a
// pre-migrate point), so it is exactly the restored database's.
//
// Lock order on every path: maintenance gate, then the schema lock, then the agents lock.

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import pg from 'pg'
import { agentIdentity } from '../box-config.js'
import { configPath } from '../io.js'
import { captureAgentFiles, interruptedAgentChange, readAgentFiles, writeAgentFiles, type AgentFiles } from '../warehouse/agent-snapshot.js'
import { CORE_SCHEMA } from '../warehouse/pg/areas.js'
import { AGENTS_LOCK_KEY, SCHEMA_LOCK_KEY } from '../warehouse/pg/migrate.js'
export { AGENTS_LOCK_KEY }
import { BOX_DATABASE } from '../warehouse/pg/policy.js'
import { AGENTS_FILE, ARCHIVE_FILE, MANIFEST_FILE, POINT_NAME, REPLACED_PREFIX, RESTORE_POINT_FORMAT, STAGING_PREFIX, type BackupLabel } from '../warehouse/restore-points.js'
import { OWNER_LOGIN, type ClusterIdentity } from './cluster.js'
import { fsyncDir, fsyncFile, writeJsonDurable } from './durable.js'
import { extractTarGz, TarGzWriter } from './tarball.js'

export { RESTORE_POINT_FORMAT }
/** The directory every archive holds the data directory under. */
export const ARCHIVE_ROOT = 'pgdata'

/** A running cluster this process can read the data directory of. */
export interface Target { socket: string; port: number; dataDir: string }

export interface LedgerEntry { name: string; checksum: string }

export interface RestorePointManifest {
  format: typeof RESTORE_POINT_FORMAT
  name: string
  label: BackupLabel | 'seed'
  takenAt: string
  source: { cluster: string; clusterId: string; build: string; version: string; major: number; pgvector: string }
  archive: {
    file: typeof ARCHIVE_FILE
    /** Compressed size and digest of the archive file. */
    bytes: number
    sha256: string
    /** Files and directories in the archive, and their uncompressed content. */
    entries: number
    dataBytes: number
    /** WAL the archive carries: the backup's start and stop segments (inclusive). */
    wal: { start: string; stop: string; stopLsn: string; segments: number }
  }
  agents: { file: typeof AGENTS_FILE; sha256: string; count: number }
  /** The system principal and its identity lock when the snapshot was taken (R1). */
  systemAgent: { id: string; identityLock: string | null }
  /** The migration ledger (`core.schema_migrations`) the restored database holds. */
  ledger: LedgerEntry[]
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** The migration ledger, or empty when the database has none yet. */
export async function readLedger(c: pg.Client): Promise<LedgerEntry[]> {
  const has = (await c.query(`select 1 from pg_tables where schemaname = $1 and tablename = 'schema_migrations'`, [CORE_SCHEMA])).rowCount! > 0
  return has ? (await c.query<LedgerEntry>(`select name, checksum from ${CORE_SCHEMA}.schema_migrations order by name`)).rows : []
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
  /** Test seam: runs on a separate connection after the data directory was copied, before
   *  `pg_backup_stop` (writes here must be in the restored database). */
  beforeStop?: () => Promise<void>
}

function client(t: { socket: string; port: number }, database = BOX_DATABASE): pg.Client {
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

function readIdentityLock(): string | null {
  const f = configPath('agent-identity.lock.json')
  return existsSync(f) ? readFileSync(f, 'utf8') : null
}

/** Never copied from a live data directory: the running server's own files. */
const SKIP_FILES = new Set(['postmaster.pid', 'postmaster.opts'])
const WAL_NAME = /^[0-9A-F]{24}$/

/** Stream the live data directory into `w` under ARCHIVE_ROOT. pg_wal keeps only its directory
 *  structure here; its segments are added after the backup stopped. */
async function copyDataDir(w: TarGzWriter, dataDir: string, rel = ''): Promise<void> {
  let entries
  try { entries = await readdir(join(dataDir, rel), { withFileTypes: true }) } catch (e) {
    // A directory dropped while the copy runs (a database's): WAL replay recreates what it must.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' && rel) return
    throw e
  }
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const e of entries) {
    const path = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      await w.addDir(`${ARCHIVE_ROOT}/${path}`)
      if (path === 'pg_wal' || rel === 'pg_wal') continue
      await copyDataDir(w, dataDir, path)
    } else if (e.isFile()) {
      if ((!rel && SKIP_FILES.has(e.name)) || rel === 'pg_wal') continue
      await w.addFile(`${ARCHIVE_ROOT}/${path}`, join(dataDir, path))
    } else {
      throw new Error(`${join(dataDir, path)} is not a regular file or directory (tablespaces and links are not supported)`)
    }
  }
}

/** Segment names from `start` to `stop` inclusive (same timeline). */
export function walSegments(start: string, stop: string, segmentBytes: number): string[] {
  if (!WAL_NAME.test(start) || !WAL_NAME.test(stop)) throw new Error(`unexpected WAL segment names ${start}, ${stop}`)
  if (start.slice(0, 8) !== stop.slice(0, 8)) throw new Error(`the backup crossed a timeline (${start} to ${stop})`)
  const perId = 0x100000000 / segmentBytes
  const index = (n: string) => Number.parseInt(n.slice(8, 16), 16) * perId + Number.parseInt(n.slice(16, 24), 16)
  const name = (i: number) => `${start.slice(0, 8)}${Math.floor(i / perId).toString(16).toUpperCase().padStart(8, '0')}${(i % perId).toString(16).toUpperCase().padStart(8, '0')}`
  const out: string[] = []
  for (let i = index(start); i <= index(stop); i++) out.push(name(i))
  if (!out.length) throw new Error(`the backup stopped (${stop}) before it started (${start})`)
  return out
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
  const timeoutMs = o.timeoutMs ?? 30 * 60_000
  const final = join(o.parent, o.name)
  if (existsSync(final) && !o.replace) throw new Error(`${final} exists already`)
  const staging = join(o.parent, `${STAGING_PREFIX}${randomUUID().slice(0, 8)}`)
  mkdirSync(staging, { recursive: true, mode: 0o700 })

  const session = client(o.target)
  let writer: TarGzWriter | null = null
  let agentsLocked = false
  const deadline = setTimeout(() => {
    // Ending the session aborts the backup and drops the temporary slot; the pending query fails.
    (session as unknown as { connection?: { stream?: { destroy(): void } } }).connection?.stream?.destroy()
  }, timeoutMs)
  try {
    await session.connect()
    await session.query(`set statement_timeout = ${Math.min(timeoutMs, 600_000)}`)
    if ((o.schemaLock ?? 'take') === 'take') await session.query('select pg_advisory_lock_shared($1)', [SCHEMA_LOCK_KEY])
    const ledger = await readLedger(session)
    const segmentBytes = Number((await session.query<{ v: string }>(`select setting v from pg_settings where name = 'wal_segment_size'`)).rows[0]!.v)
    // The slot reserves WAL from now on: a checkpoint during the copy cannot recycle a segment the
    // restore needs. Temporary: it goes with the session, however the session ends.
    const slot = `box_backup_${randomUUID().replaceAll('-', '').slice(0, 12)}`
    await session.query('select pg_create_physical_replication_slot($1, true, true)', [slot])
    await session.query('select pg_backup_start($1, true)', [`box ${o.name}`])

    const archive = join(staging, ARCHIVE_FILE)
    writer = new TarGzWriter(archive)
    await writer.addDir(ARCHIVE_ROOT)
    await copyDataDir(writer, o.target.dataDir)
    await o.beforeStop?.()

    await session.query('select pg_advisory_lock($1)', [AGENTS_LOCK_KEY])
    agentsLocked = true
    const files: AgentFiles = captureAgentFiles()
    const systemAgent = { id: agentIdentity().id, identityLock: readIdentityLock() }
    const stop = (await session.query<{ lsn: string; labelfile: string; spcmapfile: string | null; wal: string }>(
      'select lsn::text lsn, labelfile, spcmapfile, pg_walfile_name(lsn) wal from pg_backup_stop(false)')).rows[0]!
    await session.query('select pg_advisory_unlock($1)', [AGENTS_LOCK_KEY])
    agentsLocked = false
    if (stop.spcmapfile?.trim()) throw new Error('the cluster has tablespaces, which Box backups do not support')

    const start = /START WAL LOCATION: \S+ \(file ([0-9A-F]{24})\)/.exec(stop.labelfile)?.[1]
    if (!start) throw new Error('pg_backup_stop returned a backup label without its start segment')
    const segments = walSegments(start, stop.wal, segmentBytes)
    await writer.addBuffer(`${ARCHIVE_ROOT}/backup_label`, Buffer.from(stop.labelfile.endsWith('\n') ? stop.labelfile : `${stop.labelfile}\n`))
    for (const seg of segments) {
      if (!(await writer.addFile(`${ARCHIVE_ROOT}/pg_wal/${seg}`, join(o.target.dataDir, 'pg_wal', seg)))) {
        throw new Error(`WAL segment ${seg} was removed during the backup; take it again`)
      }
    }
    await writer.addDir(`${ARCHIVE_ROOT}/pg_wal/archive_status`)
    await bounded(session.query('select pg_drop_replication_slot($1)', [slot]))
    const summary = await writer.finish()
    writer = null
    fsyncFile(archive)

    const agentsSha = writeAgentFiles(join(staging, AGENTS_FILE), files)
    const manifest: RestorePointManifest = {
      format: RESTORE_POINT_FORMAT,
      name: o.name,
      label: o.label,
      takenAt: new Date().toISOString(),
      source: { cluster: o.source.cluster, clusterId: o.source.identity.id, build: o.source.identity.build,
        version: o.source.identity.version, major: o.source.identity.major, pgvector: o.source.identity.pgvector },
      archive: { file: ARCHIVE_FILE, ...summary, wal: { start, stop: stop.wal, stopLsn: stop.lsn, segments: segments.length } },
      agents: { file: AGENTS_FILE, sha256: agentsSha, count: Object.keys(files).length },
      systemAgent,
      ledger,
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
    if (writer) await writer.abort()
    rmSync(staging, { recursive: true, force: true })
    throw new Error(`backup failed: ${(e as Error).message}`, { cause: e })
  } finally {
    clearTimeout(deadline)
    if (agentsLocked) await bounded(session.query('select pg_advisory_unlock($1)', [AGENTS_LOCK_KEY]))
    // Ending the session aborts an unfinished backup and releases its locks and slot.
    await bounded(session.end())
  }
}

// ---- Validating and unpacking a restore point ----

export interface ValidRestorePoint {
  dir: string
  manifest: RestorePointManifest
  agents: AgentFiles
  archivePath: string
}

/** Validate a restore point's files against its manifest (R10) before anything live changes. */
export async function validateRestorePoint(dir: string): Promise<ValidRestorePoint> {
  const mf = join(dir, MANIFEST_FILE)
  if (!existsSync(mf)) throw new Error(`${dir} has no manifest.json`)
  const manifest = JSON.parse(readFileSync(mf, 'utf8')) as RestorePointManifest
  if (manifest.format !== RESTORE_POINT_FORMAT) {
    const old = (manifest.format as string) === 'box-db-restore-point/1' || existsSync(join(dir, 'box.dump'))
    throw new Error(old
      ? `${dir} is a pg_dump restore point from an earlier Box version; this version restores only physical snapshots (${RESTORE_POINT_FORMAT}). Take a new backup.`
      : `${dir}: not a ${RESTORE_POINT_FORMAT} restore point`)
  }
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile()) throw new Error(`${dir}: ${e.name} is not a regular file`)
    if (![ARCHIVE_FILE, AGENTS_FILE, MANIFEST_FILE].includes(e.name)) throw new Error(`${dir}: unexpected file ${e.name}`)
  }
  const archivePath = join(dir, ARCHIVE_FILE)
  if (!existsSync(archivePath)) throw new Error(`${dir}: ${ARCHIVE_FILE} is missing`)
  if (statSync(archivePath).size !== manifest.archive.bytes || await sha256File(archivePath) !== manifest.archive.sha256) {
    throw new Error(`${dir}: ${ARCHIVE_FILE} does not match its manifest (damaged or replaced)`)
  }
  const af = join(dir, AGENTS_FILE)
  if (!existsSync(af)) throw new Error(`${dir}: agents.json is missing`)
  if (await sha256File(af) !== manifest.agents.sha256) throw new Error(`${dir}: agents.json does not match its manifest`)
  return { dir, manifest, agents: readAgentFiles(af), archivePath }
}

/**
 * Unpack a validated restore point's archive as `dataDir` (which must not exist): through a
 * sibling staging directory, renamed into place only once it holds a data directory with a backup
 * label of `major`.
 */
export async function unpackRestorePoint(point: ValidRestorePoint, dataDir: string, major: number): Promise<void> {
  if (existsSync(dataDir)) throw new Error(`refusing to unpack into ${dataDir}: it exists`)
  const staging = `${dataDir}.unpacking`
  rmSync(staging, { recursive: true, force: true })
  try {
    const { entries } = await extractTarGz(point.archivePath, staging)
    if (entries !== point.manifest.archive.entries) throw new Error(`the archive holds ${entries} entries, the manifest ${point.manifest.archive.entries}`)
    const pgdata = join(staging, ARCHIVE_ROOT)
    if (!existsSync(join(pgdata, 'backup_label'))) throw new Error('the archive has no backup_label: not an online snapshot')
    const version = existsSync(join(pgdata, 'PG_VERSION')) ? readFileSync(join(pgdata, 'PG_VERSION'), 'utf8').trim() : null
    if (version !== String(major)) throw new Error(`the archive is a PostgreSQL ${version ?? '(unknown)'} data directory; this engine runs ${major}`)
    for (const name of readdirSync(staging)) if (name !== ARCHIVE_ROOT) throw new Error(`the archive holds ${name} beside ${ARCHIVE_ROOT}/`)
    renameSync(pgdata, dataDir)
  } catch (e) {
    throw new Error(`${point.dir}: ${(e as Error).message}`, { cause: e })
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

/** Compare a restored database's ledger with the manifest's (before any forward migration, R6). */
export function compareLedger(want: LedgerEntry[], got: LedgerEntry[]): string[] {
  const key = (l: LedgerEntry) => `${l.name}=${l.checksum}`
  return want.map(key).join('\n') === got.map(key).join('\n') ? [] : ['migration ledger differs from the restore point']
}
