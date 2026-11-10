// Kysely on the executor (kysely.ts): the qualify plugin's SQL, and the executor's contract kept
// for built queries on the run's engine (BOX_TEST_ENGINE): no context refuses, statements join the
// open transaction (one commit, one rollback, afterCommit order), a lone SELECT runs read-only, the
// classifier still applies to raw SQL, Kysely's own transactions and streaming are refused.
import { describe, expect, it } from 'vitest'
import { asBootstrap, withoutContext } from '../request-context.js'
import { defineModel } from './model-spec.js'
import { afterCommit, ExecutorError } from './executor.js'
import { coreDb, featureDb, json, now, sql, type ModelDb, type Selectable } from './kysely.js'
import { withRead, withReadOnly, withWrite } from './pg/store.js'

const KV_STATE = defineModel({
  table: 'kv_state',
  pk: ['key'],
  columns: { key: { kind: 'text' }, value: { kind: 'json' }, updated_at: { kind: 'timestamp', default: 'now()' } },
})
type CoreKv = ModelDb<readonly [typeof KV_STATE]>
const db = coreDb<CoreKv>()

const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => e.code ?? e.message)

describe('qualify plugin', () => {
  const schemaOf = (t: string) => ({ deals: 'crm', accounts: 'crm', users: 'core' })[t]
  interface Crm { deals: { id: number; title: string | null; account: number | null }; accounts: { id: number; name: string }; policy_state: { id: number }; 'core.policy_state': { id: number } }
  const q = featureDb<Crm>(schemaOf)

  it('qualifies FROM, JOIN, INTO, UPDATE and DELETE targets, not references', () => {
    expect(q.selectFrom('deals as d').innerJoin('accounts', 'accounts.id', 'd.account').select(['d.id', 'accounts.name']).where('d.id', '=', 1).compile().sql)
      .toBe('select "d"."id", "accounts"."name" from "crm"."deals" as "d" inner join "crm"."accounts" on "accounts"."id" = "d"."account" where "d"."id" = $1')
    expect(q.insertInto('deals').values({ id: 1 }).onConflict((oc) => oc.column('id').doUpdateSet({ title: (eb) => eb.ref('excluded.title') })).compile().sql)
      .toBe('insert into "crm"."deals" ("id") values ($1) on conflict ("id") do update set "title" = "excluded"."title"')
    expect(q.updateTable('deals').set({ title: 'x' }).where('id', '=', 1).compile().sql).toBe('update "crm"."deals" set "title" = $1 where "id" = $2')
    expect(q.deleteFrom('deals').where('id', '=', 1).compile().sql).toBe('delete from "crm"."deals" where "id" = $1')
  })

  it('leaves CTE names, unknown tables, explicit schemas, FOR UPDATE OF and row references alone', () => {
    expect(q.with('deals', (w) => w.selectFrom('accounts').selectAll()).selectFrom('deals').selectAll().compile().sql)
      .toBe('with "deals" as (select * from "crm"."accounts") select * from "deals"')
    expect(q.selectFrom('policy_state').selectAll().compile().sql).toBe('select * from "policy_state"')
    expect(q.selectFrom('core.policy_state').selectAll().compile().sql).toBe('select * from "core"."policy_state"')
    expect(q.selectFrom('deals').selectAll().forUpdate('deals').compile().sql).toBe('select * from "crm"."deals" for update of "deals"')
    expect(q.selectFrom('deals as d').select((eb) => eb.fn('to_json', [eb.table('d')]).as('j')).compile().sql)
      .toBe('select to_json("d") as "j" from "crm"."deals" as "d"')
  })

  it('scopes CTE names in declaration order, and exposes all of them to the outer query', () => {
    // A non-recursive CTE body sees earlier CTEs only: its own name is still the base table.
    expect(q.with('deals', (w) => w.selectFrom('deals').selectAll()).selectFrom('deals').selectAll().compile().sql)
      .toBe('with "deals" as (select * from "crm"."deals") select * from "deals"')
    // A forward reference is the base table too; a backward one is the CTE.
    expect(q.with('a', (w) => w.selectFrom('accounts').selectAll()).with('accounts', (w) => w.selectFrom('a').selectAll()).selectFrom('accounts').selectAll().compile().sql)
      .toBe('with "a" as (select * from "crm"."accounts"), "accounts" as (select * from "a") select * from "accounts"')
    // Recursive: a CTE sees itself and the ones after it.
    expect(q.withRecursive('accounts', (w) => w.selectFrom('accounts').selectAll()).selectFrom('accounts').selectAll().compile().sql)
      .toBe('with recursive "accounts" as (select * from "accounts") select * from "accounts"')
    // A nested WITH shadows only inside its own statement.
    expect(q.with('a', (w) => w.selectFrom('deals').selectAll()).selectFrom('accounts').where('id', 'in', (eb) => eb.selectFrom('a').select('id')).selectAll().compile().sql)
      .toBe('with "a" as (select * from "crm"."deals") select * from "crm"."accounts" where "id" in (select "id" from "a")')
  })
})

