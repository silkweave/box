import type { Signal } from '../../types.ts'
import { computeDelta } from '../../lib/format.ts'

/**
 * The sparkline's window. A list row's sparkline is a glanceable "which way is this going lately", not an archive:
 * a daily signal a year or two old carries hundreds of buckets, and at row width that renders as a
 * solid block of ink with no readable trend at all. Thirty days is the same window the detail page defaults its
 * 30D toggle to, so the two agree.
 *
 * The headline number and the delta are NOT windowed - they are the last complete bucket and the
 * one before it, which is what the row claims they are either way.
 */
const SPARK_DAYS = 30
/** Floor for coarse grains: a weekly or monthly signal can have 1-4 buckets inside 30 days, and a
 *  sparkline of one point is a dot. Fall back to trailing buckets rather than render nothing. */
const SPARK_MIN_POINTS = 10

export function sparkWindow<T extends { date: string }>(points: T[]): T[] {
  if (points.length === 0) return points
  const cutoff = new Date(Date.now() - SPARK_DAYS * 86_400_000).toISOString().slice(0, 10)
  const recent = points.filter((p) => p.date.slice(0, 10) >= cutoff)
  return recent.length >= SPARK_MIN_POINTS ? recent : points.slice(-SPARK_MIN_POINTS)
}

/** The headline reading of a signal, as the Signals list shows it: the last COMPLETE bucket
 *  (an increment signal's newest bucket is still filling) and the change from the one before. */
export function signalReading(signal: Signal) {
  const isIncrement = signal.accumulation === 'increment'
  const complete = isIncrement && signal.points.length > 0 ? signal.points.slice(0, -1) : signal.points
  const latest: (typeof signal.points)[number] | null = complete[complete.length - 1] ?? null
  return { isIncrement, latest, delta: computeDelta(complete) }
}
