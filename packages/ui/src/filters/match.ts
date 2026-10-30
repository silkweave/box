// The filter kit's pure half: is a value active, does a row match it, repair a stored value, compare
// two, and say one in a few words for a chip. No React, no clock - "today" arrives in the context -
// so all of it is unit-tested and the same rules hold on every board.

import {
  DATE_WINDOWS,
  PERSON_ME,
  PERSON_NONE,
  type DateFilterValue,
  type DateWindow,
  type FilterContext,
  type FilterField,
  type FilterRowValue,
  type FilterSchema,
  type FilterType,
  type FilterValue,
  type Filters,
  type NumberFilterValue,
  type NumberOp,
} from './types.ts'

// ---- days ---------------------------------------------------------------------------------------

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** A well-formed, real calendar day (rejects 2026-02-31, which Date would roll over silently). */
export function isDay(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const probe = new Date(Date.UTC(y, m - 1, d))
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
}

/** `day` plus `n` days, on the calendar alone (UTC arithmetic, so no zone can shift it). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export const DATE_WINDOW_LABEL: Record<DateWindow, string> = {
  overdue: 'Overdue',
  today: 'Today',
  next_7: 'Next 7 days',
  next_30: 'Next 30 days',
  this_month: 'This month',
  later: 'Later',
  past_7: 'Past 7 days',
  past_30: 'Past 30 days',
}

/** The line under a window in the date editor: what it covers, in plain words. */
export const DATE_WINDOW_HINT: Record<DateWindow, string> = {
  overdue: 'Before today, still open',
  today: 'Today only',
  next_7: 'Today and the six days after',
  next_30: 'Today and the 29 days after',
  this_month: 'This calendar month',
  later: 'After the next 7 days',
  past_7: 'Today and the six days before',
  past_30: 'Today and the 29 days before',
}

/** Whether `day` falls in `window`, seen from `today`. `open` only matters to Overdue. */
export function inWindow(window: DateWindow, day: string, today: string, open = true): boolean {
  switch (window) {
    case 'overdue':
      return open && day < today
    case 'today':
      return day === today
    case 'next_7':
      return day >= today && day <= addDays(today, 6)
    case 'next_30':
      return day >= today && day <= addDays(today, 29)
    case 'this_month':
      return day.slice(0, 7) === today.slice(0, 7)
    case 'later':
      return day > addDays(today, 6)
    case 'past_7':
      return day <= today && day >= addDays(today, -6)
    case 'past_30':
      return day <= today && day >= addDays(today, -29)
  }
}

// ---- active -------------------------------------------------------------------------------------

const NUMBER_OPS: readonly string[] = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte']

/** Whether a value narrows anything. Absent, null, an empty list or blank text do not. */
export function isActive(type: FilterType, value: unknown): boolean {
  return normalizeFilter(type, value) !== null
}

/** How many fields of `schema` are narrowing right now. */
export function countActive(schema: FilterSchema, filters: Filters | object): number {
  const f = filters as Filters
  return Object.entries(schema).reduce((n, [key, type]) => n + (isActive(type, f[key]) ? 1 : 0), 0)
}

// ---- normalize ----------------------------------------------------------------------------------

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Repair one stored value for a field of `type`: the typed value, or null when it does not parse
 * (or narrows nothing). A value of an older shape reads as no filter rather than poisoning the board.
 * List values are NOT checked against the field's options - a retired option simply matches nothing.
 */
