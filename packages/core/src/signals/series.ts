// Day-grain reads over a signal's merged history - the measurement layer goals are built on.
// Everything here is pure and takes the FULL ascending merged history (mergeSignalPoints /
// readSignalPoints un-windowed), never the served chart array, for the same reason aggregate.ts
// gives: a trimmed history answers plausibly and wrongly.
//
// Conventions, each stated once:
//
//   • A day is a UTC calendar date, 'YYYY-MM-DD', covering [day 00:00Z, next day 00:00Z). Buckets
//     are naive-UTC interval starts (floorSignalBucket), so both sides speak one clock.
//   • A bucket belongs to the window containing its START, with no proration - the rule
//     aggregate.ts already uses. A weekly or monthly bucket that straddles a window edge counts
//     wholly or not at all; windowAlignment() reports when that happens so a caller can say so.
//   • As-of (`snapshot`): the value of the latest bucket that STARTED on or before the end of the
//     day, carried forward over gaps and never interpolated. The bucket is returned with it, so a
//     carried value always travels with the date it was observed for.
//   • Level entering a window (`snapshot` baseline): the latest bucket that ENDED on or before the
//     window's first day. For a daily signal starting 2026-10-01 that is 2026-09-30's value; for a
//     monthly one it is September's. Reading the bucket that CONTAINS the start day instead would
//     hand a monthly signal its end-of-October value as the October 1 baseline.
//   • Running total (`increment`): the sum of buckets that started inside [from, day]. Increment
//     reads zero-fill from the first bucket through now, so a quiet stretch inside a live history
//     sums to 0, while a window with no history at all answers null.
//   • Staleness is a `snapshot` question only. A missing increment bucket is a zero by convention
//     (the merge fills it), so "no new occurrences" is never confused with "no new data".

import { floorSignalBucket, nextSignalBucket, type MergedSignalPoint } from './points.js'
import type { SignalAccumulation, SignalInterval } from './types.js'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

/** Refuse anything that is not a real 'YYYY-MM-DD' date. */
export function assertDay(day: string, what = 'date'): string {
  if (!DAY_RE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) {
    throw new Error(`${what} must be a YYYY-MM-DD date, got "${day}"`)
  }
  return day
}

/** The ISO-Z start of a day. */
export const dayStartIso = (day: string): string => `${day}T00:00:00Z`

/** The day after `day`. */
export function nextDay(day: string): string {
  return new Date(Date.parse(dayStartIso(day)) + DAY_MS).toISOString().slice(0, 10)
}

/** The UTC day of a timestamp (bucket or Date). */
export const dayOf = (at: string | Date): string => (typeof at === 'string' ? at : at.toISOString()).slice(0, 10)

/** Every day in [from, to], inclusive. Empty when `to` is before `from`. */
export function daysBetween(from: string, to: string): string[] {
  assertDay(from, 'from')
  assertDay(to, 'to')
  const out: string[] = []
  for (let d = from; d <= to; d = nextDay(d)) out.push(d)
  return out
}

/** The ISO-Z instant a bucket ends (the next bucket's start). */
export const bucketEnd = (bucket: string, interval: SignalInterval): string => nextSignalBucket(bucket, interval)

/** One observation and the bucket it was recorded for. */
export interface ObservedValue {
  value: number
  /** ISO-Z start of the bucket the value belongs to. */
  bucket: string
}

/**
 * A `snapshot` signal's level on `day`: the latest bucket starting before the day ends, carried
 * forward. Null when the history starts after the day.
 */
export function valueAsOf(merged: MergedSignalPoint[], day: string): ObservedValue | null {
  const end = dayStartIso(nextDay(assertDay(day)))
  let hit: MergedSignalPoint | null = null
  for (const p of merged) {
    if (p.bucket >= end) break
    hit = p
  }
  return hit ? { value: hit.value, bucket: hit.bucket } : null
}

/**
 * A `snapshot` signal's level as a window opens on `day`: the latest bucket that ended on or
 * before the day began (see the header). Null when nothing completed before the window.
 */
