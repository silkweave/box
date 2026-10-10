import { describe, expect, it } from 'vitest'
import {
  computeFormulaPoints,
  FormulaError,
  formulaRefs,
  mergeFormulaPoints,
  parseFormula,
  prevSignalBucket,
  renameFormulaRef,
  resolveSignalHistory,
  type FormulaInput,
  type HistoryDefinition,
  type SignalHistorySource,
} from './formula.js'
import { mergeSignalPoints, type StorePoint } from './points.js'
import type { SignalAccumulation, SignalInterval } from './types.js'

const NOW = new Date('2026-10-09T12:00:00Z')

const live = (bucket: string, value: number): StorePoint => ({ bucket, value, source: 'live', note: null })
const manual = (bucket: string, value: number): StorePoint => ({ bucket, value, source: 'manual', note: 'hand' })

function input(interval: SignalInterval, accumulation: SignalAccumulation, points: StorePoint[]): FormulaInput {
  return { interval, accumulation, merged: mergeSignalPoints({ interval, accumulation }, points, { now: NOW }) }
}

/** Evaluate a constant-only formula through the engine (one input supplies the bucket). */
function constant(src: string): number | undefined {
  const ast = parseFormula(`${src} + 0 * x`)
  return computeFormulaPoints('month', ast, new Map([['x', input('month', 'snapshot', [live('2026-10-01', 1)])]]))[0]?.value
}

describe('parsing', () => {
  it('honours precedence, left associativity and parentheses', () => {
    expect(constant('1 + 2 * 3')).toBe(7)
    expect(constant('(1 + 2) * 3')).toBe(9)
    expect(constant('10 - 4 - 3')).toBe(3)
    expect(constant('100 / 10 / 2')).toBe(5)
    expect(constant('2.5 * .5')).toBe(1.25)
  })

  it('handles unary minus', () => {
    expect(constant('-3 + 5')).toBe(2)
    expect(constant('- -4')).toBe(4)
    expect(constant('2 * -(1 + 2)')).toBe(-6)
  })

  it('reads dotted, dashed and @-scoped ids as one token, and quoted ids verbatim', () => {
    const ast = parseFormula('churned-mrr / start(atomicbi.first_response) + github@acme.followers - "npm.pkg.@acme/core"')
    expect(formulaRefs(ast)).toEqual(['churned-mrr', 'atomicbi.first_response', 'github@acme.followers', 'npm.pkg.@acme/core'])
  })

  it('needs spaces around binary minus between ids', () => {
    expect(formulaRefs(parseFormula('a-b'))).toEqual(['a-b'])
    expect(formulaRefs(parseFormula('a - b'))).toEqual(['a', 'b'])
    expect(formulaRefs(parseFormula('a- b'))).toEqual(['a', 'b'])
    expect(formulaRefs(parseFormula('a -b'))).toEqual(['a', 'b'])
  })

  it('lists refs once, in order of appearance, through functions', () => {
    expect(formulaRefs(parseFormula('mrr - prev(mrr) + start(cash) / mrr'))).toEqual(['mrr', 'cash'])
  })

  it('reports errors with their position', () => {
    const at = (src: string): number => {
      try {
        parseFormula(src)
      } catch (e) {
        expect(e).toBeInstanceOf(FormulaError)
        return (e as FormulaError).pos
      }
      throw new Error(`"${src}" parsed`)
    }
    expect(at('')).toBe(0)
    expect(at('1 +')).toBe(3)
    expect(at('(a + b')).toBe(6)
    expect(at('a b')).toBe(2)
    expect(at('a + $')).toBe(4)
    expect(at('sum(a)')).toBe(0)
    expect(at('start(1)')).toBe(6)
    expect(at('2x')).toBe(1)
    expect(at('Mrr')).toBe(0)
    expect(() => parseFormula('a b')).toThrow(/a - b/)
  })
})

