// The on-disk store of database restore points, and the rules that keep it bounded.
//
// A restore point is a directory (db/restore-point.ts has the format):
//   <instance>/backups/db/<label>-<stamp>-<id>/   machine-written. Retention prunes ONLY here.
//   <instance>/seeds/<name>/                       human-named dev fixtures (`box db snapshot`). Never pruned.
// Each holds box.dump, agents.json and manifest.json, the manifest written last. A directory being
// written is `.staging-<id>` and only its writer or the staging sweep removes it; a directory
// without a valid manifest is listed as damaged and left alone.
//
// No database imports here: listing and retention are plain files.

import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { instanceDir } from '../io.js'

export type BackupLabel = 'pre-migrate' | 'manual' | 'pre-restore' | 'pre-switch'

export const BACKUP_LABELS: readonly BackupLabel[] = ['pre-migrate', 'manual', 'pre-restore', 'pre-switch']

export const MANIFEST_FILE = 'manifest.json'
export const DUMP_FILE = 'box.dump'
export const AGENTS_FILE = 'agents.json'
export const STAGING_PREFIX = '.staging-'

export interface RestorePoint {
  /** Directory name, e.g. `manual-2026-09-17t10-22-03-114z-3f9a1c2b`. Unique across both directories. */
  name: string
  /** Absolute path of the restore point's directory. */
  path: string
  /** The backup label, or `seed` for anything in `seeds/` regardless of its name. */
  label: BackupLabel | 'seed'
  /** From the manifest; the name's stamp or the directory's mtime when it has none. */
  takenAt: Date
  /** Bytes on disk (dump plus sidecars). */
  bytes: number
  /** Why this directory is not restorable (no or unreadable manifest), when it is not. */
  damaged?: string
}

/** Machine-written database restore points. */
export function backupsDir(instance = instanceDir()): string {
  return join(instance, 'backups', 'db')
}

export function seedsDir(instance = instanceDir()): string {
  return join(instance, 'seeds')
}

// `2026-09-17T10:22:03.114Z` -> `2026-09-17t10-22-03-114z`: the ISO instant with every
// non-alphanumeric replaced, so names sort lexicographically by time. The trailing id keeps two
// restore points in the same millisecond from colliding.
const STAMP = /^(\d{4})-(\d{2})-(\d{2})t(\d{2})-(\d{2})-(\d{2})-(\d{3})z(?:-[0-9a-f-]+)?$/
const LABEL = /^(pre-migrate|pre-restore|pre-switch|manual)(?:-(.*))?$/

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

/** Valid restore-point and seed names: lower-case words joined by hyphens. */
export const POINT_NAME = /^[a-z0-9][a-z0-9-]{0,127}$/

function dirBytes(dir: string): number {
  let total = 0
  for (const f of [DUMP_FILE, AGENTS_FILE, MANIFEST_FILE]) {
    const p = join(dir, f)
    if (existsSync(p)) total += statSync(p).size
  }
  return total
}

function manifestTakenAt(dir: string): { takenAt: Date } | { damaged: string } {
  const f = join(dir, MANIFEST_FILE)
  if (!existsSync(f)) return { damaged: 'no manifest.json (an interrupted or foreign directory)' }
  try {
    const m = JSON.parse(readFileSync(f, 'utf8')) as { takenAt?: unknown }
    const at = typeof m.takenAt === 'string' ? new Date(m.takenAt) : null
    if (!at || Number.isNaN(at.getTime())) return { damaged: 'manifest.json has no takenAt' }
    return { takenAt: at }
  } catch (e) {
    return { damaged: `manifest.json is unreadable: ${(e as Error).message}` }
  }
}

function readDir(dir: string, kind: 'backups' | 'seeds'): RestorePoint[] {
  if (!existsSync(dir)) return []
  const out: RestorePoint[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.') || !POINT_NAME.test(e.name)) continue
    const path = join(dir, e.name)
    const parsed = parseBackupName(e.name)
    // Only names this module wrote are restore points in backups/: anything else there is neither
    // listed nor pruned. Anything a human puts into seeds/ is a seed, whatever its name.
    if (kind === 'backups' && !parsed) continue
    const m = manifestTakenAt(path)
    out.push({
      name: e.name,
      path,
      label: kind === 'seeds' ? 'seed' : parsed!.label,
      takenAt: 'takenAt' in m ? m.takenAt : parsed?.takenAt ?? statSync(path).mtime,
      bytes: dirBytes(path),
      ...('damaged' in m ? { damaged: m.damaged } : {}),
    })
  }
  return out
}

function newestFirst(a: RestorePoint, b: RestorePoint): number {
  return b.takenAt.getTime() - a.takenAt.getTime() || b.name.localeCompare(a.name)
}

/** Every restore point in `backups/db/` and `seeds/`, newest first (damaged ones included, marked). */
export function listRestorePoints(instance = instanceDir()): RestorePoint[] {
  settleSeedReplacements(instance)
  return [...readDir(backupsDir(instance), 'backups'), ...readDir(seedsDir(instance), 'seeds')].sort(newestFirst)
}

/** The one restorable point called `name`. Throws when there is none, it is damaged, or both directories have one. */
export function findRestorePoint(name: string, instance = instanceDir()): RestorePoint {
  const matches = listRestorePoints(instance).filter((point) => point.name === name)
  if (matches.length > 1) {
    throw new Error(`"${name}" is ambiguous: ${matches.map((point) => point.path).join(' and ')}. Rename one.`)
  }
  const [point] = matches
  if (!point) throw new Error(`"${name}" is not a restore point: nothing called ${name} in ${backupsDir(instance)} or ${seedsDir(instance)}`)
  if (point.damaged) throw new Error(`${name} is damaged: ${point.damaged}`)
  return point
}

