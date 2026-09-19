// Time windows for a time-series chart: the presets, and the two pure functions that decide which
// of them a given series can actually fill and which points fall inside one.
//
// This is geometry over dates, not vocabulary - "30D" names a length of time, not anything about
// what is being plotted - so it lives here and the chart can window itself from a controlled
// `range` id. What the app keeps is the choice of presets and where the current one is stored.

export interface TimeRange {
  id: string
  label: string
  /** Length of the window in days. `Infinity` means the whole series. */
  days: number
}

export const DEFAULT_TIME_RANGES: TimeRange[] = [
  { id: '7d', label: '7D', days: 7 },
  { id: '30d', label: '30D', days: 30 },
  { id: '90d', label: '90D', days: 90 },
  { id: '1y', label: '1Y', days: 365 },
  { id: 'all', label: 'All', days: Infinity },
]

const DAY = 86_400_000

/** The span the series covers, in days. */
export function spanDays(points: readonly { date: string }[]): number {
  if (points.length < 2) return 0
  return (Date.parse(points[points.length - 1].date) - Date.parse(points[0].date)) / DAY
}

/**
 * Only the presets the data can fill. A "1Y" button over three weeks of readings draws the same
 * chart as "All" and tells the reader the series is longer than it is; the whole-series preset is
 * always kept.
 */
export function rangesFor<R extends TimeRange>(points: readonly { date: string }[], ranges: readonly R[]): R[] {
  const span = spanDays(points)
  return ranges.filter((r) => !Number.isFinite(r.days) || r.days < span)
}

/**
 * The points inside `range`, measured back from the LAST reading rather than from now - a series
 * that stopped updating should still draw its last 30 days rather than an empty window. Never
 * returns fewer than two points where two exist: a one-point line is a dot.
 */
export function windowPoints<P extends { date: string }>(points: readonly P[], range: TimeRange | null): P[] {
  if (!range || !Number.isFinite(range.days) || points.length === 0) return [...points]
  const cutoff = Date.parse(points[points.length - 1].date) - range.days * DAY
  const inWindow = points.filter((p) => Date.parse(p.date) >= cutoff)
  return inWindow.length >= 2 ? inWindow : points.slice(-2)
}
