// The adversarial matrix (PHASE1.md W8 "A", PLAN.md phase-1 exit), on a clone of the migrated
// template with the real schema (core and every feature), both engines (BOX_TEST_ENGINE). Cases
// that already have a home stay there and are listed, not duplicated:
//
//   A1 classifier: executor.test.ts "admits data statements and refuses lifecycle forms", "sets the
//      context with SET LOCAL and refuses feature SET and set_config"; here also every A1 form.
//   A4 success and reset: executor.test.ts "leaves no session state behind ..."; here a role login
//      across error, cancel and kill, and box_core with an admin and a narrow reader across error,
//      cancel, kill and a failed reset (context, visible rows, refused writes).
//   A5 process death before and after a policy commit, then a fresh boot: policy-crash.test.ts;
//      an injected failure: policy-command.test.ts "changes nothing when the command fails after
//      writing"; boot reconcile: schema.test.ts "reconciles role logins and passes the catalog check".
//   A6 cross-domain atomicity: policy-command.test.ts "a core command authorizes again ...";
//      NESTED_LOGIN: executor.test.ts "reuses the transaction on the same login ...".
//   A7 budget: executor.test.ts "rejects fast when the budget and its queue are full ..."; the
//      booted process with the listener up and every ordinary slot held, and the policy lane:
//      policy-command.test.ts "A7 ..."; closing connections count: executor.test.ts "never holds
//      more open connections than the total while retired ones are still closing".
//   A8 revocation: policy-command.test.ts "admits the next transaction on a policy another process
//      committed", "moves a frame off a retired role"; retire with idle sessions: schema.test.ts
//      "retires a removed role and reports drift"; a named statement on the same pooled session
//      denied after the revoke: policy-command.test.ts "admits the next transaction ..." (own
//      cluster: memberships are cluster-wide).
//   A9 RLS: rls.test.ts (reads, WITH CHECK, rebinding, ON CONFLICT, points, events); MERGE here.
//
// Raw-login guarantees (A1) are what the database refuses to a role login holding hostile SQL;
// what it cannot refuse (a login's own role defaults, its own default privileges, its password) the
// catalog check reports, so boot refuses the drift.

import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Access, AccessLevel } from '../../auth/access.js'
import { policyRevision } from '../../auth/access.js'
import type { Principal } from '../../auth/principal.js'
import { BUILTIN_ROLES } from '../../auth/roles.js'
import { OWNER_LOGIN } from '../../db/cluster.js'
import { asBootstrap, fillRequest, runInRequest } from '../../request-context.js'
import { CORE_MODELS } from '../core-models.js'
import { withRead, withWrite } from '../db.js'
import { executor } from '../executor.js'
import { areaGroup, areaSchema, buildAreaMap } from './areas.js'
import { boxSchemaOwners } from '../schema.js'
import { rolePolicies, withClient } from './boot.js'
import { catalogCheck } from './catalog.js'
import { POLICY_LOGIN } from './policy.js'

const target = () => { const { host, port, database } = executor().target; return { t: { socket: host, port }, database } }
const owner = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
  const { t, database } = target()
  return withClient(t, OWNER_LOGIN, database, async (c) => (await c.query<T>(sql, params)).rows)
}
const raw = async (login: string): Promise<pg.Client> => {
  const { t, database } = target()
  const c = new pg.Client({ host: t.socket, port: t.port, user: login, database })
  c.on('error', () => {})
  await c.connect()
  return c
}
const loginOf = async (role: string) => (await owner<{ login: string }>(`select login from core.role_logins where role_id = $1 and retired_at is null`, [role]))[0]!.login
/** Catalog problems on the clone. The contract's areas and roles come from the clone's own groups and roles. */
const check = async (): Promise<string[]> => {
  const { t, database } = target()
  return withClient(t, OWNER_LOGIN, database, async (o) => {
    const areas = (await o.query<{ a: string }>(`select substr(rolname, 6, length(rolname) - 10) a from pg_roles where rolname like 'area\\_%\\_read' order by 1`)).rows
      .map((r) => r.a.replace(/_/g, '-'))
    const problems = await catalogCheck(o, { areas, coreTables: CORE_MODELS.map((m) => m.table), roles: await rolePolicies(o, BUILTIN_ROLES.map((r) => ({ id: r.id, default: r.default, areas: r.areas }))) })
    // The check is cluster-wide; other test files' databases (cloned meanwhile) are not this one's drift.
    return problems.filter((p) => { const db = /^setting override for \S+ on (\S+):/.exec(p)?.[1]; return !db || db === '*' || db === database })
  })
}
const added = (now: string[], base: string[]) => now.filter((p) => !base.includes(p))
/** A pg error code from a promise expected to fail. */
const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? String(e))

