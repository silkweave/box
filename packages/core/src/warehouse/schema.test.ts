// orderOwners and the area map: the guards that run before a single statement is executed.
// Deliberately no database - pg/schema.test.ts covers the runner on real clusters; this covers the
// graph rules, which are pure and worth failing fast on.

import { describe, expect, it } from 'vitest'
import { orderOwners, type SchemaOwner } from './schema.js'
import { buildAreaMap } from './pg/areas.js'

const owner = (id: string, dependsOn?: string[], tables: string[] = []): SchemaOwner => ({
  id,
  ...(dependsOn ? { dependsOn } : {}),
  models: tables.map((table) => ({ table, pk: ['id'], columns: { id: { kind: 'text' as const } } })),
  migrations: [],
})
const core = owner('core')

describe('orderOwners', () => {
  it('puts core first and every dependency before its dependent', () => {
    const order = orderOwners(core, [owner('c', ['b']), owner('a'), owner('b', ['a'])]).map((f) => f.id)
    expect(order[0]).toBe('core')
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'))
  })

  it('is deterministic regardless of registry order - two Boxes migrate in the same sequence', () => {
    const set = [owner('z'), owner('m', ['z']), owner('a')]
    expect(orderOwners(core, set).map((f) => f.id)).toEqual(orderOwners(core, [...set].reverse()).map((f) => f.id))
  })

  it('rejects a cycle, naming the trail', () => {
    expect(() => orderOwners(core, [owner('a', ['b']), owner('b', ['a'])])).toThrow(/cycle: a -> b -> a/)
  })

  it('rejects a dependsOn on a feature that is not installed', () => {
    expect(() => orderOwners(core, [owner('a', ['ghost'])])).toThrow(/"a" depends on "ghost", which is not present/)
  })
})

describe('table ownership', () => {
  it('rejects two features declaring the same table', () => {
    expect(() => buildAreaMap([], [owner('a', undefined, ['shared']), owner('b', undefined, ['shared'])])).toThrow(
      /"shared" is declared by both "a" and "b"/,
    )
  })
})
