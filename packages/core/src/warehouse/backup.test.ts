// Backup and restore against a throwaway instance dir: the retention policy (pure, table-driven),
// the on-disk prune, a local-only backup, and the restore round trip that the schema gate's
// relaxation depends on. The migration-path snapshot itself is covered by schema-upgrade.test.ts.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { warehousePath } from '../io.js'
import { holdWarehouseOpen, resetInstanceDir, setInstanceDir } from '../testing.js'
import { withRead, withWrite } from './db.js'
import { backupWarehouse, listRestorePoints, uploadDirToGcs, parseBackupName, planRetention, pruneBackups, restoreWarehouse } from './backup.js'
import { backupName, type BackupLabel, type RestorePoint } from './restore-points.js'
import { snapshotBeforeMigration } from './migration-snapshot.js'
import type { MigrationConn } from './schema.js'

// Restores replace the database file under the process, so this file keeps the real per-call open.
holdWarehouseOpen(false)

const NOW = new Date('2026-09-17T12:00:00.000Z')
const at = (iso: string): Date => new Date(iso)
const hours = (n: number): Date => new Date(NOW.getTime() - n * 3600_000)
const days = (n: number): Date => hours(n * 24)
// For listings that mix stamped names with real mtimes, measure from the real clock instead.
const agoHours = (n: number): Date => new Date(Date.now() - n * 3600_000)

const point = (label: RestorePoint['label'], takenAt: Date, name = `${label}-${takenAt.toISOString()}`): RestorePoint =>
  ({ name, path: `/x/${name}.db`, label, takenAt, bytes: 1 })

describe('parseBackupName', () => {
  it('recovers the label and the instant from the stamp, with or without a suffix', () => {
    expect(parseBackupName('manual-2026-09-17t10-22-03-114z')).toEqual({ label: 'manual', takenAt: at('2026-09-17T10:22:03.114Z') })
    expect(parseBackupName('manual-2026-09-17t10-22-03-114z-3f9a1c2b')).toEqual({ label: 'manual', takenAt: at('2026-09-17T10:22:03.114Z') })
    expect(parseBackupName('pre-migrate-2026-09-17t10-22-03-114z-0d1b1b5c-4a56-4d3a-9d0f-1e7d3c2b1a00'))
      .toEqual({ label: 'pre-migrate', takenAt: at('2026-09-17T10:22:03.114Z') })
    expect(parseBackupName('pre-restore-2026-01-31t23-59-59-999z-ab')).toEqual({ label: 'pre-restore', takenAt: at('2026-01-31T23:59:59.999Z') })
  })

  it('keeps the label but no instant for an unreadable stamp, and rejects unlabelled names', () => {
    expect(parseBackupName('manual-yesterday')).toEqual({ label: 'manual', takenAt: null })
    expect(parseBackupName('manual')).toEqual({ label: 'manual', takenAt: null })
    expect(parseBackupName('manual-2026-13-45t99-99-99-999z')).toEqual({ label: 'manual', takenAt: null })
    expect(parseBackupName('baseline')).toBeNull()
    expect(parseBackupName('manually-2026-09-17t10-22-03-114z')).toBeNull()
  })

  it('round-trips the names this module writes', () => {
    for (const label of ['manual', 'pre-migrate', 'pre-restore'] as const) {
      const parsed = parseBackupName(backupName(label, NOW))
      expect(parsed).toEqual({ label, takenAt: NOW })
    }
  })
})

