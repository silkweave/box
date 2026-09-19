// Warehouse backup and restore: local first, remote optional.
//
// The warehouse (`<instance>/data.db`) is the ground truth and is gitignored, so a copy of it is
// the only safety net when a migration or an agent's restructuring goes wrong. Every backup lands
// in `<instance>/backups/` (naming, listing and retention: restore-points.ts). When a bucket is
// set the same copy is ALSO uploaded with gsutil, using the layout the bucket has always had:
//   warehouse/analytics-<date>.duckdb   point-in-time snapshot (one per run date)
//   warehouse/analytics-latest.duckdb   pointer to the newest
// No bucket is the normal, non-error case: the run is local-only and says so.
//
// GCS setup (one-time): a PRIVATE bucket with object versioning, objectAdmin for the active gcloud
// identity, `backup.gcsBucket` in box.json.
// Auth is the ambient gcloud/gsutil credential. See docs/WAREHOUSE.md.

import { execFileSync } from 'node:child_process'
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { boxJson } from '../box-config.js'
import { instanceDir, instanceRelative, warehousePath } from '../io.js'
import { todayUtc } from '../ops/types.js'
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
        `Then ensure your gcloud identity has objectAdmin. See docs/WAREHOUSE.md.`,
    )
  }
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
  const snapshot = gs ? `${gs}/warehouse/analytics-${todayUtc()}.duckdb` : null

  if (dryRun) {
    const name = backupName(label)
    const where = snapshot ? ` and upload it to ${snapshot}` : ' (local only: no backup.gcsBucket in box.json)'
    return { local: null, bucket, snapshot, dryRun, summary: `dry run - would write backups/${name}.db${where}` }
  }

  // withWrite would happily CREATE an empty warehouse; refuse rather than back up nothing.
  if (!existsSync(live)) throw new Error(`no warehouse at ${live}`)
  if (gs) assertGcsBucketReachable(gs)

  const local = await withWrite((conn) => copyWarehouseUnderLock(conn, live, label))
  if (gs && snapshot) {
    try {
      execFileSync('gsutil', ['cp', local.path, snapshot], { stdio: 'pipe' })
      execFileSync('gsutil', ['cp', local.path, `${gs}/warehouse/analytics-latest.duckdb`], { stdio: 'pipe' })
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
    summary: `backed up warehouse -> ${instanceRelative(local.path)} (${mb(local.bytes)})${where}${retention}`,
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
export async function restoreWarehouse(name: string): Promise<{ from: RestorePoint; parked: string | null; summary: string }> {
  const instance = instanceDir()
  const live = warehousePath()
  const from = findRestorePoint(name, instance)
  sweepStagedRestores(instance)
  const staged = await stageRestore(from, instance)
  const hadWarehouse = existsSync(live)
  let parked: RestorePoint | null = null
  try {
    parked = await withWrite(async (conn) => {
      const previous = hadWarehouse ? await copyWarehouseUnderLock(conn, live, 'pre-restore') : null
      rmSync(`${live}.wal`, { force: true })
      renameSync(staged, live)
      return previous
    })
  } catch (error) {
    rmSync(staged, { force: true })
    throw error
  }
  const [{ tables }] = await withRead<{ tables: number }>(
    `SELECT count(*)::INTEGER AS tables FROM information_schema.tables WHERE table_schema = 'main'`,
  )
  const summary =
    `restored ${from.name} (${from.label}, ${mb(from.bytes)}, ${tables} tables) over ${live}` +
    (parked ? `; the previous warehouse is parked as ${instanceRelative(parked.path)}` : '; there was no previous warehouse to park') +
    '. Connections are ephemeral, so the next query reads the restored file. If its schema is older than ' +
    'the running code, ensureSchema() migrates it forward on the next boot: restart a long-lived server, ' +
    'because the schema step is memoized per process and will not re-run until then.'
  return { from, parked: parked?.path ?? null, summary }
}