describe('renaming a ref', () => {
  it('rewrites tokens, never substrings, and keeps the rest byte-for-byte', () => {
    expect(renameFormulaRef('churned-mrr / start(mrr)  *100', 'mrr', 'arr')).toBe('churned-mrr / start(arr)  *100')
    expect(renameFormulaRef('mrr-eu + mrr', 'mrr', 'revenue.monthly')).toBe('mrr-eu + revenue.monthly')
  })

  it('quotes a new id a bare token cannot spell', () => {
    expect(renameFormulaRef('a * 2', 'a', 'npm.pkg.@acme/core')).toBe('"npm.pkg.@acme/core" * 2')
    expect(renameFormulaRef('"npm.pkg.@acme/core" * 2', 'npm.pkg.@acme/core', 'b')).toBe('b * 2')
  })
})

describe('bucket functions', () => {
  const mrr = input('month', 'snapshot', [live('2026-08-01', 100), live('2026-09-01', 120), live('2026-10-01', 150)])

  it('bare x is the value in the bucket', () => {
    expect(computeFormulaPoints('month', parseFormula('mrr * 2'), new Map([['mrr', mrr]]))).toEqual([
      { bucket: '2026-08-01T00:00:00Z', value: 200 },
      { bucket: '2026-09-01T00:00:00Z', value: 240 },
      { bucket: '2026-10-01T00:00:00Z', value: 300 },
    ])
  })

  it('start(x) is the level entering the bucket', () => {
    expect(computeFormulaPoints('month', parseFormula('start(mrr)'), new Map([['mrr', mrr]]))).toEqual([
      { bucket: '2026-09-01T00:00:00Z', value: 100 },
      { bucket: '2026-10-01T00:00:00Z', value: 120 },
    ])
  })

  it('prev(x) is x in the previous bucket', () => {
    expect(computeFormulaPoints('month', parseFormula('mrr - prev(mrr)'), new Map([['mrr', mrr]]))).toEqual([
      { bucket: '2026-09-01T00:00:00Z', value: 20 },
      { bucket: '2026-10-01T00:00:00Z', value: 30 },
    ])
    expect(prevSignalBucket('2026-01-01T00:00:00Z', 'month')).toBe('2025-12-01T00:00:00Z')
    expect(prevSignalBucket('2026-10-05T00:00:00Z', 'week')).toBe('2026-09-28T00:00:00Z')
  })
})

describe('mixed intervals', () => {
  it('the acceptance case: monthly churn rate over a daily snapshot MRR', () => {
    const inputs = new Map([
      ['churned-mrr', input('month', 'increment', [live('2026-10-01', 190)])],
      ['mrr', input('day', 'snapshot', [live('2026-09-29', 6300), live('2026-09-30', 6337), live('2026-10-03', 6400)])],
    ])
    const pts = computeFormulaPoints('month', parseFormula('churned-mrr / start(mrr) * 100'), inputs)
    expect(pts).toHaveLength(1)
    expect(pts[0].bucket).toBe('2026-10-01T00:00:00Z')
    expect(pts[0].value).toBeCloseTo(2.998, 3)
  })

  it('a daily snapshot aggregates to its last value in the month', () => {
    const inputs = new Map([['cash', input('day', 'snapshot', [live('2026-09-10', 5), live('2026-09-30', 7), live('2026-10-02', 9)])]])
    expect(computeFormulaPoints('month', parseFormula('cash'), inputs)).toEqual([
      { bucket: '2026-09-01T00:00:00Z', value: 7 },
      { bucket: '2026-10-01T00:00:00Z', value: 9 },
    ])
  })

  it('a weekly increment sums into the month its weeks start in', () => {
    // ISO weeks: 2026-09-28 (Mon) starts in September and counts wholly there.
    const inputs = new Map([
      ['signups', input('week', 'increment', [live('2026-09-21', 3), live('2026-09-28', 4), live('2026-10-05', 6)])],
    ])
    const pts = computeFormulaPoints('month', parseFormula('signups'), inputs)
    expect(pts[0]).toEqual({ bucket: '2026-09-01T00:00:00Z', value: 7 })
    // October: 2026-10-05 plus the zero-filled weeks through NOW.
    expect(pts[1]).toEqual({ bucket: '2026-10-01T00:00:00Z', value: 6 })
  })
})

