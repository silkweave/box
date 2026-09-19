// Series the chart stories draw. Deterministic - a chart that re-rolls its data on every reload is
// a chart nobody can review.

export interface Reading {
  date: string
  value: number
}

/** 90 daily readings with a trend, a wobble and one step change, so a 7D window and a 90D window
 *  actually look different. */
export const DAILY: Reading[] = Array.from({ length: 90 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 5, 1) + i * 86_400_000).toISOString().slice(0, 10)
  const wobble = Math.sin(i / 3.1) * 14 + Math.sin(i / 11.7) * 26
  return { date, value: Math.round(420 + i * 7.4 + wobble + (i > 62 ? 180 : 0)) }
})

export const SPARSE: Reading[] = DAILY.slice(-12).filter((_, i) => i % 3 === 0)

/** Ten working days of a burndown: an ideal line that follows capacity (a half day is a half step)
 *  and an actual line that stops at "today", which is day seven. */
export const BURNDOWN = [
  { day: 'Mon 1', ideal: 108, remaining: 112 },
  { day: 'Tue 2', ideal: 96, remaining: 104 },
  { day: 'Wed 3', ideal: 84, remaining: 88 },
  { day: 'Thu 4', ideal: 72, remaining: 79 },
  { day: 'Fri 5', ideal: 66, remaining: 70 },
  { day: 'Mon 6', ideal: 54, remaining: 52 },
  { day: 'Tue 7', ideal: 42, remaining: 38 },
  { day: 'Wed 8', ideal: 30, remaining: null },
  { day: 'Thu 9', ideal: 18, remaining: null },
  { day: 'Fri 10', ideal: 0, remaining: null },
] satisfies Record<string, unknown>[]

/** Three series on one scale, for the palette-order and legend stories. */
export const CHANNELS = Array.from({ length: 24 }, (_, i) => ({
  week: `W${i + 1}`,
  blog: Math.round(120 + i * 9 + Math.sin(i / 2) * 30),
  newsletter: Math.round(90 + i * 4 + Math.cos(i / 3) * 22),
  social: Math.round(200 - i * 3 + Math.sin(i / 1.7) * 40),
}))
