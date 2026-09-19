// The on-disk store of warehouse restore points, and the rules that keep it bounded.
//
// Two directories under the instance dir, with different owners:
//   <instance>/backups/   machine-written: `<label>-<stamp>-<id>.db`. Retention prunes ONLY here.
//   <instance>/seeds/     human-named dev fixtures (`box db snapshot baseline`). Never pruned.
//
// This module deliberately does not import warehouse/db.ts: schema.ts -> migration-snapshot.ts
// reaches it from inside the migration write lock, and db.ts already sits in a cycle with schema.ts.
// The lock-taking entry points (backupWarehouse, restoreWarehouse) live in backup.ts.

import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { instanceDir } from '../io.js'

export type BackupLabel = 'pre-migrate' | 'manual' | 'pre-restore'

export const BACKUP_LABELS: readonly BackupLabel[] = ['pre-migrate', 'manual', 'pre-restore']

export interface RestorePoint {
  /** File name without `.db`, e.g. `manual-2026-09-17t10-22-03-114z-3f9a1c2b`. Unique across both directories. */
  name: string
  /** Absolute path of the `.db` file. */
  path: string
  /** The backup label, or `seed` for anything in `seeds/` regardless of its name. */
  label: BackupLabel | 'seed'
  /** Parsed from the name's stamp segment; the file's mtime when the name carries no stamp. */
  takenAt: Date
  /** Size of the `.db` file PLUS its `.wal` sidecar when one exists - what a restore would read. */
  bytes: number
}

/** The slice of a DuckDB connection the copy needs: enough to run `CHECKPOINT`. */
export interface CheckpointConn {
  run(sql: string): Promise<unknown>
}

export function backupsDir(instance = instanceDir()): string {
  return join(instance, 'backups')
}

export function seedsDir(instance = instanceDir()): string {
  return join(instance, 'seeds')
}

// `2026-09-17T10:22:03.114Z` -> `2026-09-17t10-22-03-114z`: the ISO instant with every
// non-alphanumeric replaced, so names sort lexicographically by time. The trailing id keeps two
// copies in the same millisecond (or a clock that stepped backwards) from colliding under
// COPYFILE_EXCL; the parser ignores it, and also accepts the full UUID older snapshots carried.
const STAMP = /^(\d{4})-(\d{2})-(\d{2})t(\d{2})-(\d{2})-(\d{2})-(\d{3})z(?:-[0-9a-f-]+)?$/
const LABEL = /^(pre-migrate|pre-restore|manual)(?:-(.*))?$/

export function backupStamp(now: Date): string {
  return now.toISOString().replace(/[^0-9a-z]/gi, '-').toLowerCase()
}

export function backupName(label: BackupLabel, now = new Date()): string {
  return `${label}-${backupStamp(now)}-${randomUUID().slice(0, 8)}`
}