export function normalizeFilter(type: 'options' | 'person', raw: unknown): string[] | null
export function normalizeFilter(type: 'date', raw: unknown): DateFilterValue | null
export function normalizeFilter(type: 'number', raw: unknown): NumberFilterValue | null
export function normalizeFilter(type: 'text', raw: unknown): string | null
export function normalizeFilter(type: 'boolean', raw: unknown): boolean | null
export function normalizeFilter(type: FilterType, raw: unknown): FilterValue | null
export function normalizeFilter(type: FilterType, raw: unknown): FilterValue | null {
  if (raw == null) return null
  switch (type) {
    case 'options':
    case 'person':
      return isStrings(raw) && raw.length > 0 ? [...new Set(raw)] : null
    case 'text':
      return typeof raw === 'string' && raw.trim() ? raw : null
    case 'boolean':
      return typeof raw === 'boolean' ? raw : null
    case 'date': {
      if (typeof raw !== 'object' || Array.isArray(raw)) return null
      const v = raw as Record<string, unknown>
      if (v.none === true) return { none: true }
      if (typeof v.window === 'string') return (DATE_WINDOWS as readonly string[]).includes(v.window) ? { window: v.window as DateWindow } : null
      const from = isDay(v.from) ? v.from : undefined
      const to = isDay(v.to) ? v.to : undefined
      if (!from && !to) return null
      return { ...(from ? { from } : {}), ...(to ? { to } : {}) }
    }
    case 'number': {
      if (typeof raw !== 'object' || Array.isArray(raw)) return null
      const v = raw as Record<string, unknown>
      if (v.op === 'empty' || v.op === 'set') return { op: v.op }
      if (v.op === 'between') return isNum(v.value) && isNum(v.to) ? { op: 'between', value: Math.min(v.value, v.to), to: Math.max(v.value, v.to) } : null
      return typeof v.op === 'string' && NUMBER_OPS.includes(v.op) && isNum(v.value) ? { op: v.op as NumberOp, value: v.value } : null
    }
  }
}

/** Repair a whole stored filters record: only `schema`'s keys, only the active ones. */
export function normalizeAll(schema: FilterSchema, raw: unknown): Record<string, FilterValue> {
  const stored = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out: Record<string, FilterValue> = {}
  for (const [key, type] of Object.entries(schema)) {
    const v = normalizeFilter(type, stored[key])
    if (v !== null) out[key] = v
  }
  return out
}

// ---- same ---------------------------------------------------------------------------------------

const sameSet = (x: readonly string[], y: readonly string[]): boolean =>
  x.length === y.length && [...x].sort().join('\u0000') === [...y].sort().join('\u0000')

/** Two values of one field mean the same filter. Lists compare order-insensitively; two inactive
 *  values (absent, null, empty) are the same. */
export function sameFilter(type: FilterType, a: unknown, b: unknown): boolean {
  const x = normalizeFilter(type, a)
  const y = normalizeFilter(type, b)
  if (x === null || y === null) return x === y
  switch (type) {
    case 'options':
    case 'person':
      return sameSet(x as string[], y as string[])
    case 'text':
      return (x as string).trim().toLowerCase() === (y as string).trim().toLowerCase()
    case 'boolean':
      return x === y
    case 'date':
    case 'number': {
      const [p, q] = [x as Record<string, unknown>, y as Record<string, unknown>]
      const keys = new Set([...Object.keys(p), ...Object.keys(q)])
      return [...keys].every((k) => p[k] === q[k])
    }
  }
}

/** Every field of `schema` the same filter in `a` and `b`. */
export function sameAll(schema: FilterSchema, a: Filters | object, b: Filters | object): boolean {
  const [x, y] = [a as Filters, b as Filters]
  return Object.entries(schema).every(([key, type]) => sameFilter(type, x[key], y[key]))
}

// ---- match --------------------------------------------------------------------------------------

const asList = (v: FilterRowValue): readonly string[] =>
  v == null ? [] : typeof v === 'string' ? [v] : Array.isArray(v) ? (v as readonly string[]) : []

/**
 * Whether a row with `rowValue` passes `value` on a field of `type`. An inactive value passes
 * everything. Blanks: an `options` row with no value fails (a host that wants blanks kept decides
 * that before asking); `person` blanks match `PERSON_NONE`, `date` blanks match `{ none: true }`,
 * `number` blanks match `empty`, a `boolean` blank counts as off.
 */
