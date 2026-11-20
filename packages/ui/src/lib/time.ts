// Time formatting shared by the kit and the app. DOM-free: no React, no Intl state.

/** Parse a server timestamp, ISO or "YYYY-MM-DD HH:MM:SS[.fff]" (Safari needs the T). */
export function parseTimestamp(ts: string): Date {
  return new Date(ts.includes('T') || !ts.includes(' ') ? ts : ts.replace(' ', 'T'))
}

const UNITS: [number, string][] = [
  [86_400_000, 'd'],
  [3_600_000, 'h'],
  [60_000, 'm'],
  [1_000, 's'],
]

/**
 * "just now" / "2h ago" / "in 5m": a short distance from `now`. Past and future both read. An
 * unparseable input comes back unchanged.
 */
export function relativeTime(ts: string | number | Date, now: number = Date.now()): string {
  const then = toDate(ts).getTime()
  if (Number.isNaN(then)) return String(ts)
  const diff = then - now
  const abs = Math.abs(diff)
  if (abs < 30_000) return 'just now'
  for (const [size, label] of UNITS) {
    if (abs >= size) {
      const n = Math.round(abs / size)
      return diff < 0 ? `${n}${label} ago` : `in ${n}${label}`
    }
  }
  return 'just now'
}

/** "2026-11-17 14:05" in local time: the full form behind a relative time. */
export function fullTime(ts: string | number | Date): string {
  const d = toDate(ts)
  if (Number.isNaN(d.getTime())) return String(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function toDate(ts: string | number | Date): Date {
  return ts instanceof Date ? ts : typeof ts === 'number' ? new Date(ts) : parseTimestamp(ts)
}
