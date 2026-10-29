import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { expect, it, vi } from 'vitest'
import { repoRoot } from '../io.js'
import type { CoreFeature } from '../feature.js'
import { applySchema, type MigrationConn } from './schema.js'
import { snapshotBeforeMigration } from './migration-snapshot.js'
import { migrationOwnershipErrors } from './migration-ownership.js'

async function database(run: (conn: MigrationConn, file: string, dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(repoRoot(), 'box-projection-upgrade-test-'))
  const file = join(dir, 'data.db')
  const instance = await DuckDBInstance.create(file)
  const connection = await instance.connect()
  try { await run(connection as unknown as MigrationConn, file, dir) }
  finally { connection.disconnectSync(); instance.closeSync(); rmSync(dir, { recursive: true, force: true }) }
}
const demo = (): CoreFeature => ({
  id: 'demo', models: [{ table: 'demo', pk: ['id'], columns: { id: { kind: 'text' }, value: { kind: 'int' } } }],
  migrations: [{ name: '001-initial', statements: ['UPDATE demo SET value = value + 1'] }],
})
const rows = async (conn: MigrationConn, sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJson()

it('refuses edited or removed applied migrations before baseline or pending writes', async () => database(async (conn) => {
  const feature = demo()
  await applySchema(conn, [feature])
  await conn.run("INSERT INTO demo VALUES ('kept', 10)")
  const changed = { ...feature, baseline: ['UPDATE demo SET value = 0'], migrations: [{ name: '001-initial', statements: ['UPDATE demo SET value = 99'] }] }
  await expect(applySchema(conn, [changed])).rejects.toThrow(/demo:001-initial checksum changed/)
  await expect(applySchema(conn, [{ ...changed, migrations: [] }])).rejects.toThrow(/demo:001-initial is missing/)
  expect(await rows(conn, 'SELECT value FROM demo')).toEqual([{ value: 10 }])
}))

it('backfills legacy checksums once without rerunning old migrations, and keeps removed-feature residue', async () => database(async (conn) => {
  await applySchema(conn, [demo()])
  await conn.run("INSERT INTO demo VALUES ('kept', 10)")
  await conn.run('ALTER TABLE schema_migrations DROP COLUMN checksum')
  await applySchema(conn, [])
  expect(await rows(conn, "SELECT name FROM schema_migrations WHERE name = 'demo:001-initial' AND checksum IS NULL")).toHaveLength(1)
  await applySchema(conn, [demo()])
  expect(await rows(conn, 'SELECT value FROM demo')).toEqual([{ value: 10 }])
  expect(await rows(conn, 'SELECT name FROM schema_migrations WHERE checksum IS NULL')).toEqual([])
}))

it('snapshot contains old rows, old schema and old ledger before any upgrade write; reboot takes none', async () => database(async (conn, file, dir) => {
  const old = demo()
  const backup = vi.fn(() => snapshotBeforeMigration(conn, file))
  await applySchema(conn, [old], backup)
  expect(backup).not.toHaveBeenCalled()
  await conn.run("INSERT INTO demo VALUES ('kept', 10)")
  const next: CoreFeature = { ...old, models: [{ ...old.models[0]!, columns: { ...old.models[0]!.columns, extra: { kind: 'text', nullable: true } } }],
    migrations: [...old.migrations, { name: '002-extra', statements: ['ALTER TABLE demo ADD COLUMN IF NOT EXISTS extra VARCHAR'] }] }
  await applySchema(conn, [next], backup)
  await applySchema(conn, [next], backup)
  expect(backup).toHaveBeenCalledTimes(1)
  const saved = join(dir, 'backups', readdirSync(join(dir, 'backups')).find((name) => name.endsWith('.db'))!)
  const instance = await DuckDBInstance.create(saved)
  const copy = await instance.connect()
  try {
    expect(await rows(copy as unknown as MigrationConn, 'SELECT * FROM demo')).toEqual([{ id: 'kept', value: 10 }])
    expect(await rows(copy as unknown as MigrationConn, "SELECT name FROM schema_migrations WHERE name = 'demo:002-extra'")).toEqual([])
  } finally { copy.disconnectSync(); instance.closeSync() }
}))

it('snapshot failure blocks baseline and migration writes', async () => database(async (conn, file, dir) => {
  const feature = demo()
  await applySchema(conn, [feature])
  await conn.run("INSERT INTO demo VALUES ('kept', 10)")
  writeFileSync(join(dir, 'backups'), 'not a directory')
  const next = { ...feature, baseline: ['UPDATE demo SET value = 0'], migrations: [...feature.migrations, { name: '002-change', statements: ['UPDATE demo SET value = 99'] }] }
  await expect(applySchema(conn, [next], () => snapshotBeforeMigration(conn, file))).rejects.toThrow()
  expect(await rows(conn, 'SELECT value FROM demo')).toEqual([{ value: 10 }])
}))

it('failed migration rolls back its data and ledger, and a factory is evaluated once', async () => database(async (conn) => {
  const feature = demo()
  await applySchema(conn, [feature])
  await conn.run("INSERT INTO demo VALUES ('kept', 10)")
  const statements = vi.fn(() => ['UPDATE demo SET value = 99', 'SELECT * FROM missing_table'])
  await expect(applySchema(conn, [{ ...feature, migrations: [...feature.migrations, { name: '002-fail', statements }] }])).rejects.toThrow(/migration demo:002-fail failed/)
  expect(statements).toHaveBeenCalledTimes(1)
  expect(await rows(conn, 'SELECT value FROM demo')).toEqual([{ value: 10 }])
  expect(await rows(conn, "SELECT name FROM schema_migrations WHERE name = 'demo:002-fail'")).toEqual([])
}))

it('ownership checks static reads and writes, ignores literals/comments, and rejects ledger access', () => {
  const feature = demo()
  expect(migrationOwnershipErrors([{ ...feature, migrations: [{ name: 'x', statements: [
    'UPDATE demo SET value = (SELECT count(*) FROM "users")',
    'SELECT * FROM schema_migrations',
  ] }] }])).toEqual([expect.stringContaining('users'), expect.stringContaining('schema_migrations')])
  expect(migrationOwnershipErrors([{ ...feature, migrations: [{ name: 'x', statements: [
    "SELECT 'FROM users' FROM demo -- JOIN missing\n /* UPDATE users */",
  ] }] }])).toEqual([])
})

it('ownership counts retired tables as the feature\'s own and reads IS DISTINCT FROM as a comparison', () => {
  const feature = demo()
  expect(migrationOwnershipErrors([{ ...feature, retiredTables: ['old_demo'], migrations: [{ name: 'x', statements: [
    'DROP TABLE IF EXISTS old_demo',
    'UPDATE demo SET value = l.v FROM (SELECT 1 AS v) l WHERE demo.value IS DISTINCT FROM l.v',
    'UPDATE demo SET value = 1 WHERE value IS NOT DISTINCT FROM 2',
  ] }] }])).toEqual([])
  expect(migrationOwnershipErrors([{ ...feature, migrations: [{ name: 'x', statements: ['DROP TABLE IF EXISTS old_demo'] }] }])).toEqual([expect.stringContaining('old_demo')])
})

it('checkpoints after each migration, so a reopen never replays an ALTER of a table with now() defaults', async () => {
  const dir = mkdtempSync(join(repoRoot(), 'box-projection-upgrade-test-'))
  const file = join(dir, 'data.db')
  const stamped: CoreFeature = {
    id: 'demo',
    models: [{ table: 'demo', pk: ['id'], columns: { id: { kind: 'text' } }, timestamps: true }],
    migrations: [{ name: '001-extra', statements: ['ALTER TABLE demo ADD COLUMN IF NOT EXISTS extra VARCHAR'] }],
  }
  try {
    // DuckDB fails "while replaying WAL" on an ALTER of such a table; close as a crash would.
    const instance = await DuckDBInstance.create(file)
    const conn = await instance.connect()
    await conn.run('PRAGMA disable_checkpoint_on_shutdown')
    await applySchema(conn as unknown as MigrationConn, [stamped])
    conn.disconnectSync()
    instance.closeSync()
    const reopened = await DuckDBInstance.create(file)
    const again = await reopened.connect()
    await again.run("INSERT INTO demo (id, extra) VALUES ('a', 'x')")
    expect((await again.runAndReadAll('SELECT extra FROM demo')).getRowObjectsJson()).toEqual([{ extra: 'x' }])
    again.disconnectSync()
    reopened.closeSync()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