describe('gaps, never zeros', () => {
  it('division by zero gives no point', () => {
    const inputs = new Map([
      ['a', input('month', 'snapshot', [live('2026-09-01', 5), live('2026-10-01', 5)])],
      ['b', input('month', 'snapshot', [live('2026-09-01', 0), live('2026-10-01', 2)])],
    ])
    expect(computeFormulaPoints('month', parseFormula('a / b'), inputs)).toEqual([{ bucket: '2026-10-01T00:00:00Z', value: 2.5 }])
  })

  it('a missing input in a bucket, or an unknown input, gives no point', () => {
    const inputs = new Map([
      ['a', input('month', 'snapshot', [live('2026-09-01', 5), live('2026-10-01', 5)])],
      ['b', input('month', 'snapshot', [live('2026-10-01', 1)])],
    ])
    expect(computeFormulaPoints('month', parseFormula('a + b'), inputs)).toEqual([{ bucket: '2026-10-01T00:00:00Z', value: 6 }])
    expect(computeFormulaPoints('month', parseFormula('a + ghost'), inputs)).toEqual([])
  })
})

describe('manual overrides', () => {
  const computed = [
    { bucket: '2026-09-01T00:00:00Z', value: 1 },
    { bucket: '2026-10-01T00:00:00Z', value: 2 },
  ]

  it('a manual point wins its bucket and carries the computed value it hides', () => {
    const merged = mergeFormulaPoints('month', computed, [manual('2026-10-15', 9), live('2026-09-01', 99)])
    expect(merged).toEqual([
      { bucket: '2026-09-01T00:00:00Z', value: 1, source: 'live', note: null, computed: true },
      { bucket: '2026-10-01T00:00:00Z', value: 9, source: 'manual', note: 'hand', shadowed_computed: 2 },
    ])
  })

  it('without the manual point the computed value is back, and a manual point alone stands', () => {
    expect(mergeFormulaPoints('month', computed, []).map((p) => p.value)).toEqual([1, 2])
    expect(mergeFormulaPoints('month', [], [manual('2026-11-01', 4)])).toEqual([
      { bucket: '2026-11-01T00:00:00Z', value: 4, source: 'manual', note: 'hand' },
    ])
  })
})

describe('resolving histories', () => {
  function source(
    defs: (HistoryDefinition & { points?: StorePoint[] })[],
  ): SignalHistorySource {
    const byId = new Map(defs.map((d) => [d.id, d]))
    return {
      definition: (id) => byId.get(id),
      stored: (id) => ({ points: byId.get(id)?.points ?? [] }),
    }
  }

  it('resolves a formula that reads another formula', () => {
    const src = source([
      { id: 'a', interval: 'month', accumulation: 'snapshot', points: [live('2026-10-01', 10)] },
      { id: 'double', interval: 'month', accumulation: 'snapshot', formula: 'a * 2' },
      { id: 'quad', interval: 'month', accumulation: 'snapshot', formula: 'double * 2', points: [manual('2026-11-01', 1)] },
    ])
    const quad = resolveSignalHistory('quad', src, new Map(), { now: NOW })
    expect(quad.map((p) => [p.bucket.slice(0, 10), p.value, p.source])).toEqual([
      ['2026-10-01', 40, 'live'],
      ['2026-11-01', 1, 'manual'],
    ])
  })

  it('a cycle resolves to nothing instead of recursing', () => {
    const src = source([
      { id: 'x', interval: 'month', accumulation: 'snapshot', formula: 'y + 1' },
      { id: 'y', interval: 'month', accumulation: 'snapshot', formula: 'x + 1' },
    ])
    expect(resolveSignalHistory('x', src)).toEqual([])
  })

  it('an ordinary signal resolves through the usual merge', () => {
    const src = source([{ id: 'a', interval: 'day', accumulation: 'snapshot', points: [live('2026-10-01', 3), manual('2026-10-01', 4)] }])
    expect(resolveSignalHistory('a', src)[0]).toMatchObject({ value: 3, source: 'live', shadowed_manual: { value: 4 } })
  })
})
