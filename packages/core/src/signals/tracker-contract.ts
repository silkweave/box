// The contract a Box tracker meets, as a check a feature's test runs (`$add-tracker`, docs/SIGNALS.md
// "Box trackers"): the declaration is complete and registers, its feature prefix names an installed
// feature, every param's options resolve, and `compute` runs once on a database and returns finite
// numbers on real days. Returns the problems found, so the test is `expect(await
// trackerContractProblems(TRACKER)).toEqual([])` and a failure names what to fix.
//
// Run it in a test with a throwaway instance (`setInstanceDir`), after the feature's tables exist.
// A tracker that is already registered (the feature's module did it) is checked as it stands.

import { teamDay } from '../box-config.js'
import { trackerArea, ADMIN_AREA } from '../auth/owning-area.js'
import { getTracker, registerTracker, trackerOptions, type Tracker } from './trackers.js'

const DAY = /^\d{4}-\d{2}-\d{2}/

export interface TrackerContractOptions {
  /** Parameter values for the one compute run. Default: each required param takes its first option (an `enum`), today (a `date`) or `x` (`text`). */
  params?: Record<string, string>
}

/** Problems with a tracker's declaration and one compute run; empty when it meets the contract. */
export async function trackerContractProblems(tracker: Tracker, options: TrackerContractOptions = {}): Promise<string[]> {
  const problems: string[] = []
  const say = (m: string): number => problems.push(`${tracker.key}: ${m}`)

  if (trackerArea(tracker.key) === ADMIN_AREA) say(`the key prefix "${tracker.key.split('.')[0]}" names no installed feature, so the tracker would be admin-only`)
  for (const field of ['label', 'description', 'group'] as const) {
    if (typeof tracker[field] !== 'string' || tracker[field].trim() === '') say(`${field} is empty`)
  }
  if (tracker.unit !== null && typeof tracker.unit !== 'string') say('unit must be a string or null')

  // Registering runs the registry's own checks: key shape, a non-empty valid `watches`, params.
  let off: (() => void) | null = null
  if (getTracker(tracker.key) !== tracker) {
    try {
      off = registerTracker(tracker)
    } catch (err) {
      say(err instanceof Error ? err.message : String(err))
      return problems
    }
  }
  try {
    const params: Record<string, string> = { ...options.params }
    for (const p of tracker.params) {
      if (p.kind === 'enum') {
        const opts = await trackerOptions(p)
        if (opts.length === 0 && p.required && params[p.key] === undefined) say(`required param "${p.key}" has no options to run with; pass params`)
        if (p.required && params[p.key] === undefined && opts[0]) params[p.key] = opts[0].value
      } else if (p.required && params[p.key] === undefined) {
        params[p.key] = p.kind === 'date' ? teamDay() : 'x'
      }
    }
    try {
      const points = await tracker.compute({ params, from: null, to: teamDay() })
      if (!Array.isArray(points)) say('compute must return an array of { at, value }')
      else {
        for (const pt of points) {
          if (typeof pt?.at !== 'string' || !DAY.test(pt.at) || Number.isNaN(Date.parse(pt.at))) say(`point at "${String(pt?.at)}" is not a day (YYYY-MM-DD) or an ISO timestamp`)
          else if (typeof pt.value !== 'number' || !Number.isFinite(pt.value)) say(`point at ${pt.at} has a non-finite value`)
        }
      }
    } catch (err) {
      say(`compute failed with ${JSON.stringify(params)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  } finally {
    off?.()
  }
  return problems
}
