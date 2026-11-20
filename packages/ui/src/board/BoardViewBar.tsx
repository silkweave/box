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
// `BoardBarSpec` of plain `{value, label}` options and typed filter fields, and keeps every meaning
// to itself.
//
// The rule it exists to enforce, inherited from both originals: nothing is on screen unless it is
// doing work. Filters hide in a popover and surface as a count on the funnel; optional columns are
// opt-in; the Clear button exists only while there is something to clear.
//
// FILTERS ARE TYPED (2026-10-30). Each field says what it is - a list of options, a person, a date,
// a number, text, an on/off flag - and the funnel opens the filter kit's panel (`../filters`), which
// draws the editor that type calls for: a date gets relative windows and a range rather than four
// bucket chips. A field may also be PINNED: a preset names the fields that matter to it, and each
// sits in the row as a chip with its value, one click from its editor. Pinning is offered (a star in
// the panel) where the host passes `pins`; `DataGrid` always does, keeping pins in the preset or,
// for a grid that keeps its own view, in this browser under its `storageKey`.
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
// than this one (its option fields are enums). Where that state lives - a store, the URL, a server
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
  Check,
  Columns3,
  GripVertical,
} from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { SearchInput } from '../components/SearchInput.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../components/Popover.tsx'
import { PopoverHeader } from '../components/PopoverHeader.tsx'
import { offered } from '../filters/FilterPanel.tsx'
import { PinnedFilterChip } from '../filters/PinnedFilterChip.tsx'
import { isActive } from '../filters/match.ts'
import type { FilterField, FilterOption, FilterValue, Filters, SortDir, SortOption } from '../filters/types.ts'
import { FilterControl, GroupControl, SortControl } from '../filters/ViewControls.tsx'
import type { NavIcon } from '../shell/Sidebar.tsx'

/** The two shared layouts: a list and a board. ONE vocabulary whatever the caller labels them - a
 *  CRM calls its board a "Pipeline", but that is a LABEL, and two stored values for one axis is how
 *  a shared normalize starts needing a per-module table. A module that draws a genuinely different
 *  shape (a timeline) adds its own value through `LayoutOption`; it never renames these two. */
export type BoardLayout = 'list' | 'board'

/** One entry of the layout toggle. `groups` and `columns` say whether the group-by select and the
 *  column picker apply to it; both default to true for `list` and false for anything else, since a
 *  board already groups, in columns, and its cards have a fixed anatomy. */
export interface LayoutOption {
  /** A `BoardLayout`, or the module's own value for a layout only it draws. */
  value: string
  label: string
  icon: NavIcon
  groups?: boolean
  columns?: boolean
}

export type { SortDir, SortOption } from '../filters/types.ts'

/** The axes the bar reads and writes. An app's own view state is narrower (its option fields are
 *  enums) and usually carries more; it passes the overlap in and merges the patch back. */
export interface BoardBarValue {
  search: string
  /** A `BoardLayout` or a module's own layout value; one of `spec.layouts`. */
  layout: string
  groupBy: string
  /** OPTIONAL, because a board may have no sort axis at all - one whose rows sit in the order they
   *  were created hands the bar an empty `sort` list and the control never renders. */
  sort?: string
  sortDir?: SortDir
  /** Field key -> typed filter value (absent or null: no filter). Narrowed by the app. */
  filters: Filters
  /** The fields pinned to the bar as chips, IN BAR ORDER. Only read where the host passes `pins`. */
  pinned?: readonly string[]
  /** Optional column keys, IN RENDER ORDER, in the app's own vocabulary. */
  columns: readonly string[]
}

export type { FilterOption }