export function matchFilter(type: FilterType, value: unknown, rowValue: FilterRowValue, ctx: FilterContext): boolean {
  const v = normalizeFilter(type, value)
  if (v === null) return true
  switch (type) {
    case 'options': {
      const have = asList(rowValue)
      return have.some((x) => (v as string[]).includes(x))
    }
    case 'person': {
      const have = asList(rowValue)
      const wanted = v as string[]
      if (have.length === 0) return wanted.includes(PERSON_NONE)
      return have.some((id) => wanted.includes(id) || (wanted.includes(PERSON_ME) && !!ctx.me && id === ctx.me))
    }
    case 'text': {
      const have = typeof rowValue === 'string' ? rowValue : asList(rowValue).join(' ')
      return have.toLowerCase().includes((v as string).trim().toLowerCase())
    }
    case 'boolean':
      return (rowValue === true) === v
    case 'number': {
      const n = typeof rowValue === 'number' && Number.isFinite(rowValue) ? rowValue : null
      const f = v as NumberFilterValue
      if (f.op === 'empty') return n === null
      if (f.op === 'set') return n !== null
      if (n === null) return false
      switch (f.op) {
        case 'eq':
          return n === f.value
        case 'ne':
          return n !== f.value
        case 'lt':
          return n < f.value
        case 'lte':
          return n <= f.value
        case 'gt':
          return n > f.value
        case 'gte':
          return n >= f.value
        case 'between':
          return n >= f.value && n <= f.to
      }
      return false
    }
    case 'date': {
      const cell = rowValue && typeof rowValue === 'object' && !Array.isArray(rowValue) ? (rowValue as { day: string | null; open?: boolean }) : null
      const day = cell ? cell.day : typeof rowValue === 'string' ? rowValue : null
      const open = cell ? cell.open !== false : true
      const f = v as DateFilterValue
      if ('none' in f) return !day
      if (!day) return false
      if ('window' in f) return inWindow(f.window, day, ctx.today, open)
      return (!f.from || day >= f.from) && (!f.to || day <= f.to)
    }
  }
}

/** Whether a row passes every field of `schema`. `rowValueOf(key)` reports the row's value on one field. */
export function matchAll(
  schema: FilterSchema,
  filters: Filters | object,
  rowValueOf: (key: string) => FilterRowValue,
  ctx: FilterContext,
  /** Fields the host matches itself (e.g. one whose "any" means every reason). */
  skip: readonly string[] = [],
): boolean {
  const f = filters as Filters
  for (const [key, type] of Object.entries(schema)) {
    if (skip.includes(key) || !isActive(type, f[key])) continue
    if (!matchFilter(type, f[key], rowValueOf(key), ctx)) return false
  }
  return true
}

/** Only the fields that still narrow something: what a module's own vocabulary repair (which may
 *  leave an empty list behind) hands back as its stored filters. */
export function pruneInactive<F extends object>(schema: FilterSchema, filters: F): F {
  const f = filters as Filters
  return Object.fromEntries(Object.entries(schema).filter(([key, type]) => isActive(type, f[key])).map(([key]) => [key, f[key]])) as F
}

// ---- summarize ----------------------------------------------------------------------------------

const NUMBER_OP_SIGN: Record<NumberOp, string> = { eq: '=', ne: '≠', lt: '<', lte: '≤', gt: '>', gte: '≥' }

/** "Anna, Ben" / "Anna, Ben +2": a list said in a chip's worth of space. */
function listText(labels: string[]): string {
  return labels.length <= 2 ? labels.join(', ') : `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`
}

/** A field's value in a few words, for a pinned chip: "Anna, Ben", "Next 7 days", "> 5 h", "Off".
 *  An inactive value reads "Any". */
export function summarize(field: FilterField, value: unknown): string {
  const v = normalizeFilter(field.type, value)
  if (v === null) return 'Any'
  const unit = field.type === 'number' && field.unit ? ` ${field.unit}` : ''
  const pre = field.type === 'number' && field.prefix ? field.prefix : ''
  switch (field.type) {
    case 'options':
      return listText((v as string[]).map((x) => field.options.find((o) => o.value === x)?.label ?? x))
    case 'person':
      return listText(
        (v as string[]).map((x) =>
          x === PERSON_ME
            ? field.meLabel || 'Me'
            : x === PERSON_NONE
              ? field.noneLabel || 'Nobody'
              : (field.options.find((o) => o.value === x)?.label ?? x),
        ),
      )
    case 'text':
      return `"${(v as string).trim()}"`
    case 'boolean':
      return v ? (field.onLabel ?? 'On') : (field.offLabel ?? 'Off')
    case 'date': {
      const f = v as DateFilterValue
      if ('none' in f) return field.noneLabel || 'No date'
      if ('window' in f) return DATE_WINDOW_LABEL[f.window]
      if (f.from && f.to) return f.from === f.to ? f.from : `${f.from} to ${f.to}`
      return f.from ? `From ${f.from}` : `Until ${f.to}`
    }
    case 'number': {
      const f = v as NumberFilterValue
      if (f.op === 'empty') return 'Empty'
      if (f.op === 'set') return 'Has a value'
      if (f.op === 'between') return `${pre}${f.value} to ${pre}${f.to}${unit}`
      return 'value' in f ? `${NUMBER_OP_SIGN[f.op]} ${pre}${f.value}${unit}` : 'Any'
    }
  }
}