export function levelEntering(merged: MergedSignalPoint[], interval: SignalInterval, day: string): ObservedValue | null {
  const start = dayStartIso(assertDay(day))
  let hit: MergedSignalPoint | null = null
  for (const p of merged) {
    if (p.bucket >= start) break
    if (bucketEnd(p.bucket, interval) <= start) hit = p
  }
  return hit ? { value: hit.value, bucket: hit.bucket } : null
}

/**
 * The sum of buckets that started inside [from, to] (inclusive days). Null when no bucket at all
 * started in the window.
 */
export function totalBetween(merged: MergedSignalPoint[], from: string, to: string): number | null {
  const lo = dayStartIso(assertDay(from, 'from'))
  const hi = dayStartIso(nextDay(assertDay(to, 'to')))
  let sum = 0
  let any = false
  for (const p of merged) {
    if (p.bucket < lo) continue
    if (p.bucket >= hi) break
    sum += p.value
    any = true
  }
  return any ? sum : null
}

/** One day of a signal's series. `value` null = nothing known yet on that day. */
export interface SeriesDay {
  day: string
  value: number | null
  /** The bucket the value was observed for (snapshot) or the last bucket counted (increment). */
  bucket: string | null
}

/**
 * The signal day by day across [from, to]: as-of levels for `snapshot`, the running total since
 * `from` for `increment`. Days after `now` are not produced - a series never claims the future.
 */
export function dailySeries(
  accumulation: SignalAccumulation,
  merged: MergedSignalPoint[],
  window: { from: string; to: string },
  now: Date = new Date(),
): SeriesDay[] {
  const last = window.to < dayOf(now) ? window.to : dayOf(now)
  const days = daysBetween(window.from, last)
  const out: SeriesDay[] = []
  const lo = dayStartIso(window.from)
  let i = 0
  let carried: MergedSignalPoint | null = null
  let sum = 0
  let counted: MergedSignalPoint | null = null
  for (const day of days) {
    const end = dayStartIso(nextDay(day))
    while (i < merged.length && merged[i].bucket < end) {
      const p = merged[i++]
      carried = p
      if (p.bucket >= lo) {
        sum += p.value
        counted = p
      }
    }
    if (accumulation === 'increment') {
      out.push(counted ? { day, value: sum, bucket: counted.bucket } : { day, value: null, bucket: null })
    } else {
      out.push(carried ? { day, value: carried.value, bucket: carried.bucket } : { day, value: null, bucket: null })
    }
  }
  return out
}

/** Whether a window's edges cut through a bucket of the given interval. */
export interface WindowAlignment {
  /** The window starts after its first bucket began: that bucket is not counted. */
  starts_mid_bucket: boolean
  /** The window ends before its last bucket ends: that bucket is counted in full. */
  ends_mid_bucket: boolean
}

/** Report straddled edges, so a goal over a weekly or monthly signal can say how it counts. */
export function windowAlignment(interval: SignalInterval, from: string, to: string): WindowAlignment {
  const start = dayStartIso(assertDay(from, 'from'))
  const endExclusive = dayStartIso(nextDay(assertDay(to, 'to')))
  const lastBucket = floorSignalBucket(dayStartIso(to), interval)
  return {
    starts_mid_bucket: floorSignalBucket(start, interval) !== start,
    ends_mid_bucket: interval !== 'hour' && bucketEnd(lastBucket, interval) !== endExclusive,
  }
}

/**
 * A `snapshot` observation is stale once two whole intervals have passed after its bucket ended
 * with nothing newer: a daily value for 2026-10-03 (ended 10-04) is stale from 2026-10-06, a
 * monthly value for August (ended 09-01) from 2026-11-01. Increment signals are
 * never stale (see the header).
 */
export function isObservationStale(
  accumulation: SignalAccumulation,
  interval: SignalInterval,
  observed: ObservedValue | null,
  now: Date = new Date(),
): boolean {
  if (accumulation === 'increment' || !observed) return false
  const staleFrom = bucketEnd(bucketEnd(bucketEnd(observed.bucket, interval), interval), interval)
  return now.getTime() >= Date.parse(staleFrom)
}
