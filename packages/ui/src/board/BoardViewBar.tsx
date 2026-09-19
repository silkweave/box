// The control strip above a board: layout toggle, search, group-by, sort, filters (and the × that
// clears them) and columns. ONE ROW in every state.
//
// It carries no count: a count belongs on `GridFooter`, where it labels the row of totals rather
// than sitting at the far end of a strip of controls. Everything here is something you press.
//
// It used to be one per module - two ~380-line files that were the SAME markup over different
// vocabularies, kept apart on the argument that a shared version would cost more in type gymnastics
// than the duplication cost in lines. The third module is where that stopped being true. What made
// the merge cheap is that the VOCABULARY never has to reach this file: the caller hands it a
// `BoardBarSpec` of options and sections, all of them plain `{value, label}`, and keeps every
// meaning to itself.
//
// The rule it exists to enforce, inherited from both originals: nothing is on screen unless it is
// doing work. Filters hide in a popover and surface only as a count on the funnel; optional columns
// are opt-in; the Clear button exists only while there is something to clear.
//
// Two of its controls carry more than they look like. SORT is one control with two values - the
// field, and the direction beside it - because "in what order?" is one question, and baking the
// direction into the field is how you end up with a sort option called "Least recently contacted"
// that cannot be reversed. COLUMNS is a visibility list AND the render ORDER: the chosen ones sit at
// the top in their own order, draggable. Width is deliberately NOT here - it is dragged on the
// header itself and belongs to the reader's browser, not to the team's preset.
//
// IT IS CONTROLLED, and it owns no storage. `value` in, a PATCH out - never a whole state object,
// because switching sort field writes two fields at once and the caller's own state is narrower
// than this one (its filter axes are enums). Where that state lives - a store, the URL, a server
// preset - is the app's business. The preset control itself is the `presets` slot for the same
// reason: presets are persisted somewhere only the app knows about.

import type { ReactNode } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Check,
  Columns3,
  GripVertical,
  ListFilter,
  Search,
  X,
} from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../components/Popover.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/Select.tsx'
import type { NavIcon } from '../shell/Sidebar.tsx'

/** Every board is a list or a board. ONE vocabulary whatever the caller labels them - a CRM calls
 *  its board a "Pipeline", but that is a LABEL, and two stored values for one axis is how a shared
 *  normalize starts needing a per-module table. */
export type BoardLayout = 'list' | 'board'

/** Which way a sort runs. Split from the field it sorts by: fusing the two into one enum value is
 *  what produces a sort called "Least recently contacted" with no way to ask it the other way. */
export type SortDir = 'asc' | 'desc'

/** The axes the bar reads and writes. An app's own view state is narrower (its filter axes are
 *  enums) and usually carries more; it passes the overlap in and merges the patch back. */
export interface BoardBarValue {
  search: string
  layout: BoardLayout
  groupBy: string
  /** OPTIONAL, because a board may have no sort axis at all - one whose rows sit in the order they
   *  were created hands the bar an empty `sort` list and the control never renders. */
  sort?: string
  sortDir?: SortDir
  /** Axis key -> selected values. Narrowed by the app, read loosely here. */
  filters: object
  /** Optional column keys, IN RENDER ORDER, in the app's own vocabulary. */
  columns: readonly string[]
}

/** One toggleable value inside a filter section. */
export interface FilterOption {
  value: string
  label: string
}

/** One sort axis. The DIRECTION is a separate control, so an option names a field and nothing else -
 *  "Last contact", not "Least recently contacted". */
export interface SortOption extends FilterOption {
  /** How this field reads when you switch to it: money and dates-of-record want the big end first,
   *  names and deadlines want the small one. Defaults to ascending. */
  defaultDir?: SortDir
  /** This axis has no direction to speak of (manual order is whatever the drags left behind). */
  undirected?: boolean
}

/** One axis of the filter popover. Callers build these per render from what is actually on the
 *  board, so a filter for a value nobody uses never appears. */
export interface FilterSection {
  /** Key into the app's `filters` record. */
  key: string
  title: string
  options: FilterOption[]
  /** Rendered under the chips - the one place a section gets to explain itself. */
  note?: ReactNode
}