/** Everything the bar needs to know about a board, and nothing about what any of it MEANS. */
export interface BoardBarSpec {
  /** What this board calls its rows: "accounts", "initiatives", "tickets". Used for the search
   *  field's accessible name, and nothing else. */
  noun: string
  searchPlaceholder: string
  /** The layouts this board offers and what it calls them. */
  layouts: LayoutOption[]
  groupBy: FilterOption[]
  /** The sort axes. EMPTY is a legitimate answer and the control does not render at all. */
  sort: SortOption[]
  /** The optional columns on offer, in the order they are OFFERED in. Which ones are on, and in what
   *  order they render, is view state (`value.columns`). */
  columns: { key: string; label: string }[]
  /** The line above the column list, naming the ones that are always shown. */
  columnsNote: string
  /** The filter fields, in the order the panel lists them. Callers build these per render from what
   *  is actually on the board, so an option nobody uses never appears. */
  fields: FilterField[]
  /** A scope imposed from OUTSIDE the bar that is narrowing the board anyway. Shown as a chip;
   *  omitted when nothing applies. */
  notice?: ReactNode
}

/** The controls the bar can draw. A host that embeds a list in a page section (a card) turns some
 *  off - presets and grouping belong to a whole page, not a panel - and every one defaults to on. */
export type BoardBarControl = 'layout' | 'search' | 'group' | 'sort' | 'filters' | 'columns'

/** How many fields are narrowing the board, search included, each judged by its own type (an empty
 *  list, a blank text or a half-set range narrows nothing). Deliberately NOT exported: an app that
 *  wants the same number elsewhere computes it over its own schema. */
function activeFilterCount(fields: readonly FilterField[], filters: Filters, search: string): number {
  return fields.reduce((n, f) => n + (isActive(f.type, filters[f.key]) ? 1 : 0), 0) + (search.trim() ? 1 : 0)
}

/**
 * The control strip above a board or list: presets, layout, search, group, sort, filters (with
 * pinned chips) and columns, in one row.
 * Use it above a `BoardKanban` or a custom list; `DataGrid` already draws it.
 * Not for a row count (`GridFooter`).
 * Controlled: `value` in, a partial patch out. `spec` carries the caller's options and typed filter
 * fields; `controls` turns controls off; `pins` offers pinning; `dense` suits a card.
 */
