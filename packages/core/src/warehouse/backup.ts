// Warehouse backup and restore: local first, remote optional.
//
// The warehouse (`<instance>/data.db`) is the ground truth and is gitignored, so a copy of it is
// the only safety net when a migration or an agent's restructuring goes wrong. Every backup lands
// in `<instance>/backups/` (naming, listing and retention: restore-points.ts). When a bucket is
// set the same copy is ALSO uploaded with gsutil, over one object:
//   warehouse/analytics-latest.duckdb
// History is the bucket's job: object versioning keeps each overwritten copy as a noncurrent
// version and a lifecycle rule deletes those after N days, so there are no dated objects to prune.
// No bucket is the normal, non-error case: the run is local-only and says so.
//
// GCS setup (one-time): a PRIVATE bucket with object versioning and a noncurrent-version lifecycle
// rule, objectAdmin for the active gcloud identity, `backup.gcsBucket` in box.json.
// Auth is the ambient gcloud/gsutil credential. See docs/WAREHOUSE.md.

import { execFile, execFileSync } from 'node:child_process'
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { DuckDBInstance } from '@duckdb/node-api'
import { boxJson } from '../box-config.js'
import { captureAgentFiles, readAgentsSnapshot, stageAgentFiles, swapAgentFiles, writeAgentsSnapshot } from './agent-snapshot.js'
import { instanceDir, instanceRelative, warehousePath } from '../io.js'
import { withRead, withWrite } from './db.js'
import {
  copyWarehouseUnderLock,
  findRestorePoint,
  backupName,
  pruneBackupsQuietly,
  type BackupLabel,
  type RestorePoint,
} from './restore-points.js'

export {
  BACKUP_LABELS,
  RETENTION,
  backupsDir,
  listRestorePoints,
  parseBackupName,
  planRetention,
  pruneBackups,
  seedsDir,
  type BackupLabel,
  type CheckpointConn,
  type RestorePoint,
  type RetentionPlan,
} from './restore-points.js'

export interface BackupResult {
  /** The local restore point written under `backups/`. Null on a dry run; absent for the chat backup. */
  local?: RestorePoint | null
  /** Bucket the copy was also uploaded to, or null when the run was local-only. */
  bucket: string | null
  /** The remote object (`gs://...`) when uploaded, or null when local-only. */
  snapshot: string | null
  dryRun: boolean
  summary: string
  /** Backups retention removed after this one was written. */
  pruned?: string[]
}

/** Strip gs:// and any trailing slash so we can compose paths predictably. Shared with the chat
 *  backup (chat/backup.ts) - one bucket, one env var, two prefixes. */