function as<T>(role: string, areas: Record<string, AccessLevel>, fn: () => Promise<T>, id = 'adv-probe', admin = false): Promise<T> {
  return runInRequest(() => {
    const access: Access = { role, areas: new Map(Object.entries(areas)), fallback: 'none', admin, revision: policyRevision() }
    fillRequest({ principal: { id, display: id, role, kind: 'human' } as Principal, access })
    return fn()
  })
}

let supportLogin: string
let crmReaderLogin: string
beforeAll(async () => {
  supportLogin = await loginOf('test-support')
  crmReaderLogin = await loginOf('test-crm-reader')
})

// ---- A1: a role login with hostile SQL ----

const REFUSED: Array<[string, string]> = [
  ['set role box_core', '42501'], ['set role box_system', '42501'], ['set role box_owner', '42501'], ['set role box_policy', '42501'],
  ['set role area_crm_read', '42501'], ['set role area_support_write', '42501'],
  ['set session authorization box_owner', '42501'],
  ['create table support.adv (x int)', '42501'], ['create table public.adv (x int)', '42501'], ['create table core.adv (x int)', '42501'],
  ['create table ext.adv (x int)', '42501'], ['create temp table adv (x int)', '42501'], ['create schema adv', '42501'],
  [`create function public.adv() returns int language sql as 'select 1'`, '42501'], [`create function support.adv() returns int language sql as 'select 1'`, '42501'],
  [`copy (select 1) to program 'true'`, '42501'], [`select pg_read_file('/etc/hosts')`, '42501'], [`select pg_ls_dir('.')`, '42501'],
  [`select lo_import('/etc/hosts')`, '42501'], [`select dblink_connect('x')`, '42883'], ['create extension dblink', '42501'],
  [`select set_config('box.read_areas', 'crm', false)`, '42501'], [`alter role current_user set box.read_areas = 'crm'`, '42501'],
  ['alter role current_user createrole', '42501'], ['create role adv', '42501'], ['select count(*) from pg_catalog.pg_authid', '42501'],
]