describe('planRetention', () => {
  // now = 2026-09-17T12:00Z (a Thursday in ISO week 38; W37 = 09-07..09-13, W36 = 08-31..09-06,
  // W35 = 08-24..08-30). Each row says which rule keeps it, or why it goes.
  const table: { label: BackupLabel; name: string; takenAt: Date; keep: boolean; why: string }[] = [
    { label: 'manual', name: 'a', takenAt: at('2026-09-17T11:00:00Z'), keep: true, why: 'inside 24h' },
    { label: 'manual', name: 'b', takenAt: at('2026-09-17T00:30:00Z'), keep: true, why: 'inside 24h' },
    { label: 'manual', name: 'c', takenAt: at('2026-09-16T13:00:00Z'), keep: true, why: 'inside 24h (23h old)' },
    { label: 'manual', name: 'd', takenAt: at('2026-09-16T11:00:00Z'), keep: false, why: '25h old; 09-16 already has c' },
    { label: 'manual', name: 'e', takenAt: at('2026-09-15T20:00:00Z'), keep: true, why: 'newest of 09-15' },
    { label: 'manual', name: 'f', takenAt: at('2026-09-15T08:00:00Z'), keep: false, why: '09-15 already has e' },
    { label: 'manual', name: 'g', takenAt: at('2026-09-11T09:00:00Z'), keep: true, why: 'newest of 09-11 (6d3h old)' },
    { label: 'manual', name: 'h', takenAt: at('2026-09-10T13:00:00Z'), keep: true, why: 'newest of 09-10 (6d23h old)' },
    { label: 'manual', name: 'i', takenAt: at('2026-09-10T11:00:00Z'), keep: false, why: '7d1h old; W37 already has g' },
    { label: 'manual', name: 'j', takenAt: at('2026-09-05T10:00:00Z'), keep: true, why: 'newest of W36' },
    { label: 'manual', name: 'k', takenAt: at('2026-09-01T10:00:00Z'), keep: false, why: 'W36 already has j' },
    { label: 'manual', name: 'l', takenAt: at('2026-08-25T10:00:00Z'), keep: true, why: 'newest of W35 (23d old)' },
    { label: 'manual', name: 'm', takenAt: at('2026-08-20T10:00:00Z'), keep: false, why: '28d2h old: past the weekly window' },
    { label: 'manual', name: 'n', takenAt: at('2026-07-01T10:00:00Z'), keep: false, why: 'ancient' },
    { label: 'pre-migrate', name: 'lone', takenAt: at('2026-01-01T00:00:00Z'), keep: true, why: 'the newest of its label, whatever its age' },
    { label: 'pre-restore', name: 'p1', takenAt: at('2026-08-01T00:00:00Z'), keep: true, why: 'newest of its label' },
    { label: 'pre-restore', name: 'p2', takenAt: at('2026-07-01T00:00:00Z'), keep: false, why: 'older than p1 and past every window' },
  ]

  it('keeps exactly the generational set per label', () => {
    const points = [...table].reverse().map((row) => point(row.label, row.takenAt, row.name)) // order must not matter
    const plan = planRetention(points, NOW)
    const kept = new Set(plan.keep.map((p) => p.name))
    const removed = new Set(plan.remove.map((p) => p.name))
    for (const row of table) {
      expect(kept.has(row.name), `${row.name}: ${row.why}`).toBe(row.keep)
      expect(removed.has(row.name), `${row.name}: ${row.why}`).toBe(!row.keep)
    }
    expect(plan.keep.length + plan.remove.length).toBe(table.length)
  })

  it('never lists a seed for removal', () => {
    const plan = planRetention([point('seed', at('2020-01-01T00:00:00Z'), 'baseline'), point('manual', days(400), 'old')], NOW)
    expect(plan.remove.map((p) => p.name)).toEqual([])
    expect(plan.keep.map((p) => p.name).sort()).toEqual(['baseline', 'old'])
  })

  it('treats the 24-hour and 28-day edges as exclusive', () => {
    const inside = point('manual', hours(23.99), 'inside')
    const newest = point('manual', hours(1), 'newest')
    const edge = point('manual', hours(24), 'edge')
    expect(planRetention([newest, inside, edge], NOW).remove.map((p) => p.name)).toEqual(['edge']) // same UTC day as inside, older
    const weekEdge = point('manual', days(28), 'week-edge')
    expect(planRetention([newest, weekEdge], NOW).remove.map((p) => p.name)).toEqual(['week-edge'])
  })
})