/** Everything the bar needs to know about a board, and nothing about what any of it MEANS. */
export interface BoardBarSpec {
  /** What this board calls its rows: "accounts", "initiatives", "pieces". Used for the search
   *  field's accessible name, and nothing else. */
  noun: string
  searchPlaceholder: string
  /** The two layouts and what this board calls them. */
  layouts: { value: BoardLayout; label: string; icon: NavIcon }[]
  groupBy: FilterOption[]
  /** The sort axes. EMPTY is a legitimate answer and the control does not render at all. */
  sort: SortOption[]
  /** The optional columns on offer, in the order they are OFFERED in. Which ones are on, and in what
   *  order they render, is view state (`value.columns`). */
  columns: { key: string; label: string }[]
  /** The line above the column list, naming the ones that are always shown. */
  columnsNote: string
  /** The filter axes, in the order they should appear. */
  sections: FilterSection[]
  /** A scope imposed from OUTSIDE the bar that is narrowing the board anyway. Shown as a chip;
   *  omitted when nothing applies. */
  notice?: ReactNode
  /** All axes empty - what the Clear button writes. */
  emptyFilters: object
}

/** How many axes are narrowing the board, search included. Deliberately NOT exported: an app that
 *  wants the same number elsewhere computes it over its own state, which is the shape it has. */
function activeFilterCount(filters: object, search: string): number {
  return (
    Object.values(filters as Record<string, string[]>).reduce((n, list) => n + (list.length > 0 ? 1 : 0), 0) +
    (search.trim() ? 1 : 0)
  )
}

