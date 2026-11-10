// The trackers registry: named calculations a feature registers in code (no table), each with
// parameters. A signal binds one by `tracker_key` with no `data_source_id`; its `tracker_params`
// hold the parameter values, and the tracker computes its live points (signals/tracker-derive.ts).
//
// The dependent registers into the dependency, as with providers and signal hooks: a feature's
// server module calls `registerTracker` at boot and keeps the unregister. A Box without that
// feature simply lists fewer trackers; a signal bound to a tracker that is no longer registered
// keeps its binding and its points, and the derive warns about it.
//
// Keys are `<feature>.<name>` (`crm.deals_reached_stage`). Parameter values are strings: an `enum` value
// is one of its options, a `date` is YYYY-MM-DD, a `user` is a users.id, `text` is free.
//
// A tracker declares what it reads in `watches`: change-bus scopes (`table:<name>`, changes.ts).
// Core recomputes the signals bound to it when one of them changes (tracker-derive.ts
// `watchTrackerSources`), so the owning feature never calls a refresh after its own writes.
//
// A level tracker (a running total or a ratio, `accumulation: 'snapshot'`) may declare a `since`
// param of kind `date`: the value at day d is then computed from `since` to d. A goal that creates
// its own tracker-bound signal sets `since` to the goal's start.

import type { SignalAccumulation, SignalDirection, SignalInterval } from './types.js'

export type TrackerParamKind = 'enum' | 'text' | 'date' | 'user'
export const TRACKER_PARAM_KINDS: TrackerParamKind[] = ['enum', 'text', 'date', 'user']

/** The parameter every level tracker may take; see the header. */
export const TRACKER_SINCE_PARAM = 'since'

export interface TrackerOption {
  value: string
  label: string
}

export interface TrackerParam {
  key: string
  label: string
  kind: TrackerParamKind
  /** `enum` only. A thunk when the list is tenant data (initiative kinds, stages), read on use. */
  options?: TrackerOption[] | (() => TrackerOption[] | Promise<TrackerOption[]>)
  required?: boolean
  description?: string
}

export interface TrackerPoint {
  /** The bucket's day (YYYY-MM-DD) or an ISO timestamp; floored to the signal's interval on write. */
  at: string
  value: number
}

export interface TrackerComputeInput {
  /** The signal's validated parameter values. */
  params: Record<string, string>
  /** First day to compute from (YYYY-MM-DD), or null for the tracker's whole history. */
  from: string | null
  /** Last day to compute (YYYY-MM-DD), normally the team's today. */
  to: string
}

export interface Tracker {
  /** `<feature>.<name>`. */
  key: string
  label: string
  unit: string | null
  interval: SignalInterval
  accumulation: SignalAccumulation
  direction: SignalDirection
  /** The dashboard section a signal bound to it defaults to. */
  group: string
  description: string
  params: TrackerParam[]
  /** The change scopes it reads (`table:crm_deal_stage_changes`); a change to one recomputes its signals. */
  watches: string[]
  compute: (input: TrackerComputeInput) => Promise<TrackerPoint[]>
}

const KEY = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9_]*$/
const SCOPE = /^(table|docs|config):[A-Za-z0-9_./-]+$/
/** What a derive writes: watching it would recompute on its own output. */
const DERIVE_OUTPUT = new Set(['table:signals', 'table:signal_points'])
const TRACKERS = new Map<string, Tracker>()

/** Register a tracker. Returns the unregister function. Keys are unique. */
export function registerTracker(tracker: Tracker): () => void {
  if (!KEY.test(tracker.key)) throw new Error(`tracker key "${tracker.key}" must be <feature>.<name>`)
  if (TRACKERS.has(tracker.key)) throw new Error(`tracker "${tracker.key}" registered twice`)
  if (!Array.isArray(tracker.watches) || tracker.watches.length === 0) {
    throw new Error(`tracker "${tracker.key}" must declare what it watches (table:<name>, ...)`)
  }
  for (const scope of tracker.watches) {
    if (!SCOPE.test(scope)) throw new Error(`tracker "${tracker.key}": "${scope}" is not a change scope (table:<name>, docs:<section>, config:<file>)`)
    if (DERIVE_OUTPUT.has(scope)) throw new Error(`tracker "${tracker.key}" cannot watch ${scope}: the derive writes it`)
  }
  const keys = new Set<string>()
  for (const p of tracker.params) {
    if (keys.has(p.key)) throw new Error(`tracker "${tracker.key}" declares param "${p.key}" twice`)
    keys.add(p.key)
    if (p.kind === 'enum' && !p.options) throw new Error(`tracker "${tracker.key}": enum param "${p.key}" needs options`)
  }
  TRACKERS.set(tracker.key, tracker)
  return () => {
    if (TRACKERS.get(tracker.key) === tracker) TRACKERS.delete(tracker.key)
  }
}

/** Every registered tracker, by key. */
export function listTrackers(): Tracker[] {
  return [...TRACKERS.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** One tracker, or null when the key names nothing registered (a binding can outlive its tracker). */
export function getTracker(key: string): Tracker | null {
  return TRACKERS.get(key) ?? null
}

/** One tracker, or a refusal listing what IS registered. */
export function requireTracker(key: string): Tracker {
  const m = TRACKERS.get(key)
  if (!m) {
    throw new Error(`unknown tracker "${key}" - registered trackers: ${[...TRACKERS.keys()].sort().join(', ') || '(none)'}`)
  }
  return m
}

/** A param's options, resolved (thunks called). Empty for non-enum params. */
export async function trackerOptions(param: TrackerParam): Promise<TrackerOption[]> {
  if (!param.options) return []
  return typeof param.options === 'function' ? await param.options() : param.options
}

/** Does this tracker take a `since` date? */
export function trackerTakesSince(tracker: Tracker): boolean {
  return tracker.params.some((p) => p.key === TRACKER_SINCE_PARAM && p.kind === 'date')
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validate parameter values against a tracker: unknown keys refused, required ones present, enum
 * values among the options, dates YYYY-MM-DD, users known. Empty strings are dropped (an omitted
 * optional param). Returns the cleaned object, keys sorted.
 */
export async function validateTrackerParams(
  tracker: Tracker,
  raw: Record<string, unknown>,
  assertUser: (id: string) => Promise<void>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw ?? {})) {
    const param = tracker.params.find((p) => p.key === key)
    if (!param) {
      throw new Error(`tracker ${tracker.key} takes no param "${key}" - valid: ${tracker.params.map((p) => p.key).join(', ') || '(none)'}`)
    }
    if (value === null || value === undefined) continue
    if (typeof value !== 'string') throw new Error(`tracker ${tracker.key}: param "${key}" must be a string`)
    const v = value.trim()
    if (v === '') continue
    if (param.kind === 'enum') {
      const options = await trackerOptions(param)
      if (!options.some((o) => o.value === v)) {
        throw new Error(`tracker ${tracker.key}: param "${key}" must be one of ${options.map((o) => o.value).join(', ')}, got "${v}"`)
      }
    } else if (param.kind === 'date') {
      if (!DAY.test(v)) throw new Error(`tracker ${tracker.key}: param "${key}" must be YYYY-MM-DD, got "${v}"`)
    } else if (param.kind === 'user') {
      await assertUser(v)
    }
    out[key] = v
  }
  for (const p of tracker.params) {
    if (p.required && out[p.key] === undefined) throw new Error(`tracker ${tracker.key}: param "${p.key}" is required`)
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}
