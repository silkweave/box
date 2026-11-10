// Database backup and restore: local first, remote optional (PHASE1.md "W7 design").
//
// A backup is a restore point directory in `<instance>/backups/db/` (format: db/restore-point.ts;
// naming, listing and retention: restore-points.ts): the Box database as of one snapshot plus the
// agent files. It covers the database only; chat and the artifact trees keep their own
// backups, and the whole-Box copy is a Builder backup. When a bucket is set
// the restore point is ALSO uploaded, as an immutable set, then a pointer:
//   db/restore-points/<name>/{box.dump,agents.json,manifest.json}   manifest last
//   db/latest.json                                                  {"restorePoint": "<name>"}
// Recovery from the bucket: copy one restore point's three files into backups/db/<name>/, then
// `box db restore <name>`. No bucket is the normal, non-error case: the run is local-only.
//
// GCS setup (one-time): a PRIVATE bucket, objectAdmin for the active gcloud identity,
// `backup.gcsBucket` in box.json. Auth is the ambient gcloud/gsutil credential. See docs/WAREHOUSE.md.

import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { boxJson } from '../box-config.js'
import { instanceDir, instanceRelative } from '../io.js'
import { dbRoot, resolveEngine, openDatabase } from '../db/index.js'
import { readActive, readIdentity, clusterOf } from '../db/cluster.js'
import { takeRestorePoint, type Target } from '../db/restore-point.js'
import { writeJsonDurable } from '../db/durable.js'
import { listClusters, pruneClusters, restoreDatabase, type ClusterEntry, type FileSwap, type RestoreResult } from '../db/switch.js'
import { bootedTarget } from './pg/boot.js'
import {
  AGENTS_FILE, DUMP_FILE, MANIFEST_FILE, POINT_NAME, UPLOAD_MAX_MS, UPLOAD_PIN_PREFIX,
  backupName, backupsDir, findRestorePoint, pruneBackupsQuietly, seedsDir, settleSeedReplacements,
  type BackupLabel, type RestorePoint,
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
export async function uploadFileToGcs(local: string, target: string, metadata: Record<string, string> = {}, timeoutMs = 0): Promise<void> {
  const headers = Object.entries(metadata).flatMap(([k, v]) => ['-h', `x-goog-meta-${k}:${v}`])
  await execFileAsync('gsutil', [...headers, 'cp', local, target], { maxBuffer: 16 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' })
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

/** The running database for an online backup: this process's booted one, or adopt / own the active
 *  cluster without booting it (a backup never migrates, R5). */
async function withBackupTarget<T>(fn: (t: Target, cluster: string) => Promise<T>): Promise<T> {
  const root = dbRoot()
  const active = readActive(root)
  if (!active) throw new Error('this Box has no database yet; nothing to back up')
  const booted = bootedTarget()
  if (booted) return fn(booted, active.cluster)
  const { running } = await openDatabase('cli')
  try { return await fn(running, active.cluster) } finally { await running.release() }
}

async function takePoint(parent: string, name: string, label: BackupLabel | 'seed', opts: { replace?: boolean } = {}): Promise<RestorePoint> {
  return withBackupTarget(async (target, cluster) => {
    const identity = readIdentity(clusterOf(dbRoot(), cluster))
    const m = await takeRestorePoint({ target, parent, name, label, source: { cluster, identity }, ...opts })
    return { name, path: `${parent}/${name}`, label, takenAt: new Date(m.takenAt), bytes: m.dump.bytes }
  })
}

/** Upload a restore point as an immutable set, manifest last, then move the latest pointer (R8). */
async function uploadRestorePoint(gs: string, point: RestorePoint): Promise<string> {
  const prefix = `${gs}/db/restore-points/${point.name}`
  // Pinned while uploading: retention in another process keeps it until the pin goes or goes
  // stale (dead uploader, or older than UPLOAD_MAX_MS, after which the upload has been killed).
  const pin = join(backupsDir(), `${UPLOAD_PIN_PREFIX}${point.name}.json`)
  writeJsonDurable(pin, { pid: process.pid, since: new Date().toISOString() })
  const deadline = Date.now() + UPLOAD_MAX_MS - 60_000
  const left = () => { const ms = deadline - Date.now(); if (ms <= 0) throw new Error(`upload did not finish within ${UPLOAD_MAX_MS / 3_600_000} h`); return ms }
  try {
    for (const f of [DUMP_FILE, AGENTS_FILE, MANIFEST_FILE]) await uploadFileToGcs(`${point.path}/${f}`, `${prefix}/${f}`, {}, left())
    const pointer = join(tmpdir(), `box-latest-${randomUUID().slice(0, 8)}.json`)
    try {
      writeFileSync(pointer, `${JSON.stringify({ restorePoint: point.name })}\n`)
      await uploadFileToGcs(pointer, `${gs}/db/latest.json`, {}, left())
    } finally { rmSync(pointer, { force: true }) }
  } finally { rmSync(pin, { force: true }) }
  return `${prefix}/`
}

/**
 * Take a restore point of the database under `backups/db/`, online, then upload it when a bucket
 * is configured (`remote` defaults to "a bucket is set"; `remote: true` without a bucket throws).
 * Retention runs afterwards (it never removes a pinned point); its failure is logged, never raised.
 */
export async function backupWarehouse(
  opts: { label?: BackupLabel; dryRun?: boolean; remote?: boolean } = {},
): Promise<BackupResult> {
  const label = opts.label ?? 'manual'
  const dryRun = opts.dryRun ?? false
  const remote = opts.remote ?? Boolean(boxJson().backup.gcsBucket)
  const bucket = remote ? gcsBucketName() : null
  const gs = bucket ? `gs://${bucket}` : null
  const name = backupName(label)
  if (dryRun) {
    const where = gs ? ` and upload it to ${gs}/db/restore-points/${name}/` : ' (local only: no backup.gcsBucket in box.json)'
    return { local: null, bucket, snapshot: null, dryRun, summary: `dry run - would write backups/db/${name}/${where}` }
  }
  if (gs) assertGcsBucketReachable(gs)
  mkdirSync(backupsDir(), { recursive: true, mode: 0o700 })
  const local = await takePoint(backupsDir(), name, label)
  let snapshot: string | null = null
  if (gs) {
    try {
      snapshot = await uploadRestorePoint(gs, local)
    } catch (error) {
      throw new Error(`local backup written to ${local.path}, but the upload to ${gs} failed: ${String((error as Error)?.message ?? error)}`, { cause: error })
    }
  }
  const pruned = pruneBackupsQuietly(instanceDir())
  const where = snapshot ? `, uploaded to ${snapshot}` : ' (local only: set backup.gcsBucket in box.json to also upload)'
  const retention = pruned.length ? `; retention removed ${pruned.length} older backup(s)` : ''
  return {
    local, bucket, snapshot, dryRun, pruned,
    summary: `backed up the database -> ${instanceRelative(local.path)} (${mb(local.bytes)}) with the agent files${where}${retention}. ` +
      'Database only: chat and the artifact trees have their own backups.',
  }
}

/** A named seed under `seeds/` (`box db snapshot <name>`); never pruned. */
export async function snapshotSeed(name: string): Promise<RestorePoint> {
  if (!POINT_NAME.test(name)) throw new Error(`invalid seed name "${name}": use a-z, 0-9 and -`)
  const parent = seedsDir()
  mkdirSync(parent, { recursive: true, mode: 0o700 })
  settleSeedReplacements()
  // An existing seed stays until its replacement is complete (see settleSeedReplacements).
  return takePoint(parent, name, 'seed', { replace: true })
}

/**
 * Restore `name` (from `backups/db/` or `seeds/`) into a fresh cluster and make it active
 * (db/switch.ts). Offline: Box must be stopped. The previous cluster is parked as a `pre-restore`
 * restore point and kept, stopped, as the retired cluster.
 */
export async function restoreWarehouse(name: string): Promise<RestoreResult & { from: RestorePoint }> {
  const from = findRestorePoint(name)
  const result = await restoreDatabase(dbRoot(), { point: from.path, resolveEngine })
  return { ...result, from }
}

/** Switch the database engine (`box db switch --engine <e>`): dump, restore into a fresh cluster of
 *  the other engine, then update `database.engine`. Offline. */
export async function switchDatabaseEngine(engine: 'pgrust' | 'native'): Promise<RestoreResult> {
  return restoreDatabase(dbRoot(), { point: null, engine, kind: 'switch', resolveEngine })
}


/** The cluster directories under `data/db/` (`box db clusters`). */
export function listDatabaseClusters(): ClusterEntry[] {
  return listClusters(dbRoot())
}

/** Delete stopped clusters other than the active one (`box db prune`). Offline. */
export function pruneDatabaseClusters(): Promise<string[]> {
  return pruneClusters(dbRoot())
}

/** Builder backups: a database restore point at `dir` (its parent must exist), from the
 *  supervisor-owned cluster, online. */
export async function dumpRestorePointTo(running: { socket: string; port: number; cluster: { name: string; dir: string; port: number } }, dir: string): Promise<void> {
  await takeRestorePoint({ target: running, parent: dirname(dir), name: basename(dir), label: 'manual',
    source: { cluster: running.cluster.name, identity: readIdentity(running.cluster) } })
}

/** Builder restores: the database from `point` and the staged instance files and root config,
 *  committed under one operation journal. The caller has released the cluster. */
export function restoreBuilderDatabase(input: { point: string; engine: 'pgrust' | 'native'; stageFiles: (id: string) => FileSwap[] }): Promise<RestoreResult> {
  return restoreDatabase(dbRoot(), { point: input.point, engine: input.engine, resolveEngine, stageFiles: input.stageFiles, identityFromBackup: true })
}