export function BoardViewBar({
  value,
  onChange,
  spec,
  presets,
}: {
  value: BoardBarValue
  /** A PARTIAL of the axes that changed - the caller merges it into its own state. */
  onChange: (patch: Partial<BoardBarValue>) => void
  spec: BoardBarSpec
  /** The preset control, first in the strip. Presets are persisted by the app, so the app draws them. */
  presets?: ReactNode
}) {
  const filters = value.filters
  const nFilters = activeFilterCount(filters, value.search)
  const isList = value.layout === 'list'
  // A small distance threshold keeps a click on a column's checkbox from being read as a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  // The columns, split the way the popover shows them: the ones that are on, in THEIR order, then
  // everything else in the order the caller offers them.
  const chosen = value.columns.flatMap((k) => spec.columns.find((c) => c.key === k) ?? [])
  const unchosen = spec.columns.filter((c) => !value.columns.includes(c.key))
  const toggleColumn = (key: string): void =>
    onChange({
      columns: value.columns.includes(key) ? value.columns.filter((k) => k !== key) : [...value.columns, key],
    })
  const onColumnDragEnd = (e: DragEndEvent): void => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const keys = [...value.columns]
    const from = keys.indexOf(String(active.id))
    const to = keys.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    onChange({ columns: arrayMove(keys, from, to) })
  }

  const sortOption = spec.sort.find((o) => o.value === value.sort)
  // Switching field also switches direction, to the one that field reads naturally. Picking "MRR"
  // and being shown the smallest accounts first would be a control that technically obeyed you.
  const setSort = (next: string | null): void => {
    if (next == null) return
    onChange({ sort: next, sortDir: spec.sort.find((o) => o.value === next)?.defaultDir ?? 'asc' })
  }

  // One cast at the boundary: an app narrows each axis to its own enum, and a narrowed array is not
  // assignable through an index signature. The bar only ever reads and writes string arrays.
  const selected = (key: string): string[] => (filters as Record<string, string[]>)[key] ?? []
  const setAxis = (key: string, values: string[]): void => onChange({ filters: { ...filters, [key]: values } })
  const toggle = (key: string, value_: string): void => {
    const on = selected(key)
    setAxis(key, on.includes(value_) ? on.filter((x) => x !== value_) : [...on, value_])
  }
  const clearAll = (): void => onChange({ filters: spec.emptyFilters, search: '' })

  return (
    // The bar is a STRIP, not a block floating above a card: it spans the full width of the canvas
    // and its bottom border is the grid header's top edge. Slim, because it is chrome sitting
    // between you and your data - the controls are 28px and the ones whose icon says it all dropped
    // their labels.
    //
    // ONE ROW, always. It used to grow a second row spelling out every active filter as a chip, on
    // the argument that a filter you cannot see is a filter you forget you set. The count on the
    // funnel and the × beside it say the same thing in a fixed amount of space, and the row that
    // appeared and disappeared under the bar moved the whole grid down the moment you filtered.
    <div className='flex flex-wrap items-center gap-1.5 border-b border-border bg-bg px-3 py-1.5'>
      {presets}

      {/* Two options, so it is a segmented control rather than a select - and it sits with the
          preset controls because the layout IS part of what a preset stores. Icon-only: a list and
          a board are the two shapes everybody already reads at a glance. */}
      <div
        role='radiogroup'
        aria-label='Layout'
        className='inline-flex h-7 items-center rounded-md border border-border bg-bg p-0.5'>
        {spec.layouts.map((l) => {
          const on = value.layout === l.value
          return (
            <button
              key={l.value}
              type='button'
              role='radio'
              aria-checked={on}
              onClick={() => onChange({ layout: l.value })}
              aria-label={l.label}
              title={l.label}
              className={cn(
                'inline-flex size-6 items-center justify-center rounded transition-colors',
                on ? 'bg-accent-tint text-accent' : 'text-muted-foreground hover:text-text',
              )}>
              <l.icon className='size-3.5' />
            </button>
          )
        })}
      </div>

      <div className='relative'>
        <Search className='pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground' />
        <input
          value={value.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder={spec.searchPlaceholder}
          aria-label={`Search ${spec.noun}`}
          className='h-7 w-56 rounded-md border border-border bg-bg pr-2 pl-7 text-body-sm text-text transition-colors outline-none placeholder:text-fg-4 hover:border-accent/40 focus:border-accent'
        />
      </div>

      {/* Grouping is a list concept: the board already groups, in columns. */}
      {isList && spec.groupBy.length > 0 && (
        <Select
          value={value.groupBy}
          onValueChange={(next) => next != null && onChange({ groupBy: next })}
          items={spec.groupBy}>
          <SelectTrigger aria-label='Group by' className='h-7 min-w-32'>
            <SelectValue>
              {(val) => (
                <span className={val === 'none' ? 'text-muted-foreground' : undefined}>
                  Group: {spec.groupBy.find((o) => o.value === val)?.label}
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {spec.groupBy.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Field and direction are ONE control: they answer one question ("in what order?") and
          splitting them across the bar made the arrow read as a stray toggle. A board with no sort
          axes at all draws neither half - see `BoardBarSpec.sort`. */}
      {spec.sort.length > 0 && (
        <div className='inline-flex items-center'>
          <Select value={value.sort ?? ''} onValueChange={setSort} items={spec.sort}>
            <SelectTrigger
              aria-label='Sort'
              className={cn('h-7 min-w-28', !sortOption?.undirected && 'rounded-r-none border-r-0')}>
              <SelectValue>{(val) => <span>Sort: {spec.sort.find((o) => o.value === val)?.label}</span>}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {spec.sort.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!sortOption?.undirected && (
            <button
              type='button'
              onClick={() => onChange({ sortDir: value.sortDir === 'asc' ? 'desc' : 'asc' })}
              aria-label={`Sort direction: ${value.sortDir === 'asc' ? 'ascending' : 'descending'}`}
              title={`${value.sortDir === 'asc' ? 'Ascending' : 'Descending'} - click to reverse`}
              className='inline-flex h-7 items-center rounded-r-md border border-border bg-bg px-1.5 text-muted-foreground transition-colors hover:border-accent/40 hover:text-text'>
              {value.sortDir === 'asc' ? (
                <ArrowUpNarrowWide className='size-3.5' />
              ) : (
                <ArrowDownWideNarrow className='size-3.5' />
              )}
            </button>
          )}
        </div>
      )}

      {/* Filter and Clear are ONE control, the same shape as sort's field+direction pair: the funnel
          opens the axes, the × next to it empties them. They are joined because clearing is not a
          separate concern from filtering - it is the thing you want the instant you can see the
          board is filtered, and it used to live at the end of a second row of chips. */}
      <div className='inline-flex items-center'>
        <Popover>
          {/* Icon-only, but the COUNT stays: a funnel says "filters live here", and the number is
              the only part that says something you cannot see from the board itself. */}
          <PopoverTrigger
            aria-label={nFilters > 0 ? `Filters (${nFilters} active)` : 'Filters'}
            title={nFilters > 0 ? `${nFilters} active filter${nFilters > 1 ? 's' : ''}` : 'Filter'}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded-md border px-1.5 text-body-sm transition-colors',
              nFilters > 0
                ? 'rounded-r-none border-r-0 border-accent/40 bg-accent-tint text-accent'
                : 'border-border bg-bg text-muted-foreground hover:border-accent/40 hover:text-text',
            )}>
            <ListFilter className='size-3.5' />
            {nFilters > 0 && <span className='tabular-nums'>{nFilters}</span>}
          </PopoverTrigger>
          <PopoverContent align='start' side='bottom' className='flex max-h-[70vh] w-80 flex-col gap-3 overflow-y-auto'>
            {spec.sections
              .filter((s) => s.options.length > 0)
              .map((s) => (
                <div key={s.key} className='flex flex-col gap-1.5'>
                  <span className='text-label font-medium text-muted-foreground'>{s.title}</span>
                  <div className='flex flex-wrap gap-1'>
                    {s.options.map((o) => {
                      const on = selected(s.key).includes(o.value)
                      return (
                        <button
                          key={o.value}
                          type='button'
                          onClick={() => toggle(s.key, o.value)}
                          aria-pressed={on}
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-label transition-colors',
                            on
                              ? 'border-accent/40 bg-accent-tint text-accent'
                              : 'border-border text-muted-foreground hover:border-accent/30 hover:text-text',
                          )}>
                          {o.label}
                        </button>
                      )
                    })}
                  </div>
                  {s.note && <span className='text-label text-muted-foreground'>{s.note}</span>}
                </div>
              ))}
          </PopoverContent>
        </Popover>
        {/* Only on screen when it would do something - an always-present × on an unfiltered board is
            a control that is disabled 90% of the time. */}
        {nFilters > 0 && (
          <button
            type='button'
            onClick={clearAll}
            aria-label={`Clear ${nFilters} filter${nFilters > 1 ? 's' : ''}`}
            title='Clear the filters and the search'
            className='inline-flex h-7 items-center rounded-r-md border border-accent/40 bg-accent-tint px-1.5 text-accent transition-colors hover:bg-accent/20'>
            <X className='size-3.5' />
          </button>
        )}
      </div>

      {/* Columns shape the list; a board card has a fixed anatomy. */}
      {isList && spec.columns.length > 0 && (
        <Popover>
          <PopoverTrigger
            aria-label='Columns'
            title='Columns - which, and in what order'
            className='inline-flex size-7 items-center justify-center rounded-md border border-border bg-bg text-muted-foreground transition-colors hover:border-accent/40 hover:text-text'>
            <Columns3 className='size-3.5' />
          </PopoverTrigger>
          <PopoverContent align='start' side='bottom' className='flex max-h-[70vh] w-64 flex-col gap-1 overflow-y-auto'>
            <span className='px-1 text-label text-muted-foreground'>{spec.columnsNote}</span>
            <span className='px-1 pb-1 text-label text-fg-4'>
              Drag to reorder. To resize, drag a column's right edge in the header - that one is
              yours alone, and no preset stores it.
            </span>
            {/* The chosen ones, in the order they render - drag to rearrange the board. */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onColumnDragEnd}>
              <SortableContext items={chosen.map((c) => c.key)} strategy={verticalListSortingStrategy}>
                {chosen.map((c) => (
                  <SortableColumnRow key={c.key} column={c} onToggle={() => toggleColumn(c.key)} />
                ))}
              </SortableContext>
            </DndContext>
            {unchosen.length > 0 && (
              <>
                {chosen.length > 0 && (
                  <span className='mt-1 border-t border-border px-1 pt-2 text-label text-fg-4'>Not shown</span>
                )}
                {unchosen.map((c) => (
                  <ColumnRow key={c.key} label={c.label} on={false} onToggle={() => toggleColumn(c.key)} />
                ))}
              </>
            )}
          </PopoverContent>
        </Popover>
      )}

      {/* A scope set somewhere else entirely still narrows this board, so it says so here. A filter
          you cannot see is a filter you forget you set. */}
      {spec.notice && (
        <span className='inline-flex h-7 items-center rounded-md bg-accent-tint px-2 text-label text-accent'>
          {spec.notice}
        </span>
      )}
    </div>
  )
}