/** Upload pins: `backups/db/.upload-<name>.json` while a process uploads that restore point. */
export const UPLOAD_PIN_PREFIX = '.upload-'
/** An upload is cancelled after this long (the uploader's timeout); a pin older than it is stale. */
export const UPLOAD_MAX_MS = 6 * 60 * 60 * 1000

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
}

/** Restore points being uploaded by a live process within the upload time limit. */
function uploadPins(instance: string, now = Date.now()): { live: Set<string>; stale: string[] } {
  const dir = backupsDir(instance)
  const live = new Set<string>(), stale: string[] = []
  if (!existsSync(dir)) return { live, stale }
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(UPLOAD_PIN_PREFIX) || !f.endsWith('.json')) continue
    const name = f.slice(UPLOAD_PIN_PREFIX.length, -'.json'.length)
    try {
      const pin = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { pid?: unknown; since?: unknown }
      const since = typeof pin.since === 'string' ? Date.parse(pin.since) : NaN
      if (typeof pin.pid === 'number' && pidAlive(pin.pid) && now - since < UPLOAD_MAX_MS) live.add(name)
      else stale.push(join(dir, f))
    } catch {
      // Being written right now (or damaged): keep its point this round.
      live.add(name)
    }
  }
  return { live, stale }
}

/** Restore points never pruned now: those a maintenance journal names (data/db/switch.json) and
 *  those a live process is uploading. */
export function pinnedRestorePoints(instance = instanceDir()): Set<string> {
  const pins = uploadPins(instance).live
  const f = join(instance, 'db', 'switch.json')
  if (!existsSync(f)) return pins
  try {
    const j = JSON.parse(readFileSync(f, 'utf8')) as { pins?: unknown }
    for (const p of Array.isArray(j.pins) ? j.pins : []) if (typeof p === 'string') pins.add(p)
    return pins
  } catch {
    // An unreadable journal pins everything: recovery decides, not retention.
    return new Set(listRestorePoints(instance).map((p) => p.name))
  }
}

// --- seed replacement -----------------------------------------------------------------------------
// `box db snapshot <name>` over an existing seed takes the new one first, then swaps: the old seed
// is renamed to `.replaced-<name>-<id>`, the new one into place, and the old one removed. A crash
// between the two renames leaves only the old copy under its hidden name; this puts it back.

export const REPLACED_PREFIX = '.replaced-'

export function settleSeedReplacements(instance = instanceDir()): void {
  const dir = seedsDir(instance)
  if (!existsSync(dir)) return
  for (const f of readdirSync(dir)) {
    if (!f.startsWith(REPLACED_PREFIX)) continue
    const name = f.slice(REPLACED_PREFIX.length).replace(/-[0-9a-f]{8}$/, '')
    const path = join(dir, f)
    if (POINT_NAME.test(name) && !existsSync(join(dir, name))) renameSync(path, join(dir, name))
    else rmSync(path, { recursive: true, force: true })
  }
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
 * Seeds and damaged directories are never candidates. Pure: no filesystem access.
 */
export function planRetention(points: readonly RestorePoint[], now = new Date()): RetentionPlan {
  const keep = new Set<RestorePoint>()
  const candidates = points.filter((point) => point.label !== 'seed' && !point.damaged)
  for (const label of BACKUP_LABELS) {
    const group = candidates.filter((point) => point.label === label).sort(newestFirst)
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
  const removable = (point: RestorePoint) => candidates.includes(point) && !keep.has(point)
  return {
    keep: points.filter((point) => !removable(point)),
    remove: points.filter(removable),
  }
}

/** Abandoned `.staging-*` directories older than this are swept (their writer is gone). */
const STAGING_MAX_AGE = DAY

/**
 * Apply the retention plan to `backups/db/`. Never reads `seeds/`; never removes a pinned or
 * damaged restore point. Also sweeps this module's own abandoned staging directories. A directory
 * that cannot be removed is reported after the others have been tried.
 */
export function pruneBackups(opts: { now?: Date; instance?: string; pinned?: ReadonlySet<string> } = {}): { removed: string[]; kept: number } {
  const instance = opts.instance ?? instanceDir()
  const now = opts.now ?? new Date()
  const dir = backupsDir(instance)
  const pinned = opts.pinned ?? pinnedRestorePoints(instance)
  const points = readDir(dir, 'backups')
  const plan = planRetention(points.filter((point) => !pinned.has(point.name)), now)
  const removed: string[] = []
  const failed: string[] = []
  for (const point of plan.remove) {
    try {
      rmSync(point.path, { recursive: true, force: true })
      removed.push(point.name)
    } catch (error) {
      failed.push(`${basename(point.path)}: ${String((error as Error)?.message ?? error)}`)
    }
  }
  for (const f of uploadPins(instance, now.getTime()).stale) rmSync(f, { force: true })
  if (existsSync(dir)) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || !e.name.startsWith(STAGING_PREFIX)) continue
      const path = join(dir, e.name)
      if (now.getTime() - statSync(path).mtime.getTime() > STAGING_MAX_AGE) rmSync(path, { recursive: true, force: true })
    }
  }
  if (failed.length) throw new Error(`could not remove ${failed.length} backup(s): ${failed.join('; ')}`)
  return { removed, kept: points.length - removed.length }
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