export function gcsBucketName(): string {
  const raw = boxJson().backup.gcsBucket
  if (!raw) throw new Error('no bucket: set backup.gcsBucket in box.json (e.g. my-team-box-warehouse). See docs/WAREHOUSE.md.')
  return raw.replace(/^gs:\/\//, '').replace(/\/+$/, '')
}

/** Fail fast with the setup recipe when the bucket is missing or unreadable. Shared with the chat
 *  backup. */
export function assertGcsBucketReachable(gs: string): void {
  try {
    execFileSync('gsutil', ['ls', '-b', gs], { stdio: 'pipe' })
  } catch {
    throw new Error(
      `bucket ${gs} not reachable. Create it (private) and grant access, e.g.:\n` +
        `  gsutil mb -p <project> -b on -l <region> ${gs}\n` +
        `  gsutil versioning set on ${gs}\n` +
        `  gsutil lifecycle set lifecycle.json ${gs}   # delete noncurrent versions after 30 days\n` +
        `Then ensure your gcloud identity has objectAdmin. See docs/WAREHOUSE.md.`,
    )
  }
}

const execFileAsync = promisify(execFile)

/** Upload one file over a bucket object (`gsutil cp`). Async: a 100 MB warehouse copy takes over a
 *  minute, and a synchronous child process would stall every request for that long. Shared with
 *  the chat and artifacts backups. */
export async function uploadFileToGcs(local: string, target: string, metadata: Record<string, string> = {}): Promise<void> {
  const headers = Object.entries(metadata).flatMap(([k, v]) => ['-h', `x-goog-meta-${k}:${v}`])
  await execFileAsync('gsutil', [...headers, 'cp', local, target], { maxBuffer: 16 * 1024 * 1024 })
}

/**
 * Copy a local directory to `<gs>/<prefix>/` (`gsutil rsync -r`): new and changed files go up, and
 * nothing is ever deleted remotely. A file gone from the host stays in the bucket, so a lost or
 * partly deleted directory can never empty its own backup; the backup only grows. For file trees
 * whose files do not change once written (chat uploads, artifact pages), where dated copies would
 * only repeat the same bytes. Shared with the chat and artifacts backups.
 *
 * A missing or empty directory fails the run, so a store that vanished shows up as a failed backup
 * rather than a quiet success. `exclude` is a gsutil `-x` regex (paths relative to `dir`). Async, so
 * a large first upload does not block the server.
 */
export async function uploadDirToGcs(dir: string, gs: string, prefix: string, opts: { exclude?: string } = {}): Promise<string> {
  if (!existsSync(dir) || readdirSync(dir).length === 0) {
    throw new Error(`${dir} is missing or empty; not backed up (the copy at ${gs}/${prefix}/ is untouched)`)
  }
  const target = `${gs}/${prefix}/`
  const args = ['-m', '-q', 'rsync', '-r', ...(opts.exclude ? ['-x', opts.exclude] : []), dir, target]
  await execFileAsync('gsutil', args, { maxBuffer: 16 * 1024 * 1024 })
  return target
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Take a consistent local copy of the warehouse under `backups/`, then upload it when a bucket is
 * configured (`remote` defaults to "a bucket is set"; `remote: true` without a bucket throws).
 * The copy is taken under the write lock (see copyWarehouseUnderLock for why), the upload after it
 * is released, and it uploads the LOCAL copy so remote and local are the same bytes. Retention
 * runs afterwards; its failure is logged, never raised.
 */
export async function backupWarehouse(
  opts: { label?: BackupLabel; dryRun?: boolean; remote?: boolean } = {},
): Promise<BackupResult> {
  const label = opts.label ?? 'manual'
  const dryRun = opts.dryRun ?? false
  const remote = opts.remote ?? Boolean(boxJson().backup.gcsBucket)
  const instance = instanceDir()
  const live = warehousePath()
  const bucket = remote ? gcsBucketName() : null
  const gs = bucket ? `gs://${bucket}` : null
  const snapshot = gs ? `${gs}/warehouse/analytics-latest.duckdb` : null

  if (dryRun) {
    const name = backupName(label)
    const where = snapshot ? ` and upload it to ${snapshot}` : ' (local only: no backup.gcsBucket in box.json)'
    return { local: null, bucket, snapshot, dryRun, summary: `dry run - would write backups/${name}.db${where}` }
  }

  // withWrite would happily CREATE an empty warehouse; refuse rather than back up nothing.
  if (!existsSync(live)) throw new Error(`no warehouse at ${live}`)
  if (gs) assertGcsBucketReachable(gs)

  // Read the agent files under the same lock as the copy, and publish the restore point only as a
  // pair: a sidecar that cannot be written takes the database copy with it.
  const { local, files } = await withWrite(async (conn) => ({ files: captureAgentFiles(), local: await copyWarehouseUnderLock(conn, live, label) }))
  let agents: string
  try {
    agents = writeAgentsSnapshot(local.path, files)
  } catch (error) {
    rmSync(local.path, { force: true })
    throw new Error(`backup abandoned: the agent files could not be written beside it: ${String((error as Error)?.message ?? error)}`, { cause: error })
  }
  if (gs && snapshot) {
    try {
      // The agent files go up first under the restore point's own, never-overwritten name; the
      // database's object then names that pair in its metadata. Recovery reads
      // `restore-point` from the database object and fetches warehouse/agents/<name>.agents.json.
      await uploadFileToGcs(agents, `${gs}/warehouse/agents/${local.name}.agents.json`)
      await uploadFileToGcs(local.path, snapshot, { 'restore-point': local.name })
    } catch (error) {
      throw new Error(
        `local backup written to ${local.path}, but the upload to ${snapshot} failed: ${String((error as Error)?.message ?? error)}`,
        { cause: error },
      )
    }
  }
  const pruned = pruneBackupsQuietly(instance)

  const where = snapshot ? `, uploaded to ${snapshot}` : ' (local only: set backup.gcsBucket in box.json to also upload)'
  const retention = pruned.length ? `; retention removed ${pruned.length} older backup(s)` : ''
  return {
    local,
    bucket,
    snapshot,
    dryRun,
    summary: `backed up warehouse -> ${instanceRelative(local.path)} (${mb(local.bytes)}) with the agent files${where}${retention}`,
    pruned,
  }
}

/** Leftovers of a restore that died between staging and swap. Never the live file, never a backup. */
const STAGING_PREFIX = 'data.db.restoring-'

function sweepStagedRestores(instance: string): void {
  if (!existsSync(instance)) return
  for (const file of readdirSync(instance)) {
    if (file.startsWith(STAGING_PREFIX)) rmSync(join(instance, file), { force: true })
  }
}

/**
 * Stage `from` beside the live file as a self-contained database: copy it (and its WAL, if any),
 * open the copy read-write so DuckDB replays and folds the WAL, checkpoint, close. Two things fall
 * out: the restore point is proven to be a database this DuckDB can open BEFORE the live file is
 * touched, and the swap below is a single rename with no sidecar to sequence.
 */
async function stageRestore(from: RestorePoint, instance: string): Promise<string> {
  const staged = join(instance, `${STAGING_PREFIX}${randomUUID().slice(0, 8)}`)
  try {
    mkdirSync(instance, { recursive: true })
    copyFileSync(from.path, staged, constants.COPYFILE_EXCL)
    if (existsSync(`${from.path}.wal`)) copyFileSync(`${from.path}.wal`, `${staged}.wal`, constants.COPYFILE_EXCL)
    const db = await DuckDBInstance.create(staged, { access_mode: 'read_write' })
    const conn = await db.connect()
    try {
      await conn.run('CHECKPOINT')
    } finally {
      conn.disconnectSync()
      db.closeSync()
    }
    if (existsSync(`${staged}.wal`)) throw new Error('DuckDB left a WAL beside the staged copy after CHECKPOINT')
    if (statSync(staged).size === 0) throw new Error('staged copy is empty')
    return staged
  } catch (error) {
    rmSync(staged, { force: true })
    rmSync(`${staged}.wal`, { force: true })
    throw new Error(`restore point ${from.name} could not be staged: ${String((error as Error)?.message ?? error)}`, { cause: error })
  }
}

/**
 * Restore `name` (from `backups/` or `seeds/`) over the live warehouse.
 *
 * Order, and why:
 *   1. Stage the restore point into a self-contained temp file in the instance dir (same
 *      filesystem as the live file, so step 4 is an atomic rename). Nothing live is touched yet,
 *      and an unreadable restore point fails here.
 *   2. Under the write lock, CHECKPOINT and park the live warehouse as a `pre-restore` backup, so a
 *      mistaken restore is itself a restore away.
 *   3. Still under the lock, remove any `data.db.wal`. CHECKPOINT already deleted it; this is for a
 *      sidecar an interrupted external writer left. A stale WAL beside a different database makes
 *      DuckDB fail on open ("Failure while replaying WAL", verified 2026-09-17), and the file stays
 *      broken until someone removes it by hand.
 *   4. Still under the lock, rename the staged file over `data.db`. The rename is atomic: at no
 *      instant is there a half-written or missing warehouse, so a process dying anywhere in this
 *      sequence leaves either the old file (checkpointed, no WAL) or the new one (checkpointed, no
 *      WAL). Our connection stays open on the OLD inode; DuckDB's close writes nothing through the
 *      path, so the new file's bytes are exactly the staged bytes (verified 2026-09-17).
 *   5. After the lock, open the restored file read-only and count its tables: a restore that does
 *      not open is an error here, not a surprise on the next request.
 * Retention is deliberately not run here: it could remove the very point just restored from. The
 * next backup or migration snapshot prunes, and that keeps `pre-restore` bounded too.
 *
 * Every connection in this codebase is ephemeral, so the next query reads the restored file. A
 * restore point whose migration ledger is behind the running code is fine: `ensureSchema()`
 * migrates it forward - but that step is memoized per process (`schemaReady` in schema.ts), so a
 * server that already baselined will not re-run it until restarted. The summary says so.
 */
export async function restoreWarehouse(
  name: string,
  opts: { keepAgentFiles?: boolean } = {},
): Promise<{ from: RestorePoint; parked: string | null; summary: string }> {
  const instance = instanceDir()
  const live = warehousePath()
  const from = findRestorePoint(name, instance)
  // Validated in full before anything live is touched.
  const files = readAgentsSnapshot(from.path)
  if (files === null && from.label !== 'seed' && !opts.keepAgentFiles) {
    throw new Error(
      `${from.name} carries no agent files (taken before they were backed up, or an interrupted backup). ` +
        `Restore it with --keep-agent-files to keep data/config/agents/ as it is now, after checking those files match it.`,
    )
  }
  sweepStagedRestores(instance)
  const staged = await stageRestore(from, instance)
  let stagedAgents: string | null = null
  try {
    stagedAgents = files ? stageAgentFiles(files) : null
  } catch (error) {
    rmSync(staged, { force: true })
    throw error
  }
  const hadWarehouse = existsSync(live)
  let parked: RestorePoint | null = null
  let leftover: string | null = null
  try {
    parked = await withWrite(async (conn) => {
      const previous = hadWarehouse ? await copyWarehouseUnderLock(conn, live, 'pre-restore') : null
      if (previous) writeAgentsSnapshot(previous.path)
      // Files first, then the database; a failed database swap puts the files back.
      const swap = stagedAgents ? swapAgentFiles(stagedAgents, from.name) : null
      try {
        rmSync(`${live}.wal`, { force: true })
        renameSync(staged, live)
      } catch (error) {
        swap?.undo()
        throw error
      }
      leftover = swap?.commit() ?? null
      return previous
    })
  } catch (error) {
    rmSync(staged, { force: true })
    if (stagedAgents) rmSync(stagedAgents, { recursive: true, force: true })
    throw error
  }
  const agentFiles = files === null ? null : Object.keys(files).length
  const [{ tables }] = await withRead<{ tables: number }>(
    `SELECT count(*)::INTEGER AS tables FROM information_schema.tables WHERE table_schema = 'main'`,
  )
  const summary =
    `restored ${from.name} (${from.label}, ${mb(from.bytes)}, ${tables} tables) over ${live}` +
    (parked ? `; the previous warehouse is parked as ${instanceRelative(parked.path)}` : '; there was no previous warehouse to park') +
    (agentFiles === null
      ? '. The restore point carries no agent files; data/config/agents/ is as it was'
      : `. data/config/agents/ restored (${agentFiles} file${agentFiles === 1 ? '' : 's'})`) +
    (leftover ? `; the previous agent files could not be removed and are in ${instanceRelative(leftover)} (safe to delete)` : '') +
    '. Connections are ephemeral, so the next query reads the restored file. If its schema is older than ' +
    'the running code, ensureSchema() migrates it forward on the next boot: restart a long-lived server, ' +
    'because the schema step is memoized per process and will not re-run until then.'
  return { from, parked: parked?.path ?? null, summary }
}
