// The PostgreSQL schema layer on real clusters, both engines: contract objects, baseline from the
// real core models, the migration ledger, role-login reconciliation, the catalog check, and the
// store API with routing and change events.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Access } from '../../auth/access.js'
import type { Principal } from '../../auth/principal.js'
import { onChange, emitChange } from '../../changes.js'
import { engineAvailable, startTestCluster, type TestCluster } from '../../db/testing.js'
import { asSystem, fillRequest, runInRequest } from '../../request-context.js'
import { CORE_MODELS } from '../core-models.js'
import { closeExecutor, configureExecutor, executor, setKnownAreas, setRoleLoginsForTests } from '../executor.js'
import type { ModelSpec } from '../model.js'
import { areaSchema, buildAreaMap } from './areas.js'
import { catalogCheck } from './catalog.js'
import { createPolicySql, ROW_FOREIGN_KEYS, ROW_POLICIES } from './rls.js'
import { clearPolicyService } from './boot.js'
import { applyPgSchema, pgMigrationChecksum, type PgMigration, type SchemaOwner } from './migrate.js'
import { BOX_DATABASE, desiredGroups, dropRetiredLogins, ensureDatabase, pendingRetiredLogins, POLICY_LOGIN, readRoleLogins, reconcileRoleLogins, type RolePolicy } from './policy.js'
import { withRead, withSerializable, withWrite } from './store.js'

const DEALS: ModelSpec = {
  table: 'crm_deals', pk: ['id'], timestamps: true,
  columns: { id: { kind: 'text' }, title: { kind: 'text' }, amount: { kind: 'float', default: '0' }, meta: { kind: 'json', default: "'{}'" }, closes: { kind: 'date', nullable: true } },
}
const RUNS: ModelSpec = { table: 'sync_runs', pk: ['id'], columns: { id: { kind: 'text' }, n: { kind: 'bigint', default: '0' } } }

const crm = (migrations: PgMigration[] = []): SchemaOwner => ({ id: 'crm', models: [DEALS], migrations, baseline: [`create index if not exists crm_deals_title on crm.crm_deals (title)`] })
const sync: SchemaOwner = { id: 'data-sync', models: [RUNS], migrations: [] }
const core: SchemaOwner = { id: 'core', models: CORE_MODELS, migrations: [] }
const AREAS = ['crm', 'data-sync']

const ROLES: RolePolicy[] = [
  { id: 'admin', default: 'write', areas: {} },
  { id: 'member', default: 'write', areas: {} },
  { id: 'sales', default: 'none', areas: { crm: 'write' } },
  { id: 'viewer', default: 'read', areas: { 'data-sync': 'none' } },
]

const principal = (id: string, role: string): Principal => ({ id, name: id, kind: 'human', role } as unknown as Principal)
function as<T>(role: string, fn: () => Promise<T>): Promise<T> {
  const r = ROLES.find((x) => x.id === role)!
  const access: Access = { role, areas: new Map(Object.entries(r.areas)), fallback: r.default, admin: role === 'admin', revision: 1 }
  return runInRequest(() => { fillRequest({ principal: principal(`${role}-user`, role), access }); return fn() })
}

