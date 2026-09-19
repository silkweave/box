export function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

export interface Delta {
  abs: number
  pct: number | null
  dir: 'up' | 'down' | 'flat'
}

/** Delta between the last and previous point of a signal, or null if <2 points. */
export function computeDelta(points: { value: number }[]): Delta | null {
  if (points.length < 2) return null
  const last = points[points.length - 1].value
  const prev = points[points.length - 2].value
  const abs = last - prev
  return {
    abs,
    pct: prev === 0 ? null : (abs / prev) * 100,
    dir: abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat',
  }
}

export function formatDelta(d: Delta): string {
  const sign = d.abs > 0 ? '+' : ''
  const pct = d.pct == null ? '' : ` (${sign}${d.pct.toFixed(1)}%)`
  return `${sign}${formatNumber(d.abs)}${pct}`
}

// DATES ARE ALWAYS `YYYY-MM-DD`. One rule, no exceptions, inputs and rendered text alike - it is
// the format the warehouse stores, the API speaks and every id in this repo uses, it sorts as a
// string, and it is unambiguous to a reader in any locale ("Aug 11" vs "11/8" vs "8/11" is not).
// There is deliberately no month-name or locale formatter left in this file to reach for; the field
// side of the same rule is components/ui/DateInput.tsx.

/** A calendar date for display: `2026-06-22`. Accepts a bare date or a full timestamp. */
export function formatDate(value: string): string {
  return value.slice(0, 10)
}

/** A point's bucket for tables/footers/axes: date-only stays as-is; a timestamp reads
 *  "2026-06-22 14:00" (UTC, per the warehouse-wide naive-==-UTC convention). */
export function formatBucket(bucket: string): string {
  return bucket.includes('T') ? `${bucket.slice(0, 10)} ${bucket.slice(11, 16)}` : bucket
}

/**
 * A timestamp in the READER's timezone: "2026-06-22 14:00". For the handful of fields that are wall
 * clock to a person (when a piece was published, when it is scheduled to go out) rather than a
 * warehouse bucket - those keep formatBucket and stay UTC, which is what they mean.
 */
export function formatDateTime(ts: string): string {
  const d = parseTimestamp(ts)
  if (Number.isNaN(d.getTime())) return ts
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Parse a server timestamp - DuckDB CASTs come as "YYYY-MM-DD HH:MM:SS[.fff]" (Safari needs the T). */
export function parseTimestamp(ts: string): Date {
  return new Date(ts.includes('T') || !ts.includes(' ') ? ts : ts.replace(' ', 'T'))
}

/** "740ms" / "4s" / "1m 12s" / "1h 03m" - for automation run durations. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** "just now" / "2h ago" / "in 5m" - for run start times and next cron fires. */
export function relativeTime(ts: string): string {
  const then = parseTimestamp(ts).getTime()
  if (Number.isNaN(then)) return ts
  const diff = then - Date.now()
  const abs = Math.abs(diff)
  if (abs < 30_000) return 'just now'
  const units: [number, string][] = [
    [86_400_000, 'd'],
    [3_600_000, 'h'],
    [60_000, 'm'],
    [1_000, 's'],
  ]
  for (const [size, label] of units) {
    if (abs >= size) {
      const n = Math.round(abs / size)
      return diff < 0 ? `${n}${label} ago` : `in ${n}${label}`
    }
  }
  return 'just now'
}
