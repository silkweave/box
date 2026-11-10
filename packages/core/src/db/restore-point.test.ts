// Online restore points under concurrent writes (BOX-Review W7 finding 4) and the pg_dump child's
// lifecycle on failure (finding 7), on a private test cluster.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { ensureBoxConfig } from '../box-config.js'
import type { DatabaseEngine } from '../box-json.js'
import { resetInstanceDir, setInstanceDir } from '../testing.js'
import { OWNER_LOGIN, readIdentity } from './cluster.js'
import { SCHEMA_LOCK_KEY } from '../warehouse/pg/migrate.js'
import { compareSnapshots, readSnapshot, runClientTool, takeRestorePoint, toolsFor, type RestorePointManifest } from './restore-point.js'
import { startTestCluster, type TestCluster } from './testing.js'

const engine = inject('boxDb').engine as DatabaseEngine
let dir: string
let tc: TestCluster

function connect(database: string): pg.Client {
  const c = new pg.Client({ host: tc.running.socket, port: tc.running.port, user: OWNER_LOGIN, database })
  c.on('error', () => {})
  return c
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-restore-point-'))
  setInstanceDir(dir)
  ensureBoxConfig()
  tc = await startTestCluster(engine)
  await tc.owner('create database box')
  await tc.owner(`create schema app; create table app.items (id bigint generated always as identity primary key, v text not null)`, 'box')
  await tc.owner(`insert into app.items (v) select 'row ' || g from generate_series(1, 5) g`, 'box')
}, 120_000)

afterAll(async () => {
  await tc?.stop().catch(() => {})
  rmSync(dir, { recursive: true, force: true })
  resetInstanceDir()
})

describe('online restore points', () => {
  it('restores and validates while a writer advances a sequence during the dump', async () => {
    const parent = join(dir, 'points')
    const writer = connect('box')
    await writer.connect()
    let manifest: RestorePointManifest
    try {
      manifest = await takeRestorePoint({
        target: tc.running, parent, name: 'under-writes', label: 'seed',
        source: { cluster: tc.running.cluster.name, identity: readIdentity(tc.running.cluster) },
        // Writes after the manifest's sequence read and around pg_dump's: the dump's sequence
        // value may be anything at or above the manifest's.
        duringDump: async () => {
          for (let i = 0; i < 20; i++) await writer.query(`insert into app.items (v) values ('concurrent ${i}')`)
        },
      })
    } finally { await writer.end() }
    expect(manifest.snapshot.sequences['app.items_id_seq']).toBe('5')
    expect(manifest.snapshot.tables['app.items']!.rows).toBe(5)

    // Restore the dump into a fresh database and compare, as the restore workflow does.
    await tc.owner('create database box_restored')
    const tools = toolsFor(readIdentity(tc.running.cluster).major)
    await runClientTool(tools, 'pg_restore', ['-h', tc.running.socket, '-p', String(tc.running.port), '-U', OWNER_LOGIN,
      '-d', 'box_restored', '--exit-on-error', '--single-transaction', join(parent, 'under-writes', 'box.dump')], 120_000)
    const c = connect('box_restored')
    await c.connect()
    try {
      await c.query('begin isolation level repeatable read read only')
      const restored = await readSnapshot(c)
      await c.query('rollback')
      expect(compareSnapshots(manifest.snapshot, restored)).toEqual([])
      expect(BigInt(restored.sequences['app.items_id_seq']!)).toBeGreaterThanOrEqual(5n)
    } finally { await c.end() }
  }, 180_000)

  it('ends a slow snapshot read when pg_dump fails: its backend, snapshot and schema lock are gone at once', async () => {
    const parent = join(dir, 'dump-fails')
    const watcher = connect('box')
    await watcher.connect()
    let exporterPid = 0
    let sawSleep = false
    // pg_dump takes ACCESS SHARE locks on the tables it dumps, so a lock held here keeps it alive
    // (blocked at its start) until the test kills it: it can neither finish before the kill nor be
    // missed by it.
    const blocker = connect('box')
    await blocker.connect()
    await blocker.query('begin')
    await blocker.query('lock table app.items in access exclusive mode')
    const started = Date.now()
    try {
      await expect(takeRestorePoint({
        target: tc.running, parent, name: 'dump-fails', label: 'seed',
        source: { cluster: tc.running.cluster.name, identity: readIdentity(tc.running.cluster) },
        // Block the reader in a long statement on its session, wait until the server runs it, then
        // kill this process's pg_dump.
        duringDump: async (exporter) => {
          exporterPid = (exporter as unknown as { processID: number }).processID
          const sleeping = exporter.query('select pg_sleep(60)')
          for (let i = 0; i < 200; i++) {
            const r = await watcher.query(`select 1 from pg_stat_activity where pid = $1 and state = 'active' and query like 'select pg_sleep%'`, [exporterPid])
            if (r.rowCount) { sawSleep = true; break }
            await new Promise((res) => setTimeout(res, 25))
          }
          // The child is only named pg_dump once it has exec'd: retry until a kill lands.
          let killed = false
          for (let i = 0; i < 200 && !killed; i++) {
            killed = spawnSync('pkill', ['-KILL', '-P', String(process.pid), '-x', 'pg_dump']).status === 0
            if (!killed) await new Promise((res) => setTimeout(res, 25))
          }
          expect(killed).toBe(true)
          await sleeping
        },
      })).rejects.toThrow(/pg_dump/)
      expect(Date.now() - started).toBeLessThan(20_000)
      expect(exporterPid).toBeGreaterThan(0)
      expect(sawSleep).toBe(true)
      // The backend is gone, and the EXCLUSIVE schema lock (what a migration takes) is free now.
      expect((await watcher.query('select 1 from pg_stat_activity where pid = $1', [exporterPid])).rowCount).toBe(0)
      expect((await watcher.query<{ ok: boolean }>('select pg_try_advisory_lock($1) ok', [SCHEMA_LOCK_KEY])).rows[0]!.ok).toBe(true)
      await watcher.query('select pg_advisory_unlock($1)', [SCHEMA_LOCK_KEY])
    } finally {
      await blocker.end().catch(() => {})
      await watcher.end()
    }
    expect(existsSync(parent) ? readdirSync(parent) : []).toEqual([])
  }, 120_000)

  it('waits for pg_dump to stop and removes staging when reading the snapshot fails', async () => {
    const parent = join(dir, 'failing')
    await expect(takeRestorePoint({
      target: tc.running, parent, name: 'fails', label: 'seed',
      source: { cluster: tc.running.cluster.name, identity: readIdentity(tc.running.cluster) },
      duringDump: async () => { throw new Error('snapshot read failed on purpose') },
    })).rejects.toThrow(/snapshot read failed on purpose/)
    expect(existsSync(parent) ? readdirSync(parent) : []).toEqual([])
    // The session that held the agents lock and the exported snapshot is gone: a new backup works.
    const again = await takeRestorePoint({
      target: tc.running, parent, name: 'after-failure', label: 'seed',
      source: { cluster: tc.running.cluster.name, identity: readIdentity(tc.running.cluster) },
    })
    expect(JSON.parse(readFileSync(join(parent, 'after-failure', 'manifest.json'), 'utf8')).name).toBe(again.name)
  }, 120_000)
})