describe('A1 a role login', () => {
  it('cannot change identity, create objects, reach the host or the context functions', async () => {
    const c = await raw(supportLogin)
    try {
      const got: Array<[string, string]> = []
      for (const [sql] of REFUSED) got.push([sql, await codeOf(c.query(sql))])
      expect(got).toEqual(REFUSED)
      expect((await c.query(`select current_user u, session_user s`)).rows[0]).toEqual({ u: supportLogin, s: supportLogin })
      expect((await c.query(`select count(*)::int n from pg_extension where extname = 'dblink'`)).rows[0].n).toBe(0)
    } finally { await c.end() }
  })

  it('gains nothing from GRANT, and what it can change about itself is drift the catalog check reports', async () => {
    const base = await check()
    const c = await raw(supportLogin)
    try {
      // Granting what it does not hold with grant option is a no-op (a notice), not an error.
      const acl = async () => (await owner<{ a: string | null }>(`select nspacl::text a from pg_namespace where nspname = 'support'`))[0]!.a
      const before = await acl()
      await c.query('grant usage on schema support to public')
      await c.query(`grant select on all tables in schema support to public`)
      expect(await acl()).toBe(before)
      expect(added(await check(), base)).toEqual([])
      // Its own role defaults, default privileges and password: allowed to any role, reported.
      await c.query(`alter role current_user set statement_timeout = 1`)
      await c.query(`alter default privileges grant select on tables to public`)
      await c.query(`alter role current_user password 'adv'`)
      expect(added(await check(), base).sort()).toEqual([
        `default privileges of ${supportLogin}`,
        `login ${supportLogin} has a password`,
        `setting override for ${supportLogin} on *: {statement_timeout=1}`,
      ])
    } finally {
      await c.query('alter role current_user reset all').catch(() => {})
      await c.query('alter default privileges revoke select on tables from public').catch(() => {})
      await c.query('alter role current_user password null').catch(() => {})
      await c.end()
    }
    expect(added(await check(), base)).toEqual([])
  })

  it('cannot send any of these through the executor (classifier)', async () => {
    const forms = [...REFUSED.map(([sql]) => sql).filter((s) => !s.startsWith('select ')), 'grant usage on schema support to public',
      `alter role current_user password 'x'`, `alter default privileges grant select on tables to public`, `set box.read_areas = 'crm'`, 'reset role']
    for (const sql of forms) {
      await expect(as('test-support', { support: 'write' }, () => withWrite((tx) => tx.run(sql))), sql).rejects.toMatchObject({ code: 'CLASSIFIED' })
    }
  })
})

// ---- A2: area grants, generated from the area groups ----

describe('A2 area grants', () => {
  // Generated from what the code declares (every installed feature's area map), never from what the
  // catalog happens to hold: a missing schema, group or table is a failure, not a skipped case.
  const { core: coreOwner, features: featureOwners } = boxSchemaOwners()
  const map = buildAreaMap(coreOwner.models, featureOwners)
  const areaTables = featureOwners.filter((o) => o.models.length > 0)
    .map((o) => ({ area: o.id, table: `${map.schemaOf(o.id)}.${[...o.models].map((m) => m.table).sort()[0]}` }))
    .sort((a, b) => a.area.localeCompare(b.area))
  beforeAll(() => {
    expect(areaTables.map((x) => x.area)).toEqual(expect.arrayContaining(featureOwners.length ? ['support', 'crm'] : []))
  })

  it('a role login reads only its areas, writes only its write areas, and no core table', async () => {
    const support = await raw(supportLogin)
    const crmReader = await raw(crmReaderLogin)
    try {
      for (const { area, table } of areaTables) {
        expect([area, await codeOf(support.query(`select 1 from ${table} limit 0`))]).toEqual([area, area === 'support' ? 'ok' : '42501'])
        const crmReads = area === 'crm'
        expect([area, await codeOf(crmReader.query(`select 1 from ${table} limit 0`))]).toEqual([area, crmReads ? 'ok' : '42501'])
      }
      // crm at read: writing it is refused before any row is looked at.
      const crm = areaTables.find((x) => x.area === 'crm')?.table
      if (crm) expect(await codeOf(crmReader.query(`delete from ${crm} where false`))).toBe('42501')
      if (crm) expect(await codeOf(crmReader.query(`insert into ${crm} default values`))).toBe('42501')
      for (const m of CORE_MODELS) {
        expect([m.table, await codeOf(support.query(`select 1 from core.${m.table} limit 0`))]).toEqual([m.table, '42501'])
      }
    } finally { await support.end(); await crmReader.end() }
  })

  it('box_core and box_policy reach no area table', async () => {
    for (const login of ['box_core', POLICY_LOGIN]) {
      const c = await raw(login)
      try {
        for (const { area, table } of areaTables) expect([login, area, await codeOf(c.query(`select 1 from ${table} limit 0`))]).toEqual([login, area, '42501'])
      } finally { await c.end() }
    }
  })

  it('the catalog holds exactly the declared area schemas and groups, and each area\'s probe table', async () => {
    const schemas = (await owner<{ s: string }>(`select nspname s from pg_namespace where nspname not like 'pg\\_%' and nspname not in ('information_schema', 'core', 'ext', 'public') order by 1`)).map((r) => r.s)
    expect(schemas).toEqual(map.areas.map((a) => areaSchema(a)).sort())
    const groups = (await owner<{ g: string }>(`select rolname g from pg_roles where rolname like 'area\\_%' order by 1`)).map((r) => r.g)
    expect(groups).toEqual(map.areas.flatMap((a) => [areaGroup(a, 'read'), areaGroup(a, 'write')]).sort())
    for (const { area, table } of areaTables) {
      expect([area, (await owner<{ t: string | null }>(`select to_regclass($1)::text t`, [table]))[0]!.t]).toEqual([area, table])
    }
  })
})

