// The geometry half of a data grid: what order the columns render in, how wide each one is, and where
// a person's own width tweaks live. Every list view draws the same shape - an identity column that
// flexes, a couple of always-on ones, the view's optional columns, and a trailing action cluster -
// and each had its own copy of `gridTemplate`/`gridMinWidth` computing it. Three copies was one too
// many the moment the widths stopped being constants.
//
// TWO THINGS ABOUT A COLUMN, STORED IN TWO DIFFERENT PLACES, on purpose:
//
//   • WHICH columns and in WHAT ORDER is view state - part of the preset, shared with the team. A
//     preset is a lens ("the Friday view"), and the order you read the numbers in is part of the lens.
//   • HOW WIDE each one is, is a USER setting - localStorage, per column, never in a preset. Width is
//     about your screen and your eyesight, not about what the board means; syncing it would mean one
//     person's drag re-laying-out everybody else's board, and every save would carry a diff nobody
//     asked for.
//
// WHAT THE FOOTER TOTALS is the same kind of thing as a width, one step further: a user setting keyed
// by (preset × column), so one lens can total a money column while another averages it without
// either choice reaching the team's shared list.
//
// THE STORAGE KEY IS THE CALLER'S, in full - `useColumnWidths(appKey('crm'))`. The shell components
// take a `storagePrefix` and build their own key because the key names a SHELL concept (the sidebar,
// the theme); here the key names one of the app's boards, which is vocabulary this file has no
// business knowing. `storageKey()` in ./lib is there for a caller that wants the house prefix.

import { useCallback, useRef, useState } from 'react'
import { readStored, writeStored } from '../lib/usePersistedState.ts'

/** Per-column pixel widths, keyed by column key. A user setting; NEVER part of a preset. */
export type ColumnWidths = Record<string, number>

/** Drag bounds. The floor keeps a column from collapsing into an unclickable sliver, the ceiling
 *  keeps one drag from pushing every other column off the side of a laptop screen. */
export const MIN_COLUMN_WIDTH = 56
export const MAX_COLUMN_WIDTH = 720

export const clampWidth = (px: number): number =>
  Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, px)))

/** One column as the header row and the grid template see it - vocabulary already resolved to a
 *  label and a number of pixels. */
export interface GridColumn {
  key: string
  label: string
  hint?: string
  /** Rendered width in px. On the flexing identity column this is its FLOOR, not its size. */
  width: number
  /** The identity column: it takes the leftover width rather than a fixed one. */
  flex?: boolean
  /** Extra classes for the label, so a module can line its header up with an indented cell. */
  labelClass?: string
}

/** The frame a module's optional columns sit inside. */
export interface GridSpec {
  /** The identity column (Account / Name / Post). Flexes, so `min` is a floor. */
  name: { key: string; label: string; min: number; labelClass?: string }
  /** Always-on columns between the identity column and the optional ones, in order. */
  fixed: { key: string; label: string; width: number }[]
  /** The trailing action cluster. Not a column: no label, no width setting, no place in the order. */
  actions: number
}

/** One entry of a module's column catalog - `width` stays a CSS string because that is how the three
 *  catalogs already declare it. */
export interface ColumnDef {
  key: string
  label: string
  width: string
  hint?: string
}

const GAP = 8 // gap-2 between cells
const PADDING = 16 // px-2 on both sides of a row

export interface GridLayout {
  /** Every named column, in render order - what the header draws. */
  columns: GridColumn[]
  /** `grid-template-columns`, shared by the header and every row. */
  template: string
  /** What the rows actually need, so the scroll container gets a scrollbar instead of clipping. */
  minWidth: number
}

/**
 * A module's catalog entries in the VIEW's order, dropping keys the catalog no longer has.
 *
 * Order comes from the view now, not from the catalog. The catalog's order is only the order the
 * columns are OFFERED in; which of them you took, and in which order you read them, is yours.
 */
export function orderColumns<T extends { key: string }>(catalog: readonly T[], selected: readonly string[]): T[] {
  const seen = new Set<string>()
  return selected.flatMap((k) => {
    if (seen.has(k)) return []
    seen.add(k)
    return catalog.find((c) => c.key === k) ?? []
  })
}

