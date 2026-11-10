// The per-file database harness: a clone of the run's migrated template, routed by role.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { Access } from '../../auth/access.js'
import { policyRevision } from '../../auth/policy-revision.js'
import type { Principal } from '../../auth/principal.js'
import { asSystem, fillRequest, runInRequest } from '../../request-context.js'
import { withRead, withWrite } from './store.js'
import { useTestDatabase, type TestDatabase } from './testing.js'

const member = <T>(fn: () => Promise<T>) => runInRequest(() => {
  const access: Access = { role: 'member', areas: new Map(), fallback: 'write', admin: false, revision: policyRevision() }
  fillRequest({ principal: { id: 'mo', name: 'Mo', kind: 'human', role: 'member' } as unknown as Principal, access })
  return fn()
})

describe('useTestDatabase', () => {
  let db: TestDatabase
  beforeAll(async () => { db = await useTestDatabase(inject('boxDb')) }, 60_000)
  afterAll(() => db?.drop())

  it('serves every registered model from its owner schema', async () => {
    const schemas = await db.owner<{ s: string }>(`select nspname s from pg_namespace`)
    expect(schemas.map((t) => t.s)).toEqual(expect.arrayContaining(['core', 'ext']))
    const tables = await db.owner<{ t: string }>(`select table_schema || '.' || table_name t from information_schema.tables`)
    expect(tables.map((t) => t.t)).toEqual(expect.arrayContaining(['core.users']))
  })

  it('routes a member to its login on the clone', async () => {
    const [who] = await member(() => withRead<{ u: string; d: string }>('select current_user u, current_database() d'))
    expect(who).toEqual({ u: expect.stringMatching(/^box_role_\d+$/), d: db.database })
    await asSystem('test', () => withWrite((tx) => tx.run(`insert into core.kv_state (key, value) values ('k', '{"a":1}')`)))
    expect(await member(() => withRead(`select value from core.kv_state`, [], { reach: 'core' }))).toEqual([{ value: { a: 1 } }])
  })
})
