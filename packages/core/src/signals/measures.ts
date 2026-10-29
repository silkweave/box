// The measures registry: named calculations a feature registers in code (no table), each with
// parameters. A signal binds one by `measure_key` with no `data_source_id`; its `measure_params`
// hold the parameter values, and the measure computes its live points (signals/measure-derive.ts).
//
// The dependent registers into the dependency, as with providers and signal hooks: a feature's
// server module calls `registerMeasure` at boot and keeps the unregister. A Box without that
// feature simply lists fewer measures; a signal bound to a measure that is no longer registered
// keeps its binding and its points, and the derive warns about it.
//
// Keys are `<feature>.<name>` (`crm.deals_entered`). Parameter values are strings: an `enum` value
// is one of its options, a `date` is YYYY-MM-DD, a `user` is a users.id, `text` is free.
//
// A level measure (a running total or a ratio, `accumulation: 'snapshot'`) may declare a `since`
// param of kind `date`: the value at day d is then computed from `since` to d. A goal that creates
// its own measure-bound signal sets `since` to the goal's start.

import type { SignalAccumulation, SignalDirection, SignalInterval } from './types.js'

export type MeasureParamKind = 'enum' | 'text' | 'date' | 'user'
export const MEASURE_PARAM_KINDS: MeasureParamKind[] = ['enum', 'text', 'date', 'user']

/** The parameter every level measure may take; see the header. */
export const MEASURE_SINCE_PARAM = 'since'

export interface MeasureOption {
  value: string
  label: string
}

export interface MeasureParam {
  key: string
  label: string
  kind: MeasureParamKind
  /** `enum` only. A thunk when the list is tenant data (initiative kinds, stages), read on use. */
  options?: MeasureOption[] | (() => MeasureOption[] | Promise<MeasureOption[]>)
  required?: boolean
  description?: string
}

export interface MeasurePoint {
  /** The bucket's day (YYYY-MM-DD) or an ISO timestamp; floored to the signal's interval on write. */
  at: string
  value: number
}

export interface MeasureComputeInput {
  /** The signal's validated parameter values. */
  params: Record<string, string>
  /** First day to compute from (YYYY-MM-DD), or null for the measure's whole history. */
  from: string | null
  /** Last day to compute (YYYY-MM-DD), normally the team's today. */
  to: string
}

export interface Measure {
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
  params: MeasureParam[]
  compute: (input: MeasureComputeInput) => Promise<MeasurePoint[]>
}

const KEY = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9_]*$/
const MEASURES = new Map<string, Measure>()

/** Register a measure. Returns the unregister function. Keys are unique. */
export function registerMeasure(measure: Measure): () => void {
  if (!KEY.test(measure.key)) throw new Error(`measure key "${measure.key}" must be <feature>.<name>`)
  if (MEASURES.has(measure.key)) throw new Error(`measure "${measure.key}" registered twice`)
  const keys = new Set<string>()
  for (const p of measure.params) {
    if (keys.has(p.key)) throw new Error(`measure "${measure.key}" declares param "${p.key}" twice`)
    keys.add(p.key)
    if (p.kind === 'enum' && !p.options) throw new Error(`measure "${measure.key}": enum param "${p.key}" needs options`)
  }
  MEASURES.set(measure.key, measure)
  return () => {
    if (MEASURES.get(measure.key) === measure) MEASURES.delete(measure.key)
  }
}

/** Every registered measure, by key. */
export function listMeasures(): Measure[] {
  return [...MEASURES.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** One measure, or null when the key names nothing registered (a binding can outlive its measure). */
export function getMeasure(key: string): Measure | null {
  return MEASURES.get(key) ?? null
}

/** One measure, or a refusal listing what IS registered. */
export function requireMeasure(key: string): Measure {
  const m = MEASURES.get(key)
  if (!m) {
    throw new Error(`unknown measure "${key}" - registered measures: ${[...MEASURES.keys()].sort().join(', ') || '(none)'}`)
  }
  return m
}

/** A param's options, resolved (thunks called). Empty for non-enum params. */
export async function measureOptions(param: MeasureParam): Promise<MeasureOption[]> {
  if (!param.options) return []
  return typeof param.options === 'function' ? await param.options() : param.options
}

/** Does this measure take a `since` date? */
export function measureTakesSince(measure: Measure): boolean {
  return measure.params.some((p) => p.key === MEASURE_SINCE_PARAM && p.kind === 'date')
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Validate parameter values against a measure: unknown keys refused, required ones present, enum
 * values among the options, dates YYYY-MM-DD, users known. Empty strings are dropped (an omitted
 * optional param). Returns the cleaned object, keys sorted.
 */
export async function validateMeasureParams(
  measure: Measure,
  raw: Record<string, unknown>,
  assertUser: (id: string) => Promise<void>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw ?? {})) {
    const param = measure.params.find((p) => p.key === key)
    if (!param) {
      throw new Error(`measure ${measure.key} takes no param "${key}" - valid: ${measure.params.map((p) => p.key).join(', ') || '(none)'}`)
    }
    if (value === null || value === undefined) continue
    if (typeof value !== 'string') throw new Error(`measure ${measure.key}: param "${key}" must be a string`)
    const v = value.trim()
    if (v === '') continue
    if (param.kind === 'enum') {
      const options = await measureOptions(param)
      if (!options.some((o) => o.value === v)) {
        throw new Error(`measure ${measure.key}: param "${key}" must be one of ${options.map((o) => o.value).join(', ')}, got "${v}"`)
      }
    } else if (param.kind === 'date') {
      if (!DAY.test(v)) throw new Error(`measure ${measure.key}: param "${key}" must be YYYY-MM-DD, got "${v}"`)
    } else if (param.kind === 'user') {
      await assertUser(v)
    }
    out[key] = v
  }
  for (const p of measure.params) {
    if (p.required && out[p.key] === undefined) throw new Error(`measure ${measure.key}: param "${p.key}" is required`)
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}