describe('on disk', () => {
  let dir: string
  let previousBucket: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'box-backup-test-')) // outside the checkout: an interrupted run must not leave a fake instance in it
    setInstanceDir(dir) // no box.json there, so backup.gcsBucket is null and never uploads either
    previousBucket = process.env.GCS_BUCKET
    delete process.env.GCS_BUCKET // the checkout's .env may name a real bucket; never upload from a test
  })
  afterEach(() => {
    resetInstanceDir()
    if (previousBucket !== undefined) process.env.GCS_BUCKET = previousBucket
    rmSync(dir, { recursive: true, force: true })
  })

  const touch = (sub: string, name: string, wal = false): string => {
    mkdirSync(join(dir, sub), { recursive: true })
    writeFileSync(join(dir, sub, `${name}.db`), 'db')
    if (wal) writeFileSync(join(dir, sub, `${name}.db.wal`), 'wal')
    return name
  }
  const files = (sub: string): string[] => (existsSync(join(dir, sub)) ? readdirSync(join(dir, sub)).sort() : [])
  const ids = async (): Promise<number[]> => (await withRead<{ id: number }>('SELECT id FROM t ORDER BY id')).map((r) => r.id)
  const rowsIn = async (file: string, sql: string): Promise<Record<string, unknown>[]> => {
    const instance = await DuckDBInstance.create(file, { access_mode: 'read_only' })
    const conn = await instance.connect()
    try { return (await conn.runAndReadAll(sql)).getRowObjectsJson() } finally { conn.disconnectSync(); instance.closeSync() }
  }

  it('pruneBackups removes a backup with its WAL, ignores what it did not write, and never reads seeds/', () => {
    const keepManual = touch('backups', backupName('manual', hours(1)))
    const oldManual = touch('backups', backupName('manual', days(40)), true)
    const lonePreMigrate = touch('backups', backupName('pre-migrate', days(90)))
    touch('backups', 'random')
    touch('seeds', 'baseline')
    touch('seeds', backupName('pre-migrate', days(400)), true) // a legacy leak in seeds/ is the human's to remove
    const seedsBefore = files('seeds')

    const result = pruneBackups({ now: NOW })

    expect(result).toEqual({ removed: [oldManual], kept: 2 })
    expect(files('backups')).toEqual([`${keepManual}.db`, `${lonePreMigrate}.db`, 'random.db'])
    expect(files('seeds')).toEqual(seedsBefore)
    expect(pruneBackups({ now: NOW })).toEqual({ removed: [], kept: 2 })
  })

  it('listRestorePoints covers both directories newest first, seeds by mtime, bytes including the WAL', () => {
    touch('backups', backupName('manual', agoHours(2)))
    touch('backups', backupName('pre-migrate', agoHours(72)), true)
    touch('backups', 'random')
    touch('seeds', 'baseline')
    const points = listRestorePoints()
    expect(points.map((p) => p.label)).toEqual(['seed', 'manual', 'pre-migrate']) // the seed's mtime is now
    expect(points.find((p) => p.label === 'pre-migrate')?.bytes).toBe(5)
    expect(points.find((p) => p.label === 'manual')?.bytes).toBe(2)
    expect(points.find((p) => p.name === 'baseline')?.path).toBe(join(dir, 'seeds', 'baseline.db'))
  })

  it('takes a local-only backup with no GCS_BUCKET, and the copy holds the committed rows', async () => {
    await withWrite(async (c) => { await c.run('CREATE TABLE t (id INTEGER)'); await c.run('INSERT INTO t VALUES (1), (2), (3)') })
    const result = await backupWarehouse()
    expect(result.dryRun).toBe(false)
    expect(result.bucket).toBeNull()
    expect(result.snapshot).toBeNull()
    expect(result.summary).toMatch(/local only/)
    expect(result.local?.label).toBe('manual')
    expect(result.local?.path).toBe(join(dir, 'backups', `${result.local?.name}.db`))
    expect(statSync(result.local!.path).size).toBe(statSync(warehousePath()).size)
    expect(result.local?.bytes).toBe(statSync(result.local!.path).size)
    expect(existsSync(`${result.local!.path}.wal`)).toBe(false)
    expect(await rowsIn(result.local!.path, 'SELECT count(*)::INTEGER AS n FROM t')).toEqual([{ n: 3 }])
    expect(listRestorePoints().map((p) => p.name)).toEqual([result.local!.name])
    // Two backups in one process get distinct names and both survive retention (inside 24h).
    const second = await backupWarehouse({ label: 'manual' })
    expect(second.local!.name).not.toBe(result.local!.name)
    expect(files('backups').filter((f) => f.endsWith('.db'))).toHaveLength(2)
    // Each restore point carries the agent files (none here: an empty map) beside it.
    expect(files('backups').filter((f) => f.endsWith('.agents.json'))).toHaveLength(2)
  })

  it('a dry run writes nothing and a missing warehouse is refused', async () => {
    const dry = await backupWarehouse({ dryRun: true })
    expect(dry).toMatchObject({ local: null, bucket: null, snapshot: null, dryRun: true })
    expect(dry.summary).toMatch(/^dry run - would write backups\/manual-/)
    expect(existsSync(join(dir, 'backups'))).toBe(false)
    await expect(backupWarehouse()).rejects.toThrow(/no warehouse at/)
    expect(existsSync(warehousePath())).toBe(false)
    await expect(backupWarehouse({ remote: true })).rejects.toThrow(/no bucket: set backup.gcsBucket in box.json/)
  })

  it('restores a backup over the live warehouse, parks the previous state, and the parked copy restores too', async () => {
    await withWrite(async (c) => { await c.run('CREATE TABLE t (id INTEGER)'); await c.run('INSERT INTO t VALUES (1), (2), (3)') })
    const backup = (await backupWarehouse()).local!
    await withWrite((c) => c.run('DELETE FROM t WHERE id = 3'))
    expect(await ids()).toEqual([1, 2])

    const first = await restoreWarehouse(backup.name)
    expect(await ids()).toEqual([1, 2, 3])
    expect(first.from.name).toBe(backup.name)
    expect(first.parked?.startsWith(join(dir, 'backups', 'pre-restore-'))).toBe(true)
    expect(first.summary).toMatch(/restored .* over .*data\.db; the previous warehouse is parked as backups\/pre-restore-/)
    expect(first.summary).toMatch(/restart a long-lived server/)
    expect(existsSync(`${warehousePath()}.wal`)).toBe(false)
    expect(readdirSync(dir).filter((f) => f.startsWith('data.db.restoring-'))).toEqual([])

    const parkedName = basename(first.parked!, '.db')
    expect(listRestorePoints().map((p) => p.name).sort()).toEqual([backup.name, parkedName].sort())
    const second = await restoreWarehouse(parkedName)
    expect(await ids()).toEqual([1, 2])
    expect(second.from.label).toBe('pre-restore')
    expect(second.parked).not.toBe(first.parked)
    expect(files('backups').filter((f) => f.endsWith('.db'))).toHaveLength(3)
    expect(files('backups').filter((f) => f.endsWith('.agents.json'))).toHaveLength(3)
    // The live file keeps working as a writer after two swaps.
    await withWrite((c) => c.run('INSERT INTO t VALUES (9)'))
    expect(await ids()).toEqual([1, 2, 9])
  })

  it('restores a human-named seed, including one that still carries a WAL', async () => {
    await withWrite(async (c) => { await c.run('CREATE TABLE t (id INTEGER)'); await c.run('INSERT INTO t VALUES (1)') })
    // Build a seed the way an interrupted external writer would leave it: rows in the WAL only.
    const seed = join(dir, 'seeds', 'wal-seed.db')
    mkdirSync(join(dir, 'seeds'), { recursive: true })
    {
      const instance = await DuckDBInstance.create(seed, { access_mode: 'read_write' })
      const conn = await instance.connect()
      await conn.run('CREATE TABLE t (id INTEGER)')
      await conn.run('CHECKPOINT')
      await conn.run('INSERT INTO t VALUES (7), (8)')
      expect(statSync(`${seed}.wal`).size).toBeGreaterThan(0)
      // Copy db + WAL out from under the open writer, then let it close (which would fold the WAL).
      writeFileSync(join(dir, 'seeds', 'captured.db'), readFileSync(seed))
      writeFileSync(join(dir, 'seeds', 'captured.db.wal'), readFileSync(`${seed}.wal`))
      conn.disconnectSync()
      instance.closeSync()
    }
    const restored = await restoreWarehouse('captured')
    expect(restored.from.label).toBe('seed')
    expect(await ids()).toEqual([7, 8])
    expect(existsSync(`${warehousePath()}.wal`)).toBe(false)
    expect(files('seeds')).toEqual(['captured.db', 'captured.db.wal', 'wal-seed.db']) // seeds are read, never changed
  })

  it('refuses a name that is not a restore point, and a file that is not a database, leaving the warehouse alone', async () => {
    await withWrite(async (c) => { await c.run('CREATE TABLE t (id INTEGER)'); await c.run('INSERT INTO t VALUES (1)') })
    await expect(restoreWarehouse('nope')).rejects.toThrow(/"nope" is not a restore point/)
    touch('seeds', 'garbage')
    await expect(restoreWarehouse('garbage')).rejects.toThrow(/restore point garbage could not be staged/)
    expect(await ids()).toEqual([1])
    expect(files('backups')).toEqual([]) // nothing was parked: staging failed before the live file was touched
    expect(readdirSync(dir).filter((f) => f.startsWith('data.db.restoring-'))).toEqual([])
    touch('backups', 'manual-2026-09-17t10-22-03-114z')
    touch('seeds', 'manual-2026-09-17t10-22-03-114z')
    await expect(restoreWarehouse('manual-2026-09-17t10-22-03-114z')).rejects.toThrow(/is ambiguous/)
  })

  it('snapshotBeforeMigration writes a pre-migrate backup and prunes without ever failing the caller', async () => {
    await withWrite(async (c) => { await c.run('CREATE TABLE t (id INTEGER)'); await c.run('INSERT INTO t VALUES (1)') })
    const stale = touch('backups', backupName('pre-migrate', days(60)), true)
    const older = touch('backups', backupName('pre-migrate', days(61)))
    const path = await withWrite((c) => snapshotBeforeMigration(c as unknown as MigrationConn, warehousePath()))
    expect(path.startsWith(join(dir, 'backups', 'pre-migrate-'))).toBe(true)
    expect(await rowsIn(path, 'SELECT id FROM t')).toEqual([{ id: 1 }])
    // stale and older fell to retention: the fresh one is the label's newest, with its agent files.
    expect(files('backups')).toEqual([basename(path).replace(/\.db$/, '.agents.json'), basename(path)])
    expect(files('backups')).not.toContain(`${stale}.db.wal`)
    expect(files('backups')).not.toContain(`${older}.db`)
  })
})

describe('uploadDirToGcs', () => {
  it('fails on a missing or empty directory before calling gsutil', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'box-mirror-'))
    try {
      await expect(uploadDirToGcs(join(dir, 'absent'), 'gs://nowhere', 'x')).rejects.toThrow(/missing or empty/)
      await expect(uploadDirToGcs(dir, 'gs://nowhere', 'x')).rejects.toThrow(/missing or empty/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