describe('CTE scoping on the executor', () => {
  it('runs a same-name base table inside a non-recursive CTE and a forward reference with an empty search path', async () => {
    await withWrite(async () => {
      await db.insertInto('kv_state').values({ key: 'cte-1', value: JSON.stringify(1) }).execute()
      const same = await db.with('kv_state', (w) => w.selectFrom('kv_state').select('key').where('key', '=', 'cte-1')).selectFrom('kv_state').select('key').execute()
      expect(same).toEqual([{ key: 'cte-1' }])
      const forward = await db
        .with('a', (w) => w.selectFrom('kv_state').select('key').where('key', '=', 'cte-1'))
        .with('kv_state', (w) => w.selectFrom('a').select('key'))
        .selectFrom('kv_state')
        .select('key')
        .execute()
      expect(forward).toEqual([{ key: 'cte-1' }])
      const recursive = await db
        .withRecursive('kv_state', (w) => w.selectFrom('kv_state').select('key').where('key', '=', 'none'))
        .selectFrom('kv_state')
        .select('key')
        .execute()
        .catch((e: { code?: string }) => e.code)
      // A recursive CTE naming itself needs the recursive shape (a union): PostgreSQL says so, rather
      // than the statement resolving to a table the transformer qualified wrongly.
      expect(recursive).toBe('42P19')
    })
  })
})

describe('executor contract', () => {
  it('refuses without a context', async () => {
    const err = await withoutContext(() => db.selectFrom('kv_state').selectAll().execute()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ExecutorError)
    expect((err as ExecutorError).code).toBe('NO_CONTEXT')
  })

  it('runs on the context login and reach', async () => {
    const who = (d: typeof db) => d.selectNoFrom(sql<string>`current_user`.as('u')).executeTakeFirstOrThrow()
    expect((await who(db)).u).toBe('box_system')
    expect((await asBootstrap(() => who(db))).u).toBe('box_core')
  })

  it('runs a lone SELECT read-only and a write in a write transaction', async () => {
    const ro = await db.selectNoFrom(sql<string>`current_setting('transaction_read_only')`.as('ro')).executeTakeFirstOrThrow()
    expect(ro.ro).toBe('on')
    await db.insertInto('kv_state').values({ key: 'k-lone', value: json({ a: 1 }) }).execute()
    const row: Selectable<CoreKv['kv_state']> = await db.selectFrom('kv_state').selectAll().where('key', '=', 'k-lone').executeTakeFirstOrThrow()
    expect(row.value).toEqual({ a: 1 })
    expect(row.updated_at).toMatch(/Z$/)
  })

  it('joins the open transaction: one commit, one rollback, afterCommit after the commit', async () => {
    const order: string[] = []
    await withWrite(async (tx) => {
      await db.insertInto('kv_state').values({ key: 'k-tx', value: json([1, 2]), updated_at: now() }).execute()
      // The same transaction: the raw executor sees the uncommitted row.
      expect(await tx.query(`select key from core.kv_state where key = 'k-tx'`)).toHaveLength(1)
      afterCommit(() => order.push('after'))
      order.push('body')
    }, { reach: 'core' })
    expect(order).toEqual(['body', 'after'])
    expect((await db.selectFrom('kv_state').select('value').where('key', '=', 'k-tx').executeTakeFirstOrThrow()).value).toEqual([1, 2])

    await expect(withWrite(async () => {
      await db.updateTable('kv_state').set({ value: json('gone') }).where('key', '=', 'k-tx').execute()
      throw new Error('roll back')
    }, { reach: 'core' })).rejects.toThrow('roll back')
    expect((await db.selectFrom('kv_state').select('value').where('key', '=', 'k-tx').executeTakeFirstOrThrow()).value).toEqual([1, 2])
  })

  it('reports affected rows and keeps writes out of read-only transactions', async () => {
    const res = await db.updateTable('kv_state').set({ updated_at: now() }).where('key', 'in', ['k-tx', 'k-lone']).executeTakeFirst()
    expect(res.numUpdatedRows).toBe(2n)
    const del = await db.deleteFrom('kv_state').where('key', '=', 'missing').executeTakeFirst()
    expect(del.numDeletedRows).toBe(0n)
    // 25006: read_only_sql_transaction.
    expect(await codeOf(withReadOnly(() => db.deleteFrom('kv_state').execute(), { reach: 'core' }))).toBe('25006')
    expect(await withRead(`select count(*)::int as n from core.kv_state where key like 'k-%'`, [], { reach: 'core' })).toEqual([{ n: 2 }])
  })

  it('passes raw SQL through the classifier and refuses its own transactions and streams', async () => {
    expect(await codeOf(sql`set local work_mem = '1MB'`.execute(db))).toBe('CLASSIFIED')
    expect(await codeOf(db.transaction().execute(async () => {}))).toMatch(/withWrite/)
    expect(await codeOf((async () => { for await (const _ of db.selectFrom('kv_state').selectAll().stream()) void _ })())).toMatch(/keyset/)
  })
})
