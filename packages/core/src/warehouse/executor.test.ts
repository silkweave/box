// The executor against real clusters on both engines: login routing from context, transactions
// and nesting, the classifier, context settings, pool reset, budget, afterCommit, value shapes.
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Access } from '../auth/access.js'
import type { Principal } from '../auth/principal.js'
import { engineAvailable, startTestCluster, type TestCluster } from '../db/testing.js'
import { asBootstrap, asSystem, fillRequest, runInRequest, withoutContext } from '../request-context.js'
import { afterCommit, Budget, classify, Executor, ExecutorError, isoFromTimestamptz, safeInt8, setRoleLoginsForTests } from './executor.js'

describe('classify', () => {
  it('admits data statements and refuses lifecycle forms', () => {
    for (const ok of ['select 1', '  -- c\n(select 1)', '/* x */ with a as (select 1) select * from a', 'insert into t values (1)'])
      expect(classify(ok)).toBeNull()
    for (const bad of ['set work_mem = 1', 'SET LOCAL box.principal = 1', 'reset all', 'begin', 'commit', 'savepoint a', 'discard all', 'do $$ begin end $$', 'call p()', 'copy t to stdout', 'create table x (a int)', 'alter role current_user set work_mem = 1', 'listen x', 'prepare p as select 1', '/* unterminated', 'vacuum', 'MERGE into t using s on true when matched then delete', 'with s as (select 1) merge into t using s on true when matched then delete'])
      expect(classify(bad)).not.toBeNull()
  })
})

describe('value shapes', () => {
  it('keeps timestamp precision and refuses unsafe int8', () => {
    expect(isoFromTimestamptz('2026-11-06 05:00:01.123456+00')).toBe('2026-11-06T05:00:01.123456Z')
    expect(isoFromTimestamptz('2026-11-06 05:00:01+00')).toBe('2026-11-06T05:00:01Z')
    expect(() => isoFromTimestamptz('2026-11-06 05:00:01+01')).toThrow()
    expect(safeInt8('9007199254740991')).toBe(9007199254740991)
    expect(() => safeInt8('9007199254740993')).toThrow()
  })
})

const principal = (id: string): Principal => ({ id, name: id, kind: 'human', role: 'sales' } as unknown as Principal)
const access = (role: string, areas: [string, 'read' | 'write'][]): Access => ({ role, areas: new Map(areas), fallback: 'none', admin: false, revision: 7 })
function asPrincipal<T>(id: string, role: string, areas: [string, 'read' | 'write'][], fn: () => Promise<T>): Promise<T> {
  return runInRequest(() => { fillRequest({ principal: principal(id), access: access(role, areas) }); return fn() })
}

