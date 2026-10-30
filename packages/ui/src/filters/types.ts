// The typed filter vocabulary: six field types, the value each one stores, and the field a host
// describes so the panel knows which editor to draw. Nothing here knows what a field MEANS - a host
// says "this is a date called Due" and keeps every meaning (what is open, who is me) to itself.
//
// A stored value is plain JSON on purpose: it lives in a preset on the server and in the live view
// in localStorage, so it has to survive a round trip through both and be repairable by `normalize`.
// Absent or null always means "no filter on this field".

import type { ReactNode } from 'react'

/** The six field types. Each has one stored value shape and one editor. */
export type FilterType = 'options' | 'person' | 'date' | 'number' | 'text' | 'boolean'

/** The relative windows a date field can offer. "Today" is the host's day (`FilterContext.today`). */
export type DateWindow = 'overdue' | 'today' | 'next_7' | 'next_30' | 'this_month' | 'later' | 'past_7' | 'past_30'

export const DATE_WINDOWS: readonly DateWindow[] = ['overdue', 'today', 'next_7', 'next_30', 'this_month', 'later', 'past_7', 'past_30']

/** The windows that look forward, for a deadline. */
export const FORWARD_WINDOWS: readonly DateWindow[] = ['overdue', 'today', 'next_7', 'next_30', 'this_month', 'later']

/** The windows that look back, for a date something happened on. */
export const PAST_WINDOWS: readonly DateWindow[] = ['today', 'past_7', 'past_30', 'this_month']

/** The person field's stand-in for whoever is looking: a shared preset of "mine" means each person's own. */
export const PERSON_ME = 'me'
/** The person field's value for "nobody". */
export const PERSON_NONE = 'none'

/** `options`: any of these values. */
export type OptionsFilterValue = readonly string[]
/** `person`: any of these user ids, plus `PERSON_ME` and `PERSON_NONE`. */
export type PersonFilterValue = readonly string[]
/** `date`: a relative window, an inclusive range with either end open, or "no date". Days are `YYYY-MM-DD`. */
export type DateFilterValue = { window: DateWindow } | { from?: string; to?: string } | { none: true }
export type NumberOp = 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'
/** `number`: a comparison, an inclusive range, or "has no value" / "has a value". */
export type NumberFilterValue = { op: NumberOp; value: number } | { op: 'between'; value: number; to: number } | { op: 'empty' | 'set' }
/** `text`: matches anywhere in the row's text, case-insensitive. */
export type TextFilterValue = string
/** `boolean`: rows where the flag is on (true) or off (false; a row with no value counts as off). */
export type BooleanFilterValue = boolean

export type FilterValue =
  | OptionsFilterValue
  | DateFilterValue
  | NumberFilterValue
  | TextFilterValue
  | BooleanFilterValue

/**
 * Field key -> value. A host narrows this with a TYPE ALIAS of its own (`type Filters = { status?:
 * Status[] | null; due?: DateFilterValue | null }`), which stays assignable here; an `interface` is
 * not, because interfaces carry no implicit index signature.
 */
export type Filters = Readonly<Record<string, FilterValue | null | undefined>>

/** Field key -> type: what a host declares once, statically, so stored views can be repaired and
 *  compared without building the fields (which depend on the rows on screen). */
export type FilterSchema = Readonly<Record<string, FilterType>>

/**
 * A row's value as the host reports it for one field:
 *   options - `string | string[] | null`; person - a user id or null; date - a day or null, or
 *   `{ day, open }` where `open: false` keeps the row out of Overdue (closed work is never late);
 *   number - a number or null; text - a string or null; boolean - a boolean or null.
 */
export type FilterRowValue = string | readonly string[] | number | boolean | { day: string | null; open?: boolean } | null

/** What matching needs from outside the row. */
export interface FilterContext {
  /** Today, `YYYY-MM-DD`, on the clock the host reads dates on. */
  today: string
  /** Who `PERSON_ME` is; without one it matches nobody. */
  me?: string | null
}

/** One value a field offers. */
export interface FilterOption {
  value: string
  label: string
}

interface FieldBase {
  /** Key into the host's filters record. */
  key: string
  title: string
  /** Shown under the editor - the one place a field gets to explain itself. */
  note?: ReactNode
}

export interface OptionsField extends FieldBase {
  type: 'options'
  options: FilterOption[]
}

export interface PersonField extends FieldBase {
  type: 'person'
  /** The people on offer (id and display name). */
  options: FilterOption[]
  /** The `PERSON_ME` entry's label (default "Me"), or false to leave it out. */
  meLabel?: string | false
  /** The `PERSON_NONE` entry's label (default "Nobody"), or false to leave it out. */
  noneLabel?: string | false
}

export interface DateField extends FieldBase {
  type: 'date'
  /** The windows on offer, in order (`FORWARD_WINDOWS` for a deadline, `PAST_WINDOWS` for a record). */
  windows: readonly DateWindow[]
  /** The "no date" entry's label (default "No date"), or false to leave it out. */
  noneLabel?: string | false
}

export interface NumberField extends FieldBase {
  type: 'number'
  /** A suffix for the value, e.g. "h" or "days". */
  unit?: string
  /** A prefix for the value, e.g. "$" for money ("> $0"). */
  prefix?: string
  step?: number
}

export interface TextField extends FieldBase {
  type: 'text'
  placeholder?: string
}

export interface BooleanField extends FieldBase {
  type: 'boolean'
  /** The two labels of the segmented control (default "On" and "Off"). */
  onLabel?: string
  offLabel?: string
}

/** One field of the filter panel, discriminated by `type`. */
export type FilterField = OptionsField | PersonField | DateField | NumberField | TextField | BooleanField

/** The schema a list of fields implies. */
export const schemaOf = (fields: readonly FilterField[]): FilterSchema => Object.fromEntries(fields.map((f) => [f.key, f.type]))