export function BoardViewBar({
  value,
  onChange,
  spec,
  presets,
  controls,
  pins = false,
  today,
  dense = false,
  settings = false,
  trailing,
}: {
  value: BoardBarValue
  /** A PARTIAL of the axes that changed - the caller merges it into its own state. */
  onChange: (patch: Partial<BoardBarValue>) => void
  spec: BoardBarSpec
  /** The preset control, first in the strip. Presets are persisted by the app, so the app draws them. */
  presets?: ReactNode
  /** Which controls to draw; a missing key reads as on. */
  controls?: Partial<Record<BoardBarControl, boolean>>
  /** Offer pinning (the star in the filter panel) and draw `value.pinned` as chips. For a board whose
   *  view has somewhere to keep it, i.e. one with presets. */
  pins?: boolean
  /** "Today" for the date filters, `YYYY-MM-DD` (the default clock when absent). */
  today?: string
  /** The embedded form: no strip border or canvas background, a narrower search. */
  dense?: boolean
  /** On a settings canvas: ruled top and bottom on the pane's surface (`DataGrid` sets it). */
  settings?: boolean
  /** Pushed to the far end of the strip, e.g. a card's own action. */
  trailing?: ReactNode
}) {
  const show = (c: BoardBarControl): boolean => controls?.[c] !== false
  const filters = value.filters
  const fields = spec.fields.filter(offered)
  const nFilters = activeFilterCount(spec.fields, filters, value.search)
  // A pinned key whose field is not on offer today (an empty option list) draws no chip; it stays
  // pinned, and comes back with the field.
  const pinnedFields = pins ? (value.pinned ?? []).flatMap((k) => fields.find((f) => f.key === k) ?? []) : []
  const layout = spec.layouts.find((l) => l.value === value.layout)
  const isList = value.layout === 'list'
  const showGroups = layout?.groups ?? isList
  const showColumns = layout?.columns ?? isList
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

  // A field with no filter is absent from the record rather than present as null, so a cleared view
  // and a fresh one are the same object.
  const setField = (key: string, next: FilterValue | null): void => {
    const rest = Object.fromEntries(Object.entries(filters).filter(([k]) => k !== key))
    onChange({ filters: next === null ? rest : { ...rest, [key]: next } })
  }
  // Pins are not filters: clearing empties the fields and leaves the chips where the preset put them.
  const clearAll = (): void => onChange({ filters: {}, search: '' })

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
    <div className={cn('flex flex-wrap items-center gap-1.5', dense ? 'px-0 py-0' : settings ? 'border-y border-border bg-surface p-2' : 'border-b border-border bg-bg p-2')}>
      {presets}

      {/* Two or three options, so it is a segmented control rather than a select - and it sits with
          the preset controls because the layout IS part of what a preset stores. Icon-only: a list
          and a board are shapes everybody already reads at a glance, and the title names the rest. */}
      {show('layout') && spec.layouts.length > 1 && (
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
      )}

      {show('search') && (
      <SearchInput
        size='sm'
        value={value.search}
        onChange={(search) => onChange({ search })}
        placeholder={spec.searchPlaceholder}
        label={`Search ${spec.noun}`}
        className={dense ? 'w-44' : 'w-56'}
      />
      )}

      {/* The pinned fields, right after search: the questions this preset is about, each answered
          in place. They are part of the one row and wrap with it like every other control. */}
      {show('filters') &&
        pinnedFields.map((f) => (
          <PinnedFilterChip key={f.key} field={f} value={filters[f.key]} onChange={(next) => setField(f.key, next)} today={today} />
        ))}

      {/* Grouping is a list concept (and any layout that declares it): the board already groups,
          in columns. */}
      {show('group') && showGroups && spec.groupBy.length > 0 && (
        <GroupControl options={spec.groupBy} value={value.groupBy} onChange={(groupBy) => onChange({ groupBy })} />
      )}

      {show('sort') && spec.sort.length > 0 && (
        <SortControl options={spec.sort} sort={value.sort} dir={value.sortDir} onChange={(sort, sortDir) => onChange({ sort, sortDir })} />
      )}

      {/* Filter and Clear are ONE control, the same shape as sort's field+direction pair: the funnel
          opens the axes, the × next to it empties them. They are joined because clearing is not a
          separate concern from filtering - it is the thing you want the instant you can see the
          board is filtered, and it used to live at the end of a second row of chips. */}
      {show('filters') && fields.length > 0 && (
        <FilterControl
          fields={fields}
          value={filters}
          onChange={(next) => onChange({ filters: next })}
          active={nFilters}
          onClear={clearAll}
          pinned={value.pinned}
          onPinnedChange={pins ? (next) => onChange({ pinned: next }) : undefined}
          today={today}
        />
      )}

      {/* Columns shape the list (and any layout that declares them); a board card has a fixed anatomy. */}
      {show('columns') && showColumns && spec.columns.length > 0 && (
        <Popover>
          <PopoverTrigger
            aria-label='Columns'
            title='Columns - which, and in what order'
            className='inline-flex size-7 items-center justify-center rounded-md border border-border bg-bg text-muted-foreground transition-colors hover:border-accent/40 hover:text-text'>
            <Columns3 className='size-3.5' />
          </PopoverTrigger>
          <PopoverContent align='start' side='bottom' className='flex max-h-[70vh] w-64 flex-col gap-0 p-0'>
            <PopoverHeader
              title='Columns'
              info={<>{spec.columnsNote} Drag to reorder. To resize, drag a column's right edge in the header; that width is yours alone.</>}
            />
            <div className='flex min-h-0 flex-col gap-1 overflow-y-auto p-2'>
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
            </div>
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
      {trailing && <div className='ml-auto flex items-center gap-1.5'>{trailing}</div>}
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