for (const engine of ['pgrust', 'native'] as const) {
  describe.skipIf(!engineAvailable(engine))(`executor on ${engine}`, () => {
    let tc: TestCluster
    let ex: Executor

    beforeAll(async () => {
      tc = await startTestCluster(engine)
      await tc.owner('create database box')
      await tc.owner(`
        revoke all on database box from public;
        revoke create on schema public from public;
        revoke execute on function pg_catalog.set_config(text, text, boolean) from public;
        create role box_core login; create role box_system login; create role box_role_1 login;
        grant connect on database box to box_core, box_system, box_role_1;
        create schema core; create schema crm;
        grant usage on schema core to box_core, box_system;
        grant usage on schema crm to box_role_1, box_system;
        create table core.users (id text primary key, name text);
        create table crm.deals (id bigint primary key, title text, at timestamptz, day date, big bigint);
        grant select, insert, update, delete on core.users to box_core, box_system;
        grant select, insert, update, delete on crm.deals to box_role_1, box_system;
        insert into core.users values ('ana', 'Ana');
        insert into crm.deals values (1, 'one', '2026-11-06 05:00:01.123456+00', '2026-11-06', 9007199254740991);
      `, 'box')
      setRoleLoginsForTests(new Map([['sales', 'box_role_1']]))
      ex = new Executor({ host: tc.running.socket, port: tc.running.port, database: 'box' }, new Budget(6, 2, 4))
    }, 120_000)

    afterAll(async () => { await ex?.close(); await tc?.stop() })

    it('refuses work without a context', async () => {
      await expect(withoutContext(() => ex.transaction((tx) => tx.query('select 1')))).rejects.toMatchObject({ code: 'NO_CONTEXT' })
    })

    it('routes a principal to its role login and core reach to box_core', async () => {
      const [area] = await asPrincipal('ana', 'sales', [['crm', 'write']], () => ex.transaction((tx) => tx.query<{ u: string }>('select current_user u')))
      expect(area!.u).toBe('box_role_1')
      const [core] = await asPrincipal('ana', 'sales', [['crm', 'write']], () => ex.transaction((tx) => tx.query<{ u: string }>('select current_user u'), { reach: 'core' }))
      expect(core!.u).toBe('box_core')
      const [sys] = await asSystem('test', () => ex.transaction((tx) => tx.query<{ u: string }>('select current_user u')))
      expect(sys!.u).toBe('box_system')
      await expect(asBootstrap(() => ex.transaction((tx) => tx.query('select 1')))).rejects.toMatchObject({ code: 'NO_LOGIN' })
    })

    it('refuses a role without a login', async () => {
      await expect(asPrincipal('bo', 'nobody', [], () => ex.transaction((tx) => tx.query('select 1')))).rejects.toMatchObject({ code: 'NO_LOGIN' })
    })

    it('denies another domain at the database', async () => {
      await expect(asPrincipal('ana', 'sales', [['crm', 'write']], () => ex.transaction((tx) => tx.query('select * from core.users')))).rejects.toMatchObject({ code: '42501' })
    })

    it('sets the context with SET LOCAL and refuses feature SET and set_config', async () => {
      const [row] = await asPrincipal('ana', 'sales', [['crm', 'write'], ['sink', 'read']], () => ex.transaction((tx) => tx.query<Record<string, string>>(
        `select current_setting('box.principal') p, current_setting('box.read_areas') r, current_setting('box.write_areas') w, current_setting('box.revision') v, current_setting('timezone') tz`)))
      expect(row).toEqual({ p: 'ana', r: 'crm,sink', w: 'crm', v: '7', tz: 'UTC' })
      await expect(asPrincipal('ana', 'sales', [], () => ex.transaction((tx) => tx.run('set work_mem = 1')))).rejects.toMatchObject({ code: 'CLASSIFIED' })
      await expect(asPrincipal('ana', 'sales', [], () => ex.transaction((tx) => tx.query(`select set_config('box.principal', 'admin', true)`)))).rejects.toMatchObject({ code: '42501' })
      await expect(asPrincipal('ana', 'sales', [], () => ex.transaction((tx) => tx.query('select 1; select 2')))).rejects.toBeDefined()
    })

    it('reuses the transaction on the same login and refuses another login inside it', async () => {
      await asPrincipal('ana', 'sales', [['crm', 'write']], () => ex.transaction(async (tx) => {
        const [a] = await tx.query<{ x: number }>('select txid_current()::int x')
        const [b] = await ex.transaction((inner) => inner.query<{ x: number }>('select txid_current()::int x'))
        expect(b!.x).toBe(a!.x)
        await expect(ex.transaction((t) => t.query('select 1'), { reach: 'core' })).rejects.toMatchObject({ code: 'NESTED_LOGIN' })
      }))
    })

    it('rolls back on error and runs afterCommit hooks only after commit', async () => {
      const seen: string[] = []
      await expect(asSystem('test', () => ex.transaction(async (tx) => {
        await tx.run(`insert into crm.deals (id, title) values (2, 'two')`)
        afterCommit(() => seen.push('rolled-back'))
        throw new Error('boom')
      }))).rejects.toThrow('boom')
      await asSystem('test', () => ex.transaction(async (tx) => {
        expect(await tx.query(`select 1 from crm.deals where id = 2`)).toHaveLength(0)
        await tx.run(`insert into crm.deals (id, title) values (3, 'three')`)
        afterCommit(() => seen.push('committed'))
        expect(seen).toEqual([])
      }))
      expect(seen).toEqual(['committed'])
    })

    it('read-only transactions refuse writes; nested writes inside them are refused', async () => {
      await expect(asSystem('test', () => ex.transaction((tx) => tx.run(`delete from crm.deals where id = 3`), { readOnly: true }))).rejects.toMatchObject({ code: '25006' })
      await expect(asSystem('test', () => ex.transaction(() => ex.transaction((t) => t.query('select 1')), { readOnly: true }))).rejects.toMatchObject({ code: 'READ_ONLY' })
    })

    it('repeatable read sees one snapshot across statements; read committed sees each commit; nesting cannot claim it', async () => {
      const count = (t: { query: (sql: string) => Promise<{ n: string }[]> }) => t.query(`select count(*)::text as n from crm.deals`).then((r) => Number(r[0]!.n))
      const insert = (id: number) => asSystem('test', () => ex.transaction((tx) => tx.run(`insert into crm.deals (id, title) values (${id}, 'x')`)))
      // A reader takes its first count, waits while another connection commits a row, then counts again.
      const readAcross = async (isolation: 'repeatable read' | undefined, id: number): Promise<number[]> => {
        let firstDone!: () => void
        const first = new Promise<void>((resolve) => { firstDone = resolve })
        let go!: () => void
        const committed = new Promise<void>((resolve) => { go = resolve })
        const reading = asSystem('test', () => ex.transaction(async (tx) => {
          const before = await count(tx as never)
          firstDone()
          await committed
          return [before, await count(tx as never)]
        }, { readOnly: true, ...(isolation ? { isolation } : {}) }))
        await first
        await insert(id)
        go()
        return reading
      }
      const snapshot = await readAcross('repeatable read', 901)
      expect(snapshot[1]).toBe(snapshot[0])
      const fresh = await readAcross(undefined, 902)
      expect(fresh[1]).toBe(fresh[0]! + 1)
      await expect(asSystem('test', () => ex.transaction(() => ex.transaction((t) => t.query('select 1'), { readOnly: true, isolation: 'repeatable read' }), { readOnly: true }))).rejects.toMatchObject({ code: 'ISOLATION' })
      await asSystem('test', () => ex.transaction((tx) => tx.run(`delete from crm.deals where id in (901, 902)`)))
    })

    it('returns the documented value shapes', async () => {
      const [row] = await asSystem('test', () => ex.transaction((tx) => tx.query<Record<string, unknown>>(`select id, at, day, big, count(*) over () n from crm.deals where id = 1`)))
      expect(row).toEqual({ id: 1, at: '2026-11-06T05:00:01.123456Z', day: '2026-11-06', big: 9007199254740991, n: 1 })
    })

    it('leaves no session state behind and keeps named statements working after reset', async () => {
      for (let i = 0; i < 3; i++) {
        await asSystem('test', () => ex.transaction(async (tx) => {
          const [r] = await tx.query<{ n: number }>({ name: 'named-probe', text: 'select count(*)::int n from crm.deals' })
          expect(r!.n).toBeGreaterThan(0)
          expect((await tx.query<{ v: string }>(`select current_setting('box.principal', true) v`))[0]!.v).toBe('system:test')
        }))
      }
    })

    it('rejects fast when the budget and its queue are full, and serves core from the reserve', async () => {
      const tight = new Executor({ host: tc.running.socket, port: tc.running.port, database: 'box' }, new Budget(3, 1, 0))
      let releaseAll!: () => void
      const gate = new Promise<void>((r) => { releaseAll = r })
      const holders = [1, 2].map(() => asSystem('test', () => tight.transaction(async () => { await gate })))
      await new Promise((r) => setTimeout(r, 200))
      await expect(asSystem('test', () => tight.transaction((tx) => tx.query('select 1')))).rejects.toMatchObject({ code: 'BUDGET' })
      const [core] = await asPrincipal('ana', 'sales', [], () => tight.transaction((tx) => tx.query<{ u: string }>('select current_user u'), { reach: 'core' }))
      expect(core!.u).toBe('box_core')
      releaseAll()
      await Promise.all(holders)
      await tight.close()
    })

    it('never holds more open connections than the total while retired ones are still closing', async () => {
      const tight = new Executor({ host: tc.running.socket, port: tc.running.port, database: 'box' }, new Budget(2, 0, 4))
      const sessions = async () => {
        const c = new pg.Client({ host: tc.running.socket, port: tc.running.port, user: 'box_owner', database: 'box' })
        await c.connect()
        try { return Number((await c.query(`select count(*) n from pg_stat_activity where datname = 'box' and usename in ('box_core', 'box_system')`)).rows[0].n) } finally { await c.end() }
      }
      // The file's other executor keeps its own idle sessions on these logins.
      const base = await sessions()
      // Two idle box_system connections.
      let open!: () => void
      const gate = new Promise<void>((r) => { open = r })
      const two = [1, 2].map(() => asSystem('test', () => tight.transaction(async () => { await gate })))
      await new Promise((r) => setTimeout(r, 200))
      open()
      await Promise.all(two)
      expect(tight.openConnections()).toBe(2)
      // Their closes are held: the server sessions stay while retirement is under way.
      const held: Array<() => void> = []
      const end = pg.Client.prototype.end
      const spy = vi.spyOn(pg.Client.prototype, 'end').mockImplementation(function (this: pg.Client) {
        if ((this as unknown as { user: string }).user !== 'box_system') return (end as () => Promise<void>).call(this) as never
        return new Promise<void>((resolve) => held.push(() => { (end as () => Promise<void>).call(this).then(() => resolve(), () => resolve()) })) as never
      })
      try {
        const retiring = tight.retireLogins(['box_system'])
        const done: boolean[] = [false, false]
        const core = [0, 1].map((i) => asPrincipal('ana', 'sales', [], () => tight.transaction((tx) => tx.query('select 1'), { reach: 'core' })).then(() => { done[i] = true }))
        await new Promise((r) => setTimeout(r, 300))
        expect(tight.openConnections()).toBeLessThanOrEqual(2)
        expect(done).toEqual([false, false])
        expect(await sessions()).toBeLessThanOrEqual(base + 2)
        // Each completed close lets one waiting acquire open its connection.
        while (held.length || done.includes(false)) {
          held.shift()?.()
          await new Promise((r) => setTimeout(r, 50))
          expect(tight.openConnections()).toBeLessThanOrEqual(2)
          expect(await sessions()).toBeLessThanOrEqual(base + 2)
        }
        await Promise.all(core)
        await retiring
      } finally {
        spy.mockRestore()
        for (const h of held) h()
      }
      await tight.close()
    })
  })
}

describe('Budget', () => {
  it('hands a freed slot to the waiter, so a caller arriving meanwhile queues instead of exceeding the total', async () => {
    const b = new Budget(2, 0, 10)
    await b.take(false); await b.take(false)
    let waiterIn = false
    const waiter = b.take(false).then(() => { waiterIn = true })
    b.give()
    let lateIn = false
    const late = b.take(false).then(() => { lateIn = true })
    await waiter
    await new Promise((r) => setTimeout(r, 10))
    expect([waiterIn, lateIn, b.inUse]).toEqual([true, false, 2])
    b.give()
    await late
    expect(b.inUse).toBe(2)
  })
})

describe('ExecutorError', () => {
  it('carries a code', () => { expect(new ExecutorError('BUDGET', 'x').code).toBe('BUDGET') })
})
