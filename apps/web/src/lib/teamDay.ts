// The team's clock in the browser: "today" is the day in box.json `timeZone` (IANA, default UTC),
// so everyone sees the same day and week whatever their own zone. useAuth sets the zone from
// /api/auth/me before any signed-in view renders. Pure helpers in core team-day.ts.
import { setDefaultToday } from '@silkweave/box-ui'
import { addTeamDays, dayInZone } from '@silkweave/box-core/team-day'

let zone = 'UTC'

/** Called by useAuth with /api/auth/me `timeZone`. */
export function setTeamTimeZone(next: string | undefined): void {
  if (next) zone = next
}

export const teamTimeZone = (): string => zone

/** The team's calendar day of a moment (now by default), `YYYY-MM-DD`. */
export const teamDay = (at: Date | string | number = new Date()): string => dayInZone(zone, at)

/** Today on the team's clock, `YYYY-MM-DD`. */
export const teamToday = (): string => dayInZone(zone)

// Every DateInput's "today" is the team's day unless a field names its own clock.
setDefaultToday(teamToday)

export { addTeamDays }
