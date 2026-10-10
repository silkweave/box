import { describe, expect, it } from 'vitest'
import { mergeSignalPoints, type StorePoint } from './points.js'
import {
  assertDay,
  dailySeries,
  daysBetween,
  isObservationStale,
  levelEntering,
  totalBetween,
  valueAsOf,
  windowAlignment,
} from './series.js'
import type { SignalAccumulation, SignalInterval } from './types.js'

const NOW = new Date('2026-10-06T12:00:00Z')

const live = (bucket: string, value: number): StorePoint => ({ bucket, value, source: 'live', note: null })
const manual = (bucket: string, value: number): StorePoint => ({ bucket, value, source: 'manual', note: 'hand' })

const backfill = (bucket: string, value: number): StorePoint => ({ bucket, value, source: 'backfill', note: null })

function merged(interval: SignalInterval, accumulation: SignalAccumulation, points: StorePoint[]) {
  return mergeSignalPoints({ interval, accumulation }, points, { now: NOW })
}

describe('days', () => {
  it('lists an inclusive range across a month end', () => {
    expect(daysBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
    expect(daysBetween('2026-10-02', '2026-10-01')).toEqual([])
  })

  it('refuses dates that are not real days', () => {
    expect(() => assertDay('2026-02-30')).toThrow(/YYYY-MM-DD/)
    expect(() => assertDay('2026-10-01T00:00:00Z')).toThrow(/YYYY-MM-DD/)
    expect(assertDay('2028-02-29')).toBe('2028-02-29')
  })
})

describe('valueAsOf (snapshot)', () => {
  const mrr = merged('day', 'snapshot', [
    live('2026-09-30T00:00:00Z', 8000),
    live('2026-10-02T00:00:00Z', 8300),
    live('2026-10-05T00:00:00Z', 8600),
  ])

  it('reads the day itself, then carries forward over gaps', () => {
    expect(valueAsOf(mrr, '2026-10-02')).toEqual({ value: 8300, bucket: '2026-10-02T00:00:00Z' })
    expect(valueAsOf(mrr, '2026-10-04')).toEqual({ value: 8300, bucket: '2026-10-02T00:00:00Z' })
  })

  it('knows nothing before the history starts', () => {
    expect(valueAsOf(mrr, '2026-09-29')).toBeNull()
  })

  it('takes the last hourly bucket of the day', () => {
    const hourly = merged('hour', 'snapshot', [
      live('2026-10-01T09:00:00Z', 1),
      live('2026-10-01T23:00:00Z', 2),
      live('2026-10-02T00:00:00Z', 3),
    ])
    expect(valueAsOf(hourly, '2026-10-01')?.value).toBe(2)
  })

  it('picks live over backfill over manual per bucket', () => {
    const all = merged('day', 'snapshot', [
      manual('2026-10-01T00:00:00Z', 1),
      backfill('2026-10-01T00:00:00Z', 2),
      manual('2026-10-02T00:00:00Z', 5),
      backfill('2026-10-03T00:00:00Z', 6),
      live('2026-10-03T00:00:00Z', 7),
    ])
    expect(all.map((p) => [p.value, p.source])).toEqual([[2, 'backfill'], [5, 'manual'], [7, 'live']])
    expect(all[0]?.shadowed_manual).toEqual({ value: 1, note: 'hand' })
    expect(valueAsOf(all, '2026-10-03')?.value).toBe(7)
  })
})

describe('levelEntering (snapshot baseline)', () => {
  it('daily: the day before the window', () => {
    const mrr = merged('day', 'snapshot', [live('2026-09-30T00:00:00Z', 8000), live('2026-10-01T00:00:00Z', 8100)])
    expect(levelEntering(mrr, 'day', '2026-10-01')).toEqual({ value: 8000, bucket: '2026-09-30T00:00:00Z' })
  })

  it('monthly: the previous month, never the month the window opens in', () => {
    const cash = merged('month', 'snapshot', [live('2026-09-01T00:00:00Z', 50), live('2026-10-01T00:00:00Z', 70)])
    expect(levelEntering(cash, 'month', '2026-10-01')?.value).toBe(50)
    // Mid-month start: October is still open on the 15th, so September is the level entering.
    expect(levelEntering(cash, 'month', '2026-10-15')?.value).toBe(50)
  })

  it('weekly: the last complete ISO week', () => {
    // 2026-09-21 and 2026-09-28 are Mondays; a window opening Thursday 2026-10-01 sits in the
    // 09-28 week, so the 09-21 week is the last one complete.
    const w = merged('week', 'snapshot', [live('2026-09-21T00:00:00Z', 10), live('2026-09-28T00:00:00Z', 12)])
    expect(levelEntering(w, 'week', '2026-10-01')?.value).toBe(10)
    expect(levelEntering(w, 'week', '2026-10-05')?.value).toBe(12)
  })

  it('null when nothing completed before the window', () => {
    const late = merged('day', 'snapshot', [live('2026-10-03T00:00:00Z', 1)])
    expect(levelEntering(late, 'day', '2026-10-01')).toBeNull()
  })
})

describe('totalBetween (increment)', () => {
  it('sums buckets that start inside the inclusive window', () => {
    const signups = merged('day', 'increment', [
      live('2026-09-30T00:00:00Z', 9),
      live('2026-10-01T00:00:00Z', 3),
      live('2026-10-03T00:00:00Z', 4),
    ])
    expect(totalBetween(signups, '2026-10-01', '2026-10-03')).toBe(7)
    expect(totalBetween(signups, '2026-10-02', '2026-10-02')).toBe(0) // zero-filled quiet day
  })

  it('counts a straddling week by its start', () => {
    const w = merged('week', 'increment', [live('2026-09-28T00:00:00Z', 20), live('2026-10-05T00:00:00Z', 5)])
    expect(totalBetween(w, '2026-10-01', '2026-10-31')).toBe(5)
    expect(totalBetween(w, '2026-09-28', '2026-10-01')).toBe(20)
  })

  it('null with no history in the window', () => {
    expect(totalBetween(merged('day', 'increment', []), '2026-10-01', '2026-10-05')).toBeNull()
  })
})

describe('dailySeries', () => {
  it('snapshot: carries levels into the window and stops at today', () => {
    const mrr = merged('day', 'snapshot', [live('2026-09-30T00:00:00Z', 8000), live('2026-10-03T00:00:00Z', 8400)])
    const s = dailySeries('snapshot', mrr, { from: '2026-10-01', to: '2026-12-31' }, NOW)
    expect(s.map((d) => d.day)).toEqual(daysBetween('2026-10-01', '2026-10-06'))
    expect(s.map((d) => d.value)).toEqual([8000, 8000, 8400, 8400, 8400, 8400])
    expect(s[0].bucket).toBe('2026-09-30T00:00:00Z')
  })

  it('increment: running total from the window start, ignoring earlier buckets', () => {
    const signups = merged('day', 'increment', [
      live('2026-09-30T00:00:00Z', 50),
      live('2026-10-01T00:00:00Z', 2),
      live('2026-10-03T00:00:00Z', 5),
    ])
    const s = dailySeries('increment', signups, { from: '2026-10-01', to: '2026-10-04' }, NOW)
    expect(s.map((d) => d.value)).toEqual([2, 2, 7, 7])
  })

  it('increment: null until the history begins', () => {
    const s = dailySeries('increment', merged('day', 'increment', [live('2026-10-03T00:00:00Z', 1)]), { from: '2026-10-01', to: '2026-10-04' }, NOW)
    expect(s.map((d) => d.value)).toEqual([null, null, 1, 1])
  })

  it('nothing for a window entirely in the future', () => {
    expect(dailySeries('snapshot', [], { from: '2026-11-01', to: '2026-11-30' }, NOW)).toEqual([])
  })
})

describe('windowAlignment', () => {
  it('daily signals never straddle', () => {
    expect(windowAlignment('day', '2026-10-01', '2026-12-31')).toEqual({ starts_mid_bucket: false, ends_mid_bucket: false })
  })

  it('a quarter on a monthly signal is aligned', () => {
    expect(windowAlignment('month', '2026-10-01', '2026-12-31')).toEqual({ starts_mid_bucket: false, ends_mid_bucket: false })
  })

  it('a quarter on a weekly signal straddles at both ends', () => {
    // 2026-10-01 is a Thursday; 2026-12-31 is a Thursday.
    expect(windowAlignment('week', '2026-10-01', '2026-12-31')).toEqual({ starts_mid_bucket: true, ends_mid_bucket: true })
    expect(windowAlignment('week', '2026-09-28', '2026-12-27')).toEqual({ starts_mid_bucket: false, ends_mid_bucket: false })
  })
})

describe('isObservationStale', () => {
  const daily = (bucket: string) => ({ value: 1, bucket })

  it('a daily value goes stale after two missing days', () => {
    expect(isObservationStale('snapshot', 'day', daily('2026-10-04T00:00:00Z'), NOW)).toBe(false)
    expect(isObservationStale('snapshot', 'day', daily('2026-10-03T00:00:00Z'), NOW)).toBe(true)
  })

  it('a monthly value goes stale two whole months after its month ended', () => {
    expect(isObservationStale('snapshot', 'month', daily('2026-08-01T00:00:00Z'), NOW)).toBe(false)
    expect(isObservationStale('snapshot', 'month', daily('2026-07-01T00:00:00Z'), NOW)).toBe(true)
  })

  it('increments and missing observations are never stale', () => {
    expect(isObservationStale('increment', 'day', daily('2026-01-01T00:00:00Z'), NOW)).toBe(false)
    expect(isObservationStale('snapshot', 'day', null, NOW)).toBe(false)
  })
})
