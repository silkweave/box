import { describe, expect, test } from 'bun:test'
import {
  pruneInactive,
  addDays,
  countActive,
  inWindow,
  isActive,
  matchAll,
  matchFilter,
  normalizeAll,
  normalizeFilter,
  sameAll,
  sameFilter,
  summarize,
} from './match.ts'
import { PERSON_ME, PERSON_NONE, type FilterField, type FilterSchema } from './types.ts'

const ctx = { today: '2026-10-30', me: 'ada' }

describe('days', () => {
  test('adds across month and year ends', () => {
    expect(addDays('2026-10-30', 6)).toBe('2026-11-05')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  test('windows, seen from today', () => {
    const t = ctx.today
    expect(inWindow('overdue', '2026-10-29', t)).toBe(true)
    expect(inWindow('overdue', '2026-10-29', t, false)).toBe(false)
    expect(inWindow('overdue', t, t)).toBe(false)
    expect(inWindow('today', t, t)).toBe(true)
    expect(inWindow('next_7', '2026-11-05', t)).toBe(true)
    expect(inWindow('next_7', '2026-11-06', t)).toBe(false)
    expect(inWindow('next_7', '2026-10-29', t)).toBe(false)
    expect(inWindow('next_30', '2026-11-28', t)).toBe(true)
    expect(inWindow('next_30', '2026-11-29', t)).toBe(false)
    expect(inWindow('this_month', '2026-10-01', t)).toBe(true)
    expect(inWindow('this_month', '2026-11-01', t)).toBe(false)
    expect(inWindow('later', '2026-11-06', t)).toBe(true)
    expect(inWindow('later', '2026-11-05', t)).toBe(false)
    expect(inWindow('past_7', '2026-10-24', t)).toBe(true)
    expect(inWindow('past_7', '2026-10-23', t)).toBe(false)
    expect(inWindow('past_30', '2026-10-01', t)).toBe(true)
    expect(inWindow('past_30', '2026-09-30', t)).toBe(false)
  })
})

describe('isActive', () => {
  test('absent, null, empty and blank narrow nothing', () => {
    expect(isActive('options', undefined)).toBe(false)
    expect(isActive('options', [])).toBe(false)
    expect(isActive('options', ['a'])).toBe(true)
    expect(isActive('text', '  ')).toBe(false)
    expect(isActive('boolean', false)).toBe(true)
    expect(isActive('date', {})).toBe(false)
    expect(isActive('date', { window: 'today' })).toBe(true)
    expect(isActive('number', { op: 'gt' })).toBe(false)
    expect(isActive('number', { op: 'empty' })).toBe(true)
  })

  test('counts per schema', () => {
    const schema: FilterSchema = { status: 'options', due: 'date', done: 'boolean' }
    expect(countActive(schema, { status: [], due: { window: 'today' }, done: false, stray: ['x'] })).toBe(2)
  })
})

describe('normalize', () => {
  test('repairs, or reads as no filter', () => {
    expect(normalizeFilter('options', ['a', 'a', 'b'])).toEqual(['a', 'b'])
    expect(normalizeFilter('options', ['overdue', 3])).toBeNull()
    // An old bucket array on a field that is now a date reads as no filter.
    expect(normalizeFilter('date', ['overdue'])).toBeNull()
    expect(normalizeFilter('date', { window: 'someday' })).toBeNull()
    expect(normalizeFilter('date', { from: '2026-10-01', to: 'nope' })).toEqual({ from: '2026-10-01' })
    expect(normalizeFilter('date', { from: '2026-02-31' })).toBeNull()
    expect(normalizeFilter('date', { none: true })).toEqual({ none: true })
    expect(normalizeFilter('number', { op: 'between', value: 9, to: 2 })).toEqual({ op: 'between', value: 2, to: 9 })
    expect(normalizeFilter('number', { op: 'gt', value: '5' })).toBeNull()
    expect(normalizeFilter('boolean', 'true')).toBeNull()
  })

  test('a whole record keeps only known, active keys', () => {
    const schema: FilterSchema = { status: 'options', due: 'date' }
    expect(normalizeAll(schema, { status: ['a'], due: ['later'], gone: ['x'] })).toEqual({ status: ['a'] })
    expect(normalizeAll(schema, null)).toEqual({})
  })
})

describe('same', () => {
  test('lists ignore order, inactive values are all alike', () => {
    expect(sameFilter('options', ['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameFilter('options', [], undefined)).toBe(true)
    expect(sameFilter('options', ['a'], undefined)).toBe(false)
    expect(sameFilter('date', { window: 'today' }, { window: 'today' })).toBe(true)
    expect(sameFilter('date', { from: '2026-10-01' }, { from: '2026-10-01', to: '2026-10-31' })).toBe(false)
    expect(sameFilter('number', { op: 'gt', value: 5 }, { op: 'gte', value: 5 })).toBe(false)
    expect(sameFilter('text', 'Foo ', 'foo')).toBe(true)
  })

  test('over a schema', () => {
    const schema: FilterSchema = { status: 'options', due: 'date' }
    expect(sameAll(schema, { status: ['a', 'b'] }, { status: ['b', 'a'], due: null })).toBe(true)
    expect(sameAll(schema, {}, { due: { none: true } })).toBe(false)
  })
})

describe('match', () => {
  test('options: any of, a blank fails', () => {
    expect(matchFilter('options', ['a', 'b'], 'b', ctx)).toBe(true)
    expect(matchFilter('options', ['a'], ['x', 'a'], ctx)).toBe(true)
    expect(matchFilter('options', ['a'], null, ctx)).toBe(false)
    expect(matchFilter('options', [], null, ctx)).toBe(true)
  })

  test('person: me and nobody', () => {
    expect(matchFilter('person', [PERSON_ME], 'ada', ctx)).toBe(true)
    expect(matchFilter('person', [PERSON_ME], 'ben', ctx)).toBe(false)
    expect(matchFilter('person', [PERSON_ME], 'ada', { today: ctx.today })).toBe(false)
    expect(matchFilter('person', [PERSON_NONE], null, ctx)).toBe(true)
    expect(matchFilter('person', ['ben', PERSON_NONE], 'ben', ctx)).toBe(true)
    expect(matchFilter('person', ['ben'], null, ctx)).toBe(false)
  })

  test('date: windows, ranges, no date, closed rows are never overdue', () => {
    expect(matchFilter('date', { window: 'overdue' }, '2026-10-01', ctx)).toBe(true)
    expect(matchFilter('date', { window: 'overdue' }, { day: '2026-10-01', open: false }, ctx)).toBe(false)
    expect(matchFilter('date', { window: 'next_7' }, null, ctx)).toBe(false)
    expect(matchFilter('date', { from: '2026-10-01' }, '2026-12-01', ctx)).toBe(true)
    expect(matchFilter('date', { to: '2026-10-01' }, '2026-12-01', ctx)).toBe(false)
    expect(matchFilter('date', { from: '2026-10-01', to: '2026-10-31' }, '2026-10-31', ctx)).toBe(true)
    expect(matchFilter('date', { none: true }, null, ctx)).toBe(true)
    expect(matchFilter('date', { none: true }, { day: '2026-10-01' }, ctx)).toBe(false)
  })

  test('number: comparisons, ranges and blanks', () => {
    expect(matchFilter('number', { op: 'gt', value: 5 }, 6, ctx)).toBe(true)
    expect(matchFilter('number', { op: 'gt', value: 5 }, 5, ctx)).toBe(false)
    expect(matchFilter('number', { op: 'lte', value: 5 }, 5, ctx)).toBe(true)
    expect(matchFilter('number', { op: 'ne', value: 5 }, null, ctx)).toBe(false)
    expect(matchFilter('number', { op: 'between', value: 1, to: 3 }, 3, ctx)).toBe(true)
    expect(matchFilter('number', { op: 'empty' }, null, ctx)).toBe(true)
    expect(matchFilter('number', { op: 'set' }, 0, ctx)).toBe(true)
  })

  test('text and boolean', () => {
    expect(matchFilter('text', 'ACME', 'The Acme Corp', ctx)).toBe(true)
    expect(matchFilter('text', 'acme', null, ctx)).toBe(false)
    expect(matchFilter('boolean', false, null, ctx)).toBe(true)
    expect(matchFilter('boolean', true, null, ctx)).toBe(false)
    expect(matchFilter('boolean', true, true, ctx)).toBe(true)
  })

  test('matchAll skips inactive fields and fails on the first miss', () => {
    const schema: FilterSchema = { status: 'options', owner: 'person', due: 'date' }
    const row: Record<string, string | null> = { status: 'open', owner: null, due: '2026-10-31' }
    const of = (k: string) => row[k] ?? null
    expect(matchAll(schema, { status: [], owner: undefined }, of, ctx)).toBe(true)
    expect(matchAll(schema, { status: ['open'], due: { window: 'next_7' } }, of, ctx)).toBe(true)
    expect(matchAll(schema, { status: ['open'], owner: [PERSON_ME] }, of, ctx)).toBe(false)
  })
})

describe('summarize', () => {
  const owner: FilterField = { key: 'owner', title: 'Owner', type: 'person', options: [{ value: 'ada', label: 'Ada' }, { value: 'ben', label: 'Ben' }, { value: 'cy', label: 'Cy' }], noneLabel: 'No owner' }
  test('a chip worth of words', () => {
    expect(summarize(owner, undefined)).toBe('Any')
    expect(summarize(owner, ['ada', 'ben'])).toBe('Ada, Ben')
    expect(summarize(owner, [PERSON_ME, 'ada', 'ben', PERSON_NONE])).toBe('Me, Ada +2')
    expect(summarize(owner, [PERSON_NONE])).toBe('No owner')
    expect(summarize({ key: 'due', title: 'Due', type: 'date', windows: [] }, { window: 'next_7' })).toBe('Next 7 days')
    expect(summarize({ key: 'due', title: 'Due', type: 'date', windows: [] }, { from: '2026-10-01' })).toBe('From 2026-10-01')
    expect(summarize({ key: 'h', title: 'Estimate', type: 'number', unit: 'h' }, { op: 'gt', value: 5 })).toBe('> 5 h')
    expect(summarize({ key: 'h', title: 'Estimate', type: 'number', unit: 'h' }, { op: 'between', value: 1, to: 4 })).toBe('1 to 4 h')
    expect(summarize({ key: 'p', title: 'Primary', type: 'boolean' }, false)).toBe('Off')
    expect(summarize({ key: 'q', title: 'Text', type: 'text' }, ' acme ')).toBe('"acme"')
  })
})

describe('prefix, skip and pruneInactive', () => {
  test('a number prefix reads before the value', () => {
    expect(summarize({ key: 'm', title: 'MRR', type: 'number', prefix: '$' }, { op: 'gt', value: 0 })).toBe('> $0')
    expect(summarize({ key: 'm', title: 'MRR', type: 'number', prefix: '$' }, { op: 'between', value: 1, to: 5 })).toBe('$1 to $5')
  })
  test('matchAll leaves skipped fields to the host', () => {
    const schema: FilterSchema = { a: 'options', b: 'options' }
    const row = (key: string) => (key === 'a' ? 'x' : 'y')
    expect(matchAll(schema, { a: ['x'], b: ['z'] }, row, { today: '2026-10-30' })).toBe(false)
    expect(matchAll(schema, { a: ['x'], b: ['z'] }, row, { today: '2026-10-30' }, ['b'])).toBe(true)
  })
  test('pruneInactive keeps only fields that narrow something', () => {
    const schema: FilterSchema = { a: 'options', d: 'date', t: 'text', n: 'number' }
    expect(pruneInactive(schema, { a: [], d: { window: 'today' }, t: '  ', n: null, x: ['stray'] })).toEqual({ d: { window: 'today' } })
  })
})