/** Resolve a module's frame + its ordered optional columns + this browser's widths into one layout. */
export function buildGrid(spec: GridSpec, optional: readonly ColumnDef[], widths: ColumnWidths): GridLayout {
  const at = (key: string, fallback: number): number => clampWidth(widths[key] ?? fallback)
  const columns: GridColumn[] = [
    {
      key: spec.name.key,
      label: spec.name.label,
      width: at(spec.name.key, spec.name.min),
      flex: true,
      labelClass: spec.name.labelClass,
    },
    ...spec.fixed.map((c) => ({ key: c.key, label: c.label, width: at(c.key, c.width) })),
    ...optional.map((c) => ({
      key: c.key,
      label: c.label,
      hint: c.hint,
      width: at(c.key, parseInt(c.width, 10)),
    })),
  ]
  const template = [
    ...columns.map((c) => (c.flex ? `minmax(${c.width}px,1fr)` : `${c.width}px`)),
    `${spec.actions}px`,
  ].join(' ')
  const cells = [...columns.map((c) => c.width), spec.actions]
  return {
    columns,
    template,
    minWidth: cells.reduce((a, b) => a + b, 0) + (cells.length - 1) * GAP + PADDING,
  }
}

// --- the user's own widths ------------------------------------------------------------------------

const isWidths = (v: unknown): v is ColumnWidths =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((n) => typeof n === 'number')

export interface ColumnWidthStore {
  widths: ColumnWidths
  /**
   * Set one column's width. `px: null` puts it back to the column's own default.
   *
   * `commit: false` is a drag in progress: the grid follows the pointer but nothing is written, so a
   * resize is one localStorage write on release rather than one per pointer event.
   */
  setWidth: (key: string, px: number | null, commit?: boolean) => void
}

/** Per-browser column widths for one module, under `<storageKey>.columnWidths`. */
export function useColumnWidths(storageKey: string): ColumnWidthStore {
  const key = `${storageKey}.columnWidths`
  // A ref mirrors the state so a drag can build the next value without reading through a stale
  // closure AND without doing the localStorage write inside a setState updater (React may run an
  // updater twice; a write is not something to run twice).
  const current = useRef<ColumnWidths | null>(null)
  const [widths, setWidths] = useState<ColumnWidths>(() => (current.current = readStored<ColumnWidths>(key, {}, isWidths)))

  const setWidth = useCallback(
    (col: string, px: number | null, commit = true): void => {
      const next = { ...current.current }
      if (px == null) delete next[col]
      else next[col] = clampWidth(px)
      current.current = next
      setWidths(next)
      if (commit) writeStored(key, next)
    },
    [key],
  )

  return { widths, setWidth }
}

// --- footer aggregates ----------------------------------------------------------------------------

/** What a footer cell does with a column's numbers. `none` is the default for every column, and it
 *  has to be: a footer full of numbers nobody asked for is the failure mode of this whole feature. */
export type AggregateMethod = 'none' | 'sum' | 'avg' | 'min' | 'max'

export const AGGREGATE_METHODS: AggregateMethod[] = ['none', 'sum', 'avg', 'min', 'max']

export const AGGREGATE_LABEL: Record<AggregateMethod, string> = {
  none: 'None',
  sum: 'Sum',
  avg: 'Average',
  min: 'Minimum',
  max: 'Maximum',
}

/** How the answer is drawn (`../components/Figures.tsx`). The footer never learns what the column MEANS -
 *  only whether its number is money, a percentage or a plain count. */
export type AggregateUnit = 'count' | 'currency' | 'percent'

/**
 * What a module declares to make one of its columns aggregatable. WHICH columns qualify is the
 * module's call, never the footer's - it is the same split every other shared board component keeps,
 * and it is what lets one column multiply two of a row's fields together and another count only the
 * open children, while the footer stays vocabulary-free.
 */
export interface Aggregatable<T> {
  /**
   * Read one row as a number, or `null` when the row has nothing on this axis.
   *
   * A null is SKIPPED, never counted as zero: a row with nothing set on this axis is a blank, and averaging
   * it in as `0` would quietly answer a different question than the one asked. It is the same call
   * a sort makes when it sinks blanks in both directions.
   */
  value: (row: T) => number | null
  /** Defaults to `count`. */
  unit?: AggregateUnit
}