// ---- A3: views and functions (planted violations) ----

describe('A3 views and functions', () => {
  it('reports a definer view, a SECURITY DEFINER function and a function with settings, each until removed', async () => {
    const base = await check()
    const plant = async (create: string, drop: string, problem: RegExp) => {
      await owner(create)
      try {
        const got = added(await check(), base)
        expect(got.some((p) => problem.test(p)), `${create}: ${JSON.stringify(got)}`).toBe(true)
      } finally { await owner(drop) }
      expect(added(await check(), base)).toEqual([])
    }
    await owner(`create view support.adv_ok with (security_invoker = true) as select 1 as x`)
    await owner(`grant select on support.adv_ok to area_support_read; grant select, insert, update, delete on support.adv_ok to area_support_write, box_system`)
    expect(added(await check(), base)).toEqual([])
    await owner('drop view support.adv_ok')
    await plant(`create view support.adv_definer as select id from core.users; grant select on support.adv_definer to area_support_read; grant select, insert, update, delete on support.adv_definer to area_support_write, box_system`,
      'drop view support.adv_definer', /^view support\.adv_definer is not security_invoker$/)
    await plant(`create function support.adv_def() returns int language sql security definer set search_path = support as 'select 1'; revoke execute on function support.adv_def() from public`,
      'drop function support.adv_def()', /^security definer support\.adv_def$/)
    await plant(`create function support.adv_cfg() returns int language sql set work_mem = '1MB' as 'select 1'; revoke execute on function support.adv_cfg() from public`,
      'drop function support.adv_cfg()', /^function support\.adv_cfg sets \{work_mem=1MB\}$/)
  })
})

// ---- A4: two principals on one role login ----

describe('A4 two principals on one login', () => {
  const ctx = () => withRead<{ p: string; r: string; w: string; pid: number }>(
    `select current_setting('box.principal', true) p, current_setting('box.read_areas', true) r, current_setting('box.write_areas', true) w, pg_backend_pid() pid`)
  const asP = <T>(id: string, fn: () => Promise<T>) => as('test-support', { support: 'write' }, fn, id)

  it('never carries the context across commit, error, statement cancel or a destroyed connection', async () => {
    const first = (await asP('adv-one', ctx))[0]!
    expect(first).toMatchObject({ p: 'adv-one', r: 'support', w: 'support' })
    // Error: the transaction fails; the next principal on the same connection sees only its own.
    await expect(asP('adv-one', () => withWrite((tx) => tx.run(`select 1/0`)))).rejects.toMatchObject({ code: '22012' })
    const afterError = (await asP('adv-two', ctx))[0]!
    expect(afterError).toEqual({ ...first, p: 'adv-two' })
    // Statement cancel (statement_timeout).
    await expect(asP('adv-one', () => withRead(`select pg_sleep(2)`, [], { timeoutMs: 50 }))).rejects.toMatchObject({ code: '57014' })
    const afterCancel = (await asP('adv-two', ctx))[0]!
    expect(afterCancel).toEqual({ ...first, p: 'adv-two' })
    // A connection killed mid-transaction is destroyed on release; the next one starts clean.
    await expect(asP('adv-one', () => withWrite(async (tx) => {
      const [{ pid }] = await tx.query<{ pid: number }>('select pg_backend_pid() pid')
      await owner('select pg_terminate_backend($1)', [pid])
      await tx.query('select 1')
    }))).rejects.toBeDefined()
    const afterKill = (await asP('adv-two', ctx))[0]!
    expect(afterKill).toMatchObject({ p: 'adv-two', r: 'support', w: 'support' })
    expect(afterKill.pid).not.toBe(first.pid)
  })

  it('a principal on box_core leaves nothing for the bootstrap frame after it (missing context denies)', async () => {
    const core = { reach: 'core' } as const
    const used = await as('admin', {}, () => withRead<{ pid: number; n: number }>(`select pg_backend_pid() pid, (select count(*)::int from core.events) n`, [], core), 'adv-admin', true)
    const boot = await asBootstrap(() => withRead<{ pid: number; r: string | null; n: number }>(
      `select pg_backend_pid() pid, current_setting('box.read_areas', true) r, (select count(*)::int from core.events) n`, [], core))
    expect(boot[0]!.pid).toBe(used[0]!.pid)
    expect(boot[0]!.r || '').toBe('')
    expect(boot[0]!.n).toBe(0)
  })
})