/** One row of the columns popover: the checkmark, the label, and (when it is on) a drag handle. */
function ColumnRow({
  label,
  on,
  onToggle,
  handle,
}: {
  label: string
  on: boolean
  onToggle: () => void
  handle?: ReactNode
}) {
  return (
    <div className='flex items-center gap-1'>
      <button
        type='button'
        onClick={onToggle}
        aria-pressed={on}
        className='flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-body-sm text-text hover:bg-accent-tint'>
        <Check className={cn('size-3.5 shrink-0', on ? 'text-accent' : 'opacity-0')} />
        <span className='truncate'>{label}</span>
      </button>
      {handle}
    </div>
  )
}

function SortableColumnRow({ column, onToggle }: { column: { key: string; label: string }; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: column.key })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('rounded', isDragging && 'bg-surface-hover opacity-80')}>
      <ColumnRow
        label={column.label}
        on
        onToggle={onToggle}
        handle={
          <button
            type='button'
            aria-label={`Reorder ${column.label}`}
            title='Drag to reorder'
            className='shrink-0 cursor-grab touch-none rounded p-1 text-fg-4 transition-colors hover:text-muted-foreground active:cursor-grabbing'
            {...attributes}
            {...listeners}>
            <GripVertical className='size-3.5' />
          </button>
        }
      />
    </div>
  )
}