for (const engine of ['pgrust', 'native'] as const) {
  // Cluster work (DDL, role changes, catalog scans) is slow on a loaded host: allow a minute per test.
  describe.skipIf(!engineAvailable(engine))(`pg schema on ${engine}`, { timeout: 60_000 }, () => {
    let tc: TestCluster
    let owner: pg.Client
    let policy: pg.Client
    const connect = async (user: string) => {
      const c = new pg.Client({ host: tc.running.socket, port: tc.running.port, user, database: BOX_DATABASE })
      c.on('error', () => {})
      await c.connect()
      return c
    }
    const check = () => catalogCheck(owner, { areas: AREAS, coreTables: CORE_MODELS.map((m) => m.table), roles: ROLES })

    beforeAll(async () => {
      tc = await startTestCluster(engine)
      const o = new pg.Client({ host: tc.running.socket, port: tc.running.port, user: 'box_owner', database: 'postgres' })
      await o.connect()
      expect(await ensureDatabase(o)).toBe(true)
      expect(await ensureDatabase(o)).toBe(false)
      await o.end()
      owner = await connect('box_owner')
    }, 180_000)

    afterAll(async () => {
      await closeExecutor()
      await policy?.end().catch(() => {})
      await owner?.end().catch(() => {})
      await tc?.stop()
    })

    it('baselines core and features into their schemas, idempotently', async () => {
      const first = await applyPgSchema(owner, core, [crm(), sync])
      expect(first.fresh).toBe(true)
      const again = await applyPgSchema(owner, core, [crm(), sync])
      expect(again.fresh).toBe(false)
      const tables = (await owner.query(`select table_schema || '.' || table_name t from information_schema.tables where table_schema in ('core','crm','data_sync') order by 1`)).rows.map((r) => r.t)
      expect(tables).toEqual(expect.arrayContaining(['core.users', 'core.roles', 'core.kv_state', 'core.schema_migrations', 'core.role_logins', 'crm.crm_deals', 'data_sync.sync_runs']))
      expect(buildAreaMap(CORE_MODELS, [crm(), sync]).qualify('sync_runs')).toBe('"data_sync"."sync_runs"')
      const types = (await owner.query(`select column_name c, data_type t from information_schema.columns where table_schema = 'crm' and table_name = 'crm_deals'`)).rows
      expect(Object.fromEntries(types.map((r) => [r.c, r.t]))).toMatchObject({ meta: 'jsonb', closes: 'date', created_at: 'timestamp with time zone', amount: 'double precision' })
    })

    it('records migrations once, atomically, and refuses edited or missing history', async () => {
      const m1: PgMigration = { name: '001-stage', statements: ['alter table crm.crm_deals add column if not exists stage text'] }
      const bad: PgMigration = { name: '002-bad', statements: ['alter table crm.crm_deals add column probe text', 'select * from crm.nope'] }
      const r = await applyPgSchema(owner, core, [crm([m1]), sync])
      expect(r.applied).toEqual(['crm:001-stage'])
      await expect(applyPgSchema(owner, core, [crm([m1, bad]), sync])).rejects.toThrow(/crm:002-bad failed/)
      const cols = (await owner.query(`select column_name from information_schema.columns where table_schema='crm' and table_name='crm_deals' and column_name in ('stage','probe')`)).rows.map((x) => x.column_name)
      expect(cols).toEqual(['stage'])
      const edited: PgMigration = { ...m1, statements: ['alter table crm.crm_deals add column if not exists stage2 text'] }
      await expect(applyPgSchema(owner, core, [crm([edited]), sync])).rejects.toThrow(/checksum changed/)
      // Refused before anything writes: a new area's schema is not created first.
      const probe: SchemaOwner = { id: 'probe-area', models: [], migrations: [] }
      await expect(applyPgSchema(owner, core, [crm([edited]), sync, probe])).rejects.toThrow(/checksum changed/)
      expect((await owner.query(`select 1 from pg_namespace where nspname = 'probe_area'`)).rowCount).toBe(0)
      await expect(applyPgSchema(owner, core, [crm([]), sync])).rejects.toThrow(/missing from installed code/)
      // The lock is released after every failure: a further run proceeds.
      expect((await applyPgSchema(owner, core, [crm([m1]), sync])).applied).toEqual([])
      const lock = await owner.query(`select count(*)::int n from pg_locks where locktype = 'advisory'`)
      expect(lock.rows[0].n).toBe(0)
    })

    it('asks for the pre-migrate restore point before anything changes, and only when something is pending', async () => {
      const m1: PgMigration = { name: '001-stage', statements: ['alter table crm.crm_deals add column if not exists stage text'] }
      const m3: PgMigration = { name: '003-probe', statements: ['alter table crm.crm_deals add column probe3 text'] }
      const calls: string[][] = []
      await applyPgSchema(owner, core, [crm([m1]), sync], { beforeMigrate: async (p) => { calls.push([...p]) } })
      expect(calls).toEqual([])
      const column = async () => (await owner.query(`select 1 from information_schema.columns where table_schema='crm' and table_name='crm_deals' and column_name='probe3'`)).rowCount
      await applyPgSchema(owner, core, [crm([m1, m3]), sync], {
        beforeMigrate: async (p) => { calls.push([...p]); expect(await column()).toBe(0) },
      })
      expect(calls).toEqual([['crm:003-probe']])
      // A new area counts, and a refused restore point stops the run before its schema exists.
      const extra: SchemaOwner = { id: 'pods', models: [{ table: 'pods_x', pk: ['id'], columns: { id: { kind: 'text' } } }], migrations: [] }
      await expect(applyPgSchema(owner, core, [crm([m1, m3]), sync, extra], { beforeMigrate: async (p) => { calls.push([...p]); throw new Error('no backup') } })).rejects.toThrow(/no backup/)
      expect(calls.at(-1)).toEqual(['area pods', 'models and baseline DDL changed'])
      expect((await owner.query(`select 1 from pg_namespace where nspname = 'pods'`)).rowCount).toBe(0)
      // A model or baseline change in an existing area, with no migration, counts too.
      const index = async () => (await owner.query(`select 1 from pg_indexes where schemaname = 'crm' and indexname = 'crm_deals_closes'`)).rowCount
      const withIndex = (migrations: PgMigration[]): SchemaOwner => ({ ...crm(migrations), baseline: [...crm().baseline!, 'create index if not exists crm_deals_closes on crm.crm_deals (closes)'] })
      await expect(applyPgSchema(owner, core, [withIndex([m1, m3]), sync], { beforeMigrate: async (p) => { calls.push([...p]); throw new Error('no backup') } })).rejects.toThrow(/no backup/)
      expect(calls.at(-1)).toEqual(['models and baseline DDL changed'])
      expect(await index()).toBe(0)
      await applyPgSchema(owner, core, [withIndex([m1, m3]), sync], { beforeMigrate: async (p) => { calls.push([...p]); expect(await index()).toBe(0) } })
      expect(await index()).toBe(1)
      const n = calls.length
      await applyPgSchema(owner, core, [withIndex([m1, m3]), sync], { beforeMigrate: async (p) => { calls.push([...p]) } })
      expect(calls.length).toBe(n)
      await owner.query('drop index crm.crm_deals_closes')
      await owner.query('alter table crm.crm_deals drop column probe3')
      await owner.query(`delete from core.schema_migrations where name = 'crm:003-probe'`)
    })

    it('checksums are canonical and cover run revisions and data', () => {
      const base: PgMigration = { name: 'x', statements: ['a', 'b'] }
      expect(pgMigrationChecksum(base)).toBe(pgMigrationChecksum({ name: 'x', statements: () => ['a', 'b'] }))
      expect(pgMigrationChecksum(base)).not.toBe(pgMigrationChecksum({ name: 'x', statements: ['ab'] }))
      expect(pgMigrationChecksum({ ...base, run: { revision: '1', fn: async () => {} } })).not.toBe(pgMigrationChecksum({ ...base, run: { revision: '2', fn: async () => {} } }))
      expect(pgMigrationChecksum({ ...base, data: { a: 1, b: 2 } })).toBe(pgMigrationChecksum({ ...base, data: { b: 2, a: 1 } }))
    })

    it('reconciles role logins and passes the catalog check', async () => {
      policy = await connect(POLICY_LOGIN)
      const before = await check()
      expect(before.filter((p) => !p.includes('has no login'))).toEqual([])
      const r = await reconcileRoleLogins(policy, ROLES, AREAS)
      expect(r.created).toHaveLength(4)
      expect(await check()).toEqual([])
      const again = await reconcileRoleLogins(policy, ROLES, AREAS)
      expect(again.changed).toBe(0)
      expect(desiredGroups(ROLES[3]!, AREAS)).toEqual(['area_crm_read'])
    })

    it('routes principals to their logins and enforces area grants at the database', async () => {
      // This file's own database, without the clone's test policy service (no admission check).
      clearPolicyService()
      setRoleLoginsForTests(await readRoleLogins(owner))
      setKnownAreas([...AREAS, 'signals', 'ops'])
      configureExecutor({ host: tc.running.socket, port: tc.running.port, database: BOX_DATABASE })
      await as('sales', () => withWrite((tx) => tx.run(`insert into crm.crm_deals (id, title, closes) values ($1, $2, $3)`, ['d1', 'One', '2026-12-01'])))
      const [deal] = await as('viewer', () => withRead<Record<string, unknown>>(`select id, meta, closes, created_at from crm.crm_deals`))
      expect(deal).toMatchObject({ id: 'd1', meta: {}, closes: '2026-12-01' })
      expect(String(deal!.created_at)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/)
      await expect(as('viewer', () => withWrite((tx) => tx.run(`delete from crm.crm_deals`)))).rejects.toMatchObject({ code: '42501' })
      await expect(as('sales', () => withRead(`select * from data_sync.sync_runs`))).rejects.toMatchObject({ code: '42501' })
      await expect(as('member', () => withRead(`select * from core.users`))).rejects.toMatchObject({ code: '42501' })
      expect(await as('member', () => withRead(`select count(*)::int n from core.users`, [], { reach: 'core' }))).toEqual([{ n: 0 }])
      const [ctx] = await as('member', () => withRead<{ r: string }>(`select current_setting('box.write_areas') r`))
      expect(ctx!.r).toBe('crm,data-sync,ops,signals')
      expect(await asSystem('test', () => withRead(`select count(*)::int n from data_sync.sync_runs`))).toEqual([{ n: 0 }])
    })

    it('publishes change events after commit and drops them on rollback', async () => {
      const seen: string[] = []
      const off = onChange((e) => seen.push(e.scope))
      try {
        await expect(asSystem('test', () => withWrite(async (tx) => {
          await tx.run(`insert into crm.crm_deals (id, title) values ('d2', 'Two')`)
          emitChange('table:crm_deals')
          throw new Error('nope')
        }))).rejects.toThrow('nope')
        expect(seen).toEqual([])
        await asSystem('test', () => withWrite(async (tx) => {
          await tx.run(`insert into crm.crm_deals (id, title) values ('d3', 'Three')`)
          emitChange('table:crm_deals')
          expect(seen).toEqual([])
        }))
        expect(seen).toEqual(['table:crm_deals'])
      } finally { off() }
    })

    it('retries serializable conflicts', async () => {
      let runs = 0
      // Both first attempts read before either writes, so one of them must fail and retry.
      let arrive!: () => void
      let waiting = 0
      const bothRead = new Promise<void>((res) => { arrive = res })
      const bump = () => asSystem('test', () => withSerializable(async (tx) => {
        runs++
        const [r] = await tx.query<{ n: number }>(`select coalesce(max(n), 0) n from data_sync.sync_runs`)
        if (runs <= 2) { if (++waiting === 2) arrive(); await bothRead }
        await tx.run(`insert into data_sync.sync_runs (id, n) values ($1, $2)`, [`r${r!.n + 1}`, r!.n + 1])
      }, { attempts: 5 }))
      await Promise.all([bump(), bump()])
      const rows = await asSystem('test', () => withRead<{ n: number }>(`select n from data_sync.sync_runs order by n`))
      expect(rows.map((r) => r.n)).toEqual([1, 2])
      expect(runs).toBeGreaterThan(2)
    })

    it('retires a removed role and reports drift', async () => {
      const fewer = ROLES.filter((r) => r.id !== 'viewer')
      const r = await reconcileRoleLogins(policy, fewer, AREAS)
      expect(r.retired).toHaveLength(1)
      setRoleLoginsForTests(r.logins)
      // Retiring (before cleanup): no membership, no CONNECT, and the catalog accepts that state.
      expect((await owner.query(`select count(*)::int n from pg_auth_members am join pg_roles m on m.oid = am.member where m.rolname = $1`, [r.retired[0]])).rows[0].n).toBe(0)
      expect((await owner.query(`select has_database_privilege($1, current_database(), 'CONNECT') c`, [r.retired[0]])).rows[0].c).toBe(false)
      expect(await catalogCheck(owner, { areas: AREAS, coreTables: CORE_MODELS.map((m) => m.table), roles: fewer })).toEqual([])
      await executor().retireLogins(r.retired)
      expect((await owner.query(`select count(*)::int n from pg_stat_activity where usename = $1`, [r.retired[0]])).rows[0].n).toBe(0)
      await dropRetiredLogins(policy, await pendingRetiredLogins(policy))
      // A new role never reuses a retired login's number.
      const highest = Math.max(...[...r.logins.values()].map((l) => Number(l.slice('box_role_'.length))), Number(r.retired[0]!.slice('box_role_'.length)))
      const more = await reconcileRoleLogins(policy, [...fewer, { id: 'viewer2', default: 'none', areas: {} }], AREAS)
      expect(Number(more.created[0]!.slice('box_role_'.length))).toBeGreaterThan(highest)
      await reconcileRoleLogins(policy, fewer, AREAS)
      await dropRetiredLogins(policy, await pendingRetiredLogins(policy))
      await expect(as('viewer', () => withRead('select 1'))).rejects.toMatchObject({ code: 'NO_LOGIN' })
      expect((await owner.query(`select 1 from pg_roles where rolname = $1`, [r.retired[0]])).rowCount).toBe(0)
      expect(await catalogCheck(owner, { areas: AREAS, coreTables: CORE_MODELS.map((m) => m.table), roles: fewer })).toEqual([])
      await owner.query(`grant select on core.users to area_crm_read`)
      await owner.query(`create role intruder login`)
      const drift = await catalogCheck(owner, { areas: AREAS, coreTables: CORE_MODELS.map((m) => m.table), roles: fewer })
      expect(drift).toEqual(expect.arrayContaining(['unexpected role intruder', expect.stringMatching(/^core\.users ACL/)]))
      await owner.query(`revoke select on core.users from area_crm_read`)
      await owner.query(`drop role intruder`)
      expect(areaSchema('data-sync')).toBe('data_sync')
      expect(() => areaSchema('core')).toThrow(/reserved/)
    })

    it('holds row security to the contract at boot and in the catalog check: drift refuses, never repaired', async () => {
      const fewer = ROLES.filter((r) => r.id !== 'viewer')
      const run = () => catalogCheck(owner, { areas: AREAS, coreTables: CORE_MODELS.map((m) => m.table), roles: fewer })
      // The schema the earlier cases leave applied (crm at 001-stage): only row security differs.
      const boot = () => applyPgSchema(owner, core, [crm([{ name: '001-stage', statements: ['alter table crm.crm_deals add column if not exists stage text'] }]), sync])
      const recreate = async (table: string, name: string) => {
        await owner.query(`drop policy if exists ${name} on core.${table}`)
        await owner.query(createPolicySql(ROW_POLICIES.find((p) => p.table === table && p.name === name)!))
      }
      expect(await run()).toEqual([])
      // An extra permissive policy: reported, and the schema step (boot) refuses instead of dropping it.
      await owner.query(`create policy sneak on core.signals as permissive for select to box_core using (true)`)
      expect(await run()).toEqual(['unexpected policy core.signals.sneak'])
      await expect(boot()).rejects.toThrow(/core\.signals: unexpected or changed sneak/)
      expect((await owner.query(`select 1 from pg_policies where policyname = 'sneak'`)).rowCount).toBe(1)
      await owner.query(`drop policy sneak on core.signals`)
      // An edited expression.
      await owner.query(`alter policy core_select on core.events using (true)`)
      expect(await run()).toEqual([expect.stringMatching(/^policy core\.events\.core_select differs: PERMISSIVE\|\{box_core\}\|SELECT\|true\|/)])
      await expect(boot()).rejects.toThrow(/core\.events: unexpected or changed core_select, missing core_select/)
      // A restrictive policy under a contract name.
      await owner.query(`drop policy core_select on core.events`)
      expect(await run()).toEqual(['policy core.events.core_select missing'])
      await expect(boot()).rejects.toThrow(/core\.events: missing core_select/)
      await owner.query(`create policy core_select on core.events as restrictive for select to box_core using (true)`)
      expect((await run()).some((p) => p.startsWith('policy core.events.core_select differs: RESTRICTIVE'))).toBe(true)
      await recreate('events', 'core_select')
      // Row security switched off beside the policies.
      await owner.query(`alter table core.snapshots disable row level security`)
      expect(await run()).toEqual(['core.snapshots row security off'])
      await expect(boot()).rejects.toThrow(/core\.snapshots: row security off/)
      await owner.query(`alter table core.snapshots enable row level security`)
      expect(await run()).toEqual([])
      // An installed table stripped of both row security and its policies is drift, not a first
      // install: the install record says it was armed.
      const strip = async () => {
        await owner.query(`alter table core.snapshots disable row level security`)
        for (const p of ROW_POLICIES.filter((x) => x.table === 'snapshots')) await owner.query(`drop policy ${p.name} on core.snapshots`)
      }
      await strip()
      await expect(boot()).rejects.toThrow(/core\.snapshots: row security and every policy removed after install/)
      expect((await owner.query(`select 1 from pg_policies where tablename = 'snapshots'`)).rowCount).toBe(0)
      // Without an install record it is a first installation: boot installs and records it.
      await owner.query(`delete from core.row_security_ledger where table_name = 'snapshots'`)
      await boot()
      expect(await run()).toEqual([])
      expect((await owner.query(`select 1 from core.row_security_ledger where table_name = 'snapshots'`)).rowCount).toBe(1)
    })

    it('holds the foreign keys row security relies on: missing, not cascading, not validated or not enforced is drift', async () => {
      const fewer = ROLES.filter((r) => r.id !== 'viewer')
      const run = () => catalogCheck(owner, { areas: AREAS, coreTables: CORE_MODELS.map((m) => m.table), roles: fewer })
      const fk = (await owner.query<{ conname: string }>(`select conname from pg_constraint where contype = 'f' and conrelid = 'core.signal_points'::regclass`)).rows[0]!.conname
      const KEY = 'core.signal_points (signal_id, area) -> signals (id, area)'
      const restore = `alter table core.signal_points add constraint ${fk} foreign key (signal_id, area) references core.signals (id, area) on update cascade on delete cascade`
      expect(await run()).toEqual([])
      await owner.query(`alter table core.signal_points drop constraint ${fk}`)
      expect(await run()).toEqual([`foreign key ${KEY} missing`])
      await owner.query(`alter table core.signal_points add constraint ${fk} foreign key (signal_id, area) references core.signals (id, area) on update cascade on delete no action`)
      expect(await run()).toEqual([`foreign key ${KEY} does not cascade (on update c, on delete a)`])
      await owner.query(`alter table core.signal_points drop constraint ${fk}`)
      await owner.query(`${restore} not valid`)
      expect(await run()).toEqual([`foreign key ${KEY} not validated`])
      await owner.query(`alter table core.signal_points validate constraint ${fk}`)
      expect(await run()).toEqual([])
      await owner.query(`alter table core.signal_points disable trigger all`)
      expect(await run()).toEqual([`foreign key ${KEY} not enforced (trigger disabled)`])
      await owner.query(`alter table core.signal_points enable trigger all`)
      expect(await run()).toEqual([])
      // The models declare exactly the contract's keys.
      const declared = CORE_MODELS.flatMap((m) => (m.foreignKeys ?? []).map((f) => ({ table: m.table, columns: f.columns, references: { table: f.table, columns: f.references } })))
      expect(declared).toEqual(ROW_FOREIGN_KEYS)
    })
  })
}