// ---- A4 on box_core: an admin and a narrow reader on one core session, across every failure ----

describe('A4 two principals on box_core', () => {
  const core = { reach: 'core' } as const
  const admin = <T>(fn: () => Promise<T>) => as('admin', { crm: 'write', signals: 'write', support: 'write' }, fn, 'adv-admin', true)
  const reader = <T>(fn: () => Promise<T>) => as('reader', { signals: 'read' }, fn, 'adv-reader')
  /** The reader's whole view: its context, what row security shows it, what it may write. */
  const probe = () => reader(async () => {
    const [row] = await withRead<{ p: string; r: string; w: string; v: string; pid: number; crm: number; sig: number }>(
      `select current_setting('box.principal', true) p, current_setting('box.read_areas', true) r, current_setting('box.write_areas', true) w,
        current_setting('box.revision', true) v, pg_backend_pid() pid,
        (select count(*)::int from core.signals where id = 'adv-a4-crm') crm, (select count(*)::int from core.signals where id = 'adv-a4-sig') sig`, [], core)
    // Rows it may not write are invisible to an UPDATE (0 rows); a new row is refused by WITH CHECK.
    const updated = await withWrite((tx) => tx.run(`update core.signals set label = 'reader' where id in ('adv-a4-crm', 'adv-a4-sig')`), core)
    const insert = await codeOf(withWrite((tx) => tx.run(`insert into core.signals (id, label, signal_group, channel, source, "interval", accumulation, direction, description, depends_on, area, sort, created_at, updated_at)
      values ('adv-a4-new', 'adv', '', 'business', 'manual', 'day', 'snapshot', 'up', '', '[]'::jsonb, 'signals', 0, now(), now())`), core))
    return { ...row!, updated, insert }
  })
  const expected = () => ({ p: 'adv-reader', r: 'signals', w: '', v: String(policyRevision()), crm: 0, sig: 1, updated: 0, insert: '42501' })
  const adminPid = () => admin(async () => (await withRead<{ pid: number; crm: number }>(`select pg_backend_pid() pid, (select count(*)::int from core.signals where id = 'adv-a4-crm') crm`, [], core))[0]!)

  beforeAll(async () => {
    for (const [id, area] of [['adv-a4-crm', 'crm'], ['adv-a4-sig', 'signals']]) {
      await owner(`insert into core.signals (id, label, signal_group, channel, source, "interval", accumulation, direction, description, depends_on, area, sort, created_at, updated_at)
        values ($1, 'adv', '', 'business', 'manual', 'day', 'snapshot', 'up', '', '[]'::jsonb, $2, 0, now(), now())`, [id, area])
    }
  })
  afterAll(async () => { await owner(`delete from core.signals where id like 'adv-a4-%'`) })

  it('the reader sees only its own context, rows and rights after the admin errs, is cancelled, is killed or its reset fails', async () => {
    const used = await adminPid()
    expect(used.crm).toBe(1)
    // Error inside the admin's transaction (same session is reused afterwards).
    await expect(admin(() => withWrite(async (tx) => { await tx.run(`update core.signals set label = 'x' where id = 'adv-a4-crm'`); await tx.run('select 1/0') }, core))).rejects.toMatchObject({ code: '22012' })
    const afterError = await probe()
    expect(afterError).toMatchObject(expected())
    expect(afterError.pid).toBe(used.pid)
    // Statement cancel.
    await expect(admin(() => withRead(`select pg_sleep(2)`, [], { ...core, timeoutMs: 50 }))).rejects.toMatchObject({ code: '57014' })
    const afterCancel = await probe()
    expect(afterCancel).toMatchObject(expected())
    expect(afterCancel.pid).toBe(used.pid)
    // The admin's connection killed mid-transaction: destroyed, the reader gets a new one.
    await expect(admin(() => withWrite(async (tx) => {
      const [{ pid }] = await tx.query<{ pid: number }>('select pg_backend_pid() pid')
      await owner('select pg_terminate_backend($1)', [pid])
      await tx.query('select 1')
    }, core))).rejects.toBeDefined()
    const afterKill = await probe()
    expect(afterKill).toMatchObject(expected())
    expect(afterKill.pid).not.toBe(used.pid)
    // The reset after the admin's transaction fails: that connection is destroyed, not pooled.
    const beforeReset = await adminPid()
    const query = pg.Client.prototype.query
    const spy = vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (this: pg.Client, ...args: unknown[]) {
      if (args[0] === 'discard all') { spy.mockRestore(); return Promise.reject(new Error('reset failed')) as never }
      return (query as (...a: unknown[]) => unknown).apply(this, args) as never
    })
    try {
      await admin(() => withWrite((tx) => tx.run(`update core.signals set label = 'adv' where id = 'adv-a4-crm'`), core))
    } finally { spy.mockRestore() }
    const afterReset = await probe()
    expect(afterReset).toMatchObject(expected())
    expect(afterReset.pid).not.toBe(beforeReset.pid)
    expect((await owner<{ n: number }>(`select count(*)::int n from pg_stat_activity where pid = $1`, [beforeReset.pid]))[0]!.n).toBe(0)
  })
})