/** `{ label, takenAt }` for a machine-written name; `takenAt` is null when the stamp is unreadable. */
export function parseBackupName(name: string): { label: BackupLabel; takenAt: Date | null } | null {
  const m = LABEL.exec(name)
  if (!m) return null
  const label = m[1] as BackupLabel
  const stamp = m[2] ? STAMP.exec(m[2]) : null
  if (!stamp) return { label, takenAt: null }
  const [y, mo, d, h, mi, s, ms] = stamp.slice(1, 8)
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`
  const takenAt = new Date(iso)
  // Date would roll month 13 into the next year; only a stamp that reads back as itself counts.
  return Number.isNaN(takenAt.getTime()) || takenAt.toISOString() !== iso ? { label, takenAt: null } : { label, takenAt }
}

function sidecar(dbPath: string): string {
  return `${dbPath}.wal`
}

function sizeOf(file: string): number {
  return existsSync(file) ? statSync(file).size : 0
}

function readDir(dir: string, kind: 'backups' | 'seeds'): RestorePoint[] {
  if (!existsSync(dir)) return []
  const out: RestorePoint[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.db')) continue
    const path = join(dir, file)
    if (!statSync(path).isFile()) continue
    const name = file.slice(0, -'.db'.length)
    const parsed = parseBackupName(name)
    // Only names this module wrote are restore points in backups/: an unlabelled file there is
    // neither listed nor pruned. Anything a human drops into seeds/ is a seed, whatever its name.
    if (kind === 'backups' && !parsed) continue
    out.push({
      name,
      path,
      label: kind === 'seeds' ? 'seed' : parsed!.label,
      takenAt: parsed?.takenAt ?? statSync(path).mtime,
      bytes: sizeOf(path) + sizeOf(sidecar(path)),
    })
  }
  return out
}

function newestFirst(a: RestorePoint, b: RestorePoint): number {
  return b.takenAt.getTime() - a.takenAt.getTime() || b.name.localeCompare(a.name)
}

/** Every restore point in `backups/` and `seeds/`, newest first. */
export function listRestorePoints(instance = instanceDir()): RestorePoint[] {
  return [...readDir(backupsDir(instance), 'backups'), ...readDir(seedsDir(instance), 'seeds')].sort(newestFirst)
}

/** The one restore point called `name`. Throws when there is none, or when both directories have one. */
export function findRestorePoint(name: string, instance = instanceDir()): RestorePoint {
  const matches = listRestorePoints(instance).filter((point) => point.name === name)
  if (matches.length === 1) return matches[0]!
  if (matches.length > 1) {
    throw new Error(`"${name}" is ambiguous: ${matches.map((point) => point.path).join(' and ')}. Rename one.`)
  }
  throw new Error(
    `"${name}" is not a restore point: nothing called ${name}.db in ${backupsDir(instance)} or ${seedsDir(instance)}`,
  )
}

/**
 * Copy the warehouse into `backups/` while the caller HOLDS the read-write connection.
 *
 * Why the copy happens inside the held connection rather than after it closes: DuckDB allows one
 * writer per file across processes, and db.ts opens connections ephemerally, so the moment a
 * connection closes any other process (or the next in-process write) can open the file and write.
 * Holding the connection is the only window in which no writer can interleave. Inside it,
 * `CHECKPOINT` folds the WAL into the main file and REMOVES the sidecar (verified 2026-09-17 on
 * @duckdb/node-api 1.5.4: `data.db.wal` is deleted, not truncated), fsyncs, and then nothing writes
 * to the file again until the next statement - DuckDB has no background writer. Reading the file
 * through a second descriptor while DuckDB holds its own is ordinary POSIX; the bytes are the
 * committed state. The migration snapshot has copied this way since it existed; the manual backup
 * and the restore's parking step use this same helper so there is one consistency rule.
 */
export async function copyWarehouseUnderLock(
  conn: CheckpointConn,
  source: string,
  label: BackupLabel,
  now = new Date(),
): Promise<RestorePoint> {
  const dir = backupsDir(dirname(source))
  const name = backupName(label, now)
  const target = join(dir, `${name}.db`)
  try {
    await conn.run('CHECKPOINT')
    mkdirSync(dir, { recursive: true })
    copyFileSync(source, target, constants.COPYFILE_EXCL)
    // Absent after CHECKPOINT on the DuckDB build this was verified on; copied if a build ever
    // truncates instead, because a WAL is part of the database.
    if (existsSync(sidecar(source))) copyFileSync(sidecar(source), sidecar(target), constants.COPYFILE_EXCL)
    const expected = statSync(source).size
    const actual = statSync(target).size
    if (expected === 0) throw new Error(`${source} is empty`)
    if (actual !== expected) throw new Error(`copied ${actual} of ${expected} bytes from ${source}`)
  } catch (error) {
    for (const file of [target, sidecar(target)]) {
      try { rmSync(file, { force: true }) } catch { /* Preserve the copy failure. */ }
    }
    throw new Error(`warehouse backup (${label}) failed: ${String((error as Error)?.message ?? error)}`, { cause: error })
  }
  return { name, path: target, label, takenAt: now, bytes: sizeOf(target) + sizeOf(sidecar(target)) }
}

// --- retention ------------------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** Rolling windows, measured back from `now`. */
export const RETENTION = {
  /** Everything younger than this is kept. */
  everything: DAY,
  /** Younger than this: the newest of each UTC calendar day is kept. */
  daily: 7 * DAY,
  /** Younger than this: the newest of each ISO week is kept. */
  weekly: 28 * DAY,
} as const

function utcDayKey(at: Date): string {
  return at.toISOString().slice(0, 10)
}

function isoWeekKey(at: Date): string {
  const date = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  const weekday = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - weekday) // the Thursday decides the ISO year
  const isoYear = date.getUTCFullYear()
  const week = Math.ceil(((date.getTime() - Date.UTC(isoYear, 0, 1)) / DAY + 1) / 7)
  return `${isoYear}-W${String(week).padStart(2, '0')}`
}

export interface RetentionPlan {
  keep: RestorePoint[]
  remove: RestorePoint[]
}

/**
 * Generational retention, decided independently per label. A backup is kept when ANY rule holds:
 *   1. it is younger than 24 hours;
 *   2. it is younger than 7 days and the newest of its UTC calendar day for that label;
 *   3. it is younger than 28 days and the newest of its ISO week for that label;
 *   4. it is the newest backup of its label, whatever its age.
 * "Newest of its day/week" counts every backup of the label, so a day whose newest copy is inside
 * the 24-hour window keeps no second copy: the window graduates a day to one copy as it ages.
 * Seeds are never candidates. Pure: no filesystem access.
 */
export function planRetention(points: readonly RestorePoint[], now = new Date()): RetentionPlan {
  const keep = new Set<RestorePoint>()
  for (const label of BACKUP_LABELS) {
    const group = points.filter((point) => point.label === label).sort(newestFirst)
    if (!group.length) continue
    keep.add(group[0]!)
    const newestOfDay = new Map<string, RestorePoint>()
    const newestOfWeek = new Map<string, RestorePoint>()
    for (const point of group) {
      const age = now.getTime() - point.takenAt.getTime()
      if (age < RETENTION.everything) keep.add(point)
      if (age < RETENTION.daily) {
        const key = utcDayKey(point.takenAt)
        if (!newestOfDay.has(key)) newestOfDay.set(key, point)
      }
      if (age < RETENTION.weekly) {
        const key = isoWeekKey(point.takenAt)
        if (!newestOfWeek.has(key)) newestOfWeek.set(key, point)
      }
    }
    for (const point of newestOfDay.values()) keep.add(point)
    for (const point of newestOfWeek.values()) keep.add(point)
  }
  return {
    keep: points.filter((point) => point.label === 'seed' || keep.has(point)),
    remove: points.filter((point) => point.label !== 'seed' && !keep.has(point)),
  }
}

/**
 * Apply the retention plan to `backups/`. Never reads `seeds/`. Removes each `.db` with its `.wal`
 * sidecar; a file that cannot be removed is reported after the others have been tried.
 */
export function pruneBackups(opts: { now?: Date; instance?: string } = {}): { removed: string[]; kept: number } {
  const points = readDir(backupsDir(opts.instance ?? instanceDir()), 'backups')
  const plan = planRetention(points, opts.now ?? new Date())
  const removed: string[] = []
  const failed: string[] = []
  for (const point of plan.remove) {
    try {
      rmSync(point.path, { force: true })
      rmSync(sidecar(point.path), { force: true })
      removed.push(point.name)
    } catch (error) {
      failed.push(`${basename(point.path)}: ${String((error as Error)?.message ?? error)}`)
    }
  }
  if (failed.length) throw new Error(`could not remove ${failed.length} backup(s): ${failed.join('; ')}`)
  return { removed, kept: plan.keep.length }
}

/** Retention after a successful backup: a full disk is a problem, but never this caller's failure. */
export function pruneBackupsQuietly(instance: string): string[] {
  try {
    return pruneBackups({ instance }).removed
  } catch (error) {
    console.warn(`[backup] retention prune failed: ${String((error as Error)?.message ?? error)}`)
    return []
  }
}
