// The team's clock, pure (no config, no Node): the server (box-config.ts `teamDay`) and the browser
// (apps/web/src/lib/teamDay.ts) both read days through it, so the whole team shares one "today"
// wherever the host or a person sits. The zone is box.json `timeZone` (IANA, default UTC).

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    formatters.set(zone, f)
  }
  return f
}

/**
 * The calendar day of a moment (now by default) in `zone`, `YYYY-MM-DD`. A string is parsed as a
 * timestamp; one that does not parse is returned as its first ten characters, so a bare
 * `YYYY-MM-DD` passes through unchanged.
 */
export function dayInZone(zone: string, at: Date | string | number = new Date()): string {
  const d = at instanceof Date ? at : new Date(at)
  if (typeof at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(at)) return at
  return Number.isNaN(d.getTime()) ? String(at).slice(0, 10) : formatter(zone).format(d)
}

/** `day` (`YYYY-MM-DD`) shifted by `n` calendar days. Pure date arithmetic, no zone involved. */
export function addTeamDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>()

/** Milliseconds `zone` is ahead of UTC at instant `ms`. */
function zoneOffset(zone: string, ms: number): number {
  let f = offsetFormatters.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    offsetFormatters.set(zone, f)
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  return wall - Math.floor(ms / 1000) * 1000
}

/**
 * The UTC instant `day` (`YYYY-MM-DD`) begins in `zone`, as an ISO string. Turns a range of team
 * days into a timestamp range: `[dayStartInZone(zone, from), dayStartInZone(zone, addTeamDays(to, 1)))`.
 */
export function dayStartInZone(zone: string, day: string): string {
  const midnight = Date.parse(`${day}T00:00:00Z`)
  let start = midnight - zoneOffset(zone, midnight)
  // A DST change between UTC midnight and the zone's midnight moves the offset once more.
  start = midnight - zoneOffset(zone, start)
  return new Date(start).toISOString()
}