/** One column's numbers, ready for the footer: what the visible rows read as, and how to print it. */
export interface AggregateSource {
  values: number[]
  unit: AggregateUnit
}

/** Column key → its numbers. Only the columns actually ON the board, and only the ones the module
 *  declared aggregatable, appear here. */
export type AggregateSources = Record<string, AggregateSource>

/**
 * Read the visible rows through a module's catalog. Computed for every aggregatable column on the
 * board, not just the ones set to something - a column with no numbers behind it could not offer the
 * choice in the first place, and reading a few dozen rows is cheaper than the popover that offers it.
 */
export function aggregateSources<T>(
  rows: readonly T[],
  columns: readonly string[],
  catalog: readonly { key: string; agg?: Aggregatable<T> }[],
): AggregateSources {
  const out: AggregateSources = {}
  for (const key of columns) {
    const agg = catalog.find((c) => c.key === key)?.agg
    if (!agg) continue
    out[key] = {
      values: rows.map((r) => agg.value(r)).filter((n): n is number => n != null && Number.isFinite(n)),
      unit: agg.unit ?? 'count',
    }
  }
  return out
}

/** Apply one method to one column's numbers. `null` when there is nothing to answer with - which is
 *  what an empty board, or a column where every row is blank, honestly is. */
export function aggregate(values: readonly number[], method: AggregateMethod): number | null {
  if (method === 'none' || values.length === 0) return null
  switch (method) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length
    case 'min':
      return Math.min(...values)
    default:
      return Math.max(...values)
  }
}

/** How many decimals the answer deserves. An average is the only method that can invent a fraction,
 *  and rounding it away would print 2.4 open tasks and 1.6 as the same number. Money always carries
 *  its cents, for the reason `formatCurrency` does. */
export const aggregateDecimals = (unit: AggregateUnit, method: AggregateMethod): number =>
  unit === 'currency' ? 2 : method === 'avg' ? 1 : 0

// --- the user's own footer choices -----------------------------------------------------------------

/** Preset name (`''` when no preset is selected) → column key → method. */
type AggregateMap = Record<string, Record<string, AggregateMethod>>

const isMethod = (v: unknown): v is AggregateMethod => AGGREGATE_METHODS.includes(v as AggregateMethod)

const isAggregateMap = (v: unknown): v is AggregateMap =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.values(v).every(
    (byColumn) =>
      !!byColumn &&
      typeof byColumn === 'object' &&
      !Array.isArray(byColumn) &&
      Object.values(byColumn as object).every(isMethod),
  )

export interface AggregateStore {
  /** Column key → method, for the preset currently selected. Columns absent from it are `none`. */
  methods: Record<string, AggregateMethod>
  setMethod: (key: string, method: AggregateMethod) => void
}

/**
 * Per-browser footer methods for one module, under `<storageKey>.columnAggregates`, keyed by the
 * PRESET you are looking through and then by column.
 *
 * Per preset, because the same column answers a different question in each lens: a revenue column
 * summed under a lens of won accounts is what you bill this month, and the same sum under a lens of
 * open ones is a number that means nothing at all. Per browser, for the same reason widths are - it is a reading habit, not something
 * the team's shared list should carry a diff for.
 */
export function useColumnAggregates(storageKey: string, preset: string | null): AggregateStore {
  const key = `${storageKey}.columnAggregates`
  const bucket = preset ?? ''
  // Mirrored in a ref for the same reason `useColumnWidths` keeps one: the write must not happen
  // inside a setState updater, which React may run twice.
  const current = useRef<AggregateMap | null>(null)
  const [map, setMap] = useState<AggregateMap>(
    () => (current.current = readStored<AggregateMap>(key, {}, isAggregateMap)),
  )

  const setMethod = useCallback(
    (column: string, method: AggregateMethod): void => {
      const forPreset = { ...current.current?.[bucket] }
      if (method === 'none') delete forPreset[column]
      else forPreset[column] = method
      const next = { ...current.current, [bucket]: forPreset }
      current.current = next
      setMap(next)
      writeStored(key, next)
    },
    [key, bucket],
  )

  return { methods: map[bucket] ?? {}, setMethod }
}