// ---- A9 addendum: MERGE under row security (raw box_core; the executor refuses MERGE) ----

describe('A9 MERGE', () => {
  afterAll(async () => { await owner(`delete from core.signals where id like 'adv-%'`) })

  it('cannot update a row outside the write areas nor insert one', async () => {
    await owner(`insert into core.signals (id, label, signal_group, channel, source, "interval", accumulation, direction, description, depends_on, area, sort, created_at, updated_at)
      values ('adv-sup', 'adv', '', 'business', 'manual', 'day', 'snapshot', 'up', '', '[]'::jsonb, 'support', 0, now(), now())`)
    const c = await raw('box_core')
    try {
      const merge = async (id: string, area: string) => {
        await c.query('begin')
        await c.query(`set local box.read_areas = 'crm,support'; set local box.write_areas = 'crm'`)
        try {
          return await c.query(`merge into core.signals s using (select $1::text id, $2::text area) v on s.id = v.id
            when matched then update set label = 'merged'
            when not matched then insert (id, label, signal_group, channel, source, "interval", accumulation, direction, description, depends_on, area, sort, created_at, updated_at)
              values (v.id, 'merged', '', 'business', 'manual', 'day', 'snapshot', 'up', '', '[]'::jsonb, v.area, 0, now(), now())`, [id, area])
        } finally { await c.query('rollback') }
      }
      // A readable but not writable row: the UPDATE's policy refuses it.
      expect(await codeOf(merge('adv-sup', 'support'))).toBe('42501')
      // A new row outside the write areas: WITH CHECK refuses it.
      expect(await codeOf(merge('adv-new', 'support'))).toBe('42501')
      expect(await codeOf(merge('adv-new', 'crm'))).toBe('ok')
    } finally { await c.end() }
    expect((await owner<{ label: string }>(`select label from core.signals where id = 'adv-sup'`))[0]!.label).toBe('adv')
  })
})
