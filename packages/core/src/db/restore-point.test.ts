// Online restore points on a private test cluster: a physical snapshot taken under concurrent
// writes restores, through backup recovery, every row committed before it stopped; a failed take
// leaves no staging, no backup in progress, no slot and no lock; validation refuses a damaged
// archive and an earlier version's pg_dump restore point.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensureBoxConfig } from '../box-config.js'
import { resetInstanceDir, setInstanceDir } from '../testing.js'
import { SCHEMA_LOCK_KEY } from '../warehouse/pg/migrate.js'
import { clusterOf, clusterPaths, OWNER_LOGIN, openCluster, readIdentity, registerCluster } from './cluster.js'
import { takeRestorePoint, unpackRestorePoint, validateRestorePoint, walSegments } from './restore-point.js'
import { startTestCluster, type TestCluster } from './testing.js'

let dir: string
let tc: TestCluster

function connect(socket: string, port: number, database: string): pg.Client {
  const c = new pg.Client({ host: socket, port, user: OWNER_LOGIN, database })
  c.on('error', () => {})
  return c
}

const target = () => ({ ...tc.running, dataDir: clusterPaths(tc.running.cluster).data })
const source = () => ({ cluster: tc.running.cluster.name, identity: readIdentity(tc.running.cluster) })

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-restore-point-'))
  setInstanceDir(dir)
  ensureBoxConfig()
  tc = await startTestCluster()
  await tc.owner('create database box')
  await tc.owner(`create schema app; create table app.items (id bigint generated always as identity primary key, v text not null)`, 'box')
  await tc.owner(`insert into app.items (v) select 'row ' || g from generate_series(1, 5) g`, 'box')
}, 120_000)

afterAll(async () => {
  await tc?.stop().catch(() => {})
  rmSync(dir, { recursive: true, force: true })
  resetInstanceDir()
})

describe('walSegments', () => {
  it('lists the segments from start to stop across a log id boundary', () => {
    expect(walSegments('0000000100000000000000FE', '000000010000000100000001', 16 * 1024 * 1024))
      .toEqual(['0000000100000000000000FE', '0000000100000000000000FF', '000000010000000100000000', '000000010000000100000001'])
    expect(() => walSegments('000000010000000000000002', '000000020000000000000003', 16 * 1024 * 1024)).toThrow(/timeline/)
  })
})

describe('online restore points', () => {
  it('restores every row committed before the backup stopped, under concurrent writes', async () => {
    const parent = join(dir, 'points')
    const writer = connect(tc.running.socket, tc.running.port, 'box')
    await writer.connect()
    let writing = true
    const loop = (async () => { while (writing) await writer.query(`insert into app.items (v) values ('concurrent')`) })()
    let committedBeforeStop = 0
    const manifest = await takeRestorePoint({
      target: target(), parent, name: 'under-writes', label: 'seed', source: source(),
      beforeStop: async () => {
        await tc.owner(`insert into app.items (v) values ('before stop')`, 'box')
        const c = connect(tc.running.socket, tc.running.port, 'box')
        await c.connect()
        try { committedBeforeStop = Number((await c.query<{ n: string }>('select count(*) n from app.items')).rows[0]!.n) } finally { await c.end() }
      },
    }).finally(async () => { writing = false; await loop; await writer.end() })
    expect(readdirSync(join(parent, 'under-writes')).sort()).toEqual(['agents.json', 'manifest.json', 'pgdata.tar.gz'])
    expect(manifest.archive.wal.segments).toBeGreaterThanOrEqual(1)
    expect(manifest.ledger).toEqual([])

    // Unpack into a fresh cluster directory and start it: backup recovery replays the archive's WAL.
    const point = await validateRestorePoint(join(parent, 'under-writes'))
    const c = clusterOf(mkdtempSync(join(tmpdir(), 'box-restored-')), 'pgrust-1')
    mkdirSync(c.dir, { recursive: true })
    await unpackRestorePoint(point, clusterPaths(c).data, tc.install.major)
    registerCluster(c, tc.install)
    const restored = await openCluster(c, tc.install, 'test')
    try {
      const q = connect(restored.socket, restored.port, 'box')
      await q.connect()
      try {
        const r = (await q.query<{ n: string; max: string; before: string }>(
          `select count(*) n, max(id) max, count(*) filter (where v = 'before stop') before from app.items`)).rows[0]!
        expect(Number(r.before)).toBe(1)
        expect(Number(r.n)).toBeGreaterThanOrEqual(committedBeforeStop)
        expect(r.n).toBe(r.max)
      } finally { await q.end() }
      expect(readFileSync(clusterPaths(c).log, 'utf8')).toMatch(/backup recovery/)
    } finally {
      await restored.release()
      rmSync(c.dir, { recursive: true, force: true })
    }
  }, 180_000)

  it('leaves no staging, backup, slot or lock behind when the copy fails, and the next backup works', async () => {
    const parent = join(dir, 'failing')
    await expect(takeRestorePoint({
      target: target(), parent, name: 'fails', label: 'seed', source: source(),
      beforeStop: async () => { throw new Error('copy failed on purpose') },
    })).rejects.toThrow(/copy failed on purpose/)
    expect(existsSync(parent) ? readdirSync(parent) : []).toEqual([])
    const watcher = connect(tc.running.socket, tc.running.port, 'box')
    await watcher.connect()
    try {
      // The session that held the slot, the backup and the shared schema lock is gone.
      for (let i = 0; i < 100; i++) {
        if (!(await watcher.query(`select 1 from pg_replication_slots`)).rowCount) break
        await new Promise((r) => setTimeout(r, 50))
      }
      expect((await watcher.query(`select 1 from pg_replication_slots`)).rowCount).toBe(0)
      expect((await watcher.query<{ ok: boolean }>('select pg_try_advisory_lock($1) ok', [SCHEMA_LOCK_KEY])).rows[0]!.ok).toBe(true)
      await watcher.query('select pg_advisory_unlock($1)', [SCHEMA_LOCK_KEY])
    } finally { await watcher.end() }
    const again = await takeRestorePoint({ target: target(), parent, name: 'after-failure', label: 'seed', source: source() })
    expect(JSON.parse(readFileSync(join(parent, 'after-failure', 'manifest.json'), 'utf8')).name).toBe(again.name)
  }, 120_000)

  it('refuses a damaged archive and a pg_dump restore point from an earlier version', async () => {
    const parent = join(dir, 'validate')
    await takeRestorePoint({ target: target(), parent, name: 'good', label: 'seed', source: source() })
    const damaged = join(parent, 'damaged')
    mkdirSync(damaged)
    for (const f of ['agents.json', 'manifest.json', 'pgdata.tar.gz']) copyFileSync(join(parent, 'good', f), join(damaged, f))
    const bytes = readFileSync(join(damaged, 'pgdata.tar.gz'))
    bytes[bytes.length >> 1]! ^= 0xff
    writeFileSync(join(damaged, 'pgdata.tar.gz'), bytes)
    await expect(validateRestorePoint(damaged)).rejects.toThrow(/does not match its manifest/)

    const old = join(parent, 'old')
    mkdirSync(old)
    writeFileSync(join(old, 'box.dump'), 'PGDMP')
    writeFileSync(join(old, 'manifest.json'), JSON.stringify({ format: 'box-db-restore-point/1', takenAt: new Date().toISOString() }))
    await expect(validateRestorePoint(old)).rejects.toThrow(/pg_dump restore point from an earlier Box version/)
  }, 120_000)
})
