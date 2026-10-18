import { expect, test } from 'vitest'
import { addTeamDays, dayInZone, dayStartInZone } from './team-day.js'

test('a moment reads as the calendar day of the team zone', () => {
  // 2026-10-12 23:30 UTC is already Tuesday 06:30 in Jakarta and still Monday in Vienna.
  const at = new Date('2026-10-12T23:30:00Z')
  expect(dayInZone('UTC', at)).toBe('2026-10-12')
  expect(dayInZone('Asia/Jakarta', at)).toBe('2026-10-13')
  expect(dayInZone('Europe/Vienna', '2026-10-12T21:30:00Z')).toBe('2026-10-12')
  expect(dayInZone('America/Los_Angeles', at.getTime())).toBe('2026-10-12')
})

test('a bare day passes through and an unparseable value keeps its first ten characters', () => {
  expect(dayInZone('Asia/Jakarta', '2026-10-12')).toBe('2026-10-12')
  expect(dayInZone('UTC', 'not-a-date-at-all')).toBe('not-a-date')
})

test('addTeamDays shifts across month and year ends', () => {
  expect(addTeamDays('2026-12-31', 1)).toBe('2027-01-01')
  expect(addTeamDays('2026-03-01', -1)).toBe('2026-02-28')
})

test('dayStartInZone gives the UTC instant a team day begins', () => {
  expect(dayStartInZone('UTC', '2026-10-12')).toBe('2026-10-12T00:00:00.000Z')
  expect(dayStartInZone('Asia/Jakarta', '2026-10-12')).toBe('2026-10-11T17:00:00.000Z')
  expect(dayStartInZone('Europe/Vienna', '2026-07-01')).toBe('2026-06-30T22:00:00.000Z')
  // Vienna leaves summer time on 2026-10-25: that day still starts at UTC+2.
  expect(dayStartInZone('Europe/Vienna', '2026-10-25')).toBe('2026-10-24T22:00:00.000Z')
  expect(dayStartInZone('Europe/Vienna', '2026-10-26')).toBe('2026-10-25T23:00:00.000Z')
  expect(dayStartInZone('America/New_York', '2026-03-08')).toBe('2026-03-08T05:00:00.000Z')
})
