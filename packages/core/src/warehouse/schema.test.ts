// orderFeatures + assertOwnership: the two guards that run before a single statement is executed.
// Deliberately no database - `pnpm schema:check` covers the DDL on real DuckDB files (SEAM § 3.5);
// this covers the graph rules, which are pure and worth failing fast on.

import { describe, expect, it } from 'vitest'
import { orderFeatures, assertOwnership } from './schema.js'
import type { CoreFeature } from '../feature.js'

const feature = (id: string, dependsOn?: string[], tables: string[] = []): CoreFeature => ({
  id,
  ...(dependsOn ? { dependsOn } : {}),
  models: tables.map((table) => ({ table, pk: ['id'], columns: { id: { kind: 'text' as const } } })),
  migrations: [],
})

describe('orderFeatures', () => {
  it('puts core first and every dependency before its dependent', () => {
    const order = orderFeatures([feature('c', ['b']), feature('a'), feature('b', ['a'])]).map((f) => f.id)
    expect(order[0]).toBe('core')
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'))
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'))
  })

  it('is deterministic regardless of registry order - two Boxes migrate in the same sequence', () => {
    const set = [feature('z'), feature('m', ['z']), feature('a')]
    expect(orderFeatures(set).map((f) => f.id)).toEqual(orderFeatures([...set].reverse()).map((f) => f.id))
  })

  it('rejects a cycle, naming the trail', () => {
    expect(() => orderFeatures([feature('a', ['b']), feature('b', ['a'])])).toThrow(/cycle: a -> b -> a/)
  })

  it('rejects a dependsOn on a feature that is not installed', () => {
    expect(() => orderFeatures([feature('a', ['ghost'])])).toThrow(/"a" depends on "ghost", which is not present/)
  })
})

describe('assertOwnership', () => {
  it('rejects two features declaring the same table', () => {
    expect(() => assertOwnership([feature('a', undefined, ['shared']), feature('b', undefined, ['shared'])])).toThrow(
      /"shared" is declared by both "a" and "b"/,
    )
  })

  it('rejects a duplicate migration name within one feature - the ledger key would collide', () => {
    const f: CoreFeature = { id: 'a', models: [], migrations: [{ name: '001-x' }, { name: '001-x' }] }
    expect(() => assertOwnership([f])).toThrow(/declares migration "001-x" twice/)
  })
})
