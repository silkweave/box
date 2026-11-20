// One list component for every place the Box shows rows: a whole page (Initiatives, All tasks,
// Deals) and a section of a detail page (an initiative's tasks, an account's deals).
//
// TWO VARIANTS, ONE COMPONENT:
//
//   • `full` claims the page: the view bar is a strip across the top, the grid scrolls under a
//     sticky header, and a sticky footer carries the row count and the column totals.
//   • `card` sits inside a page: a bordered surface with a heading and the same bar drawn dense
//     beside it, the same footer (count and totals), and no height cap unless the host sets one.
//     Presets and grouping are page concepts and are off unless the host turns them on.
//
// The bar is `BoardViewBar`, so a card and a page speak one control vocabulary. The grid is the
// house grid (`GridHeader`, `GridFooter`, `buildGrid`): column order and visibility are view state,
// widths and totals are this browser's.
//
// IT IS CONTROLLED and owns no storage beyond widths and totals: `view` in, a patch out, like the
// bar. What the rows MEAN stays with the host, which passes accessors - how to search a row, which
// value it has on a filter field, what to sort and group it by, who its parent is, where it may go.
// The component does the mechanics (filter, sort, group, nest, fold, move) so every host does them
// the same way. Drag lives in `useTreeDrag`, pending moves in `moves.ts`, the row in `Row`, the
// pure tree in `tree.ts`.
//
// One grid instance shows one dataset: give it a React `key` per dataset (e.g. the initiative id),
// so moves still being written for one never carry over to another.

import { useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { DndContext } from '@dnd-kit/core'
import { ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { BoardViewBar, type BoardBarControl, type BoardBarSpec, type BoardBarValue } from '../board/BoardViewBar.tsx'
import { Button } from '../components/Button.tsx'
import { errorMessage } from '../lib/errorMessage.ts'
import { currentToday } from '../components/DateInput.tsx'
import { isActive, matchFilter } from '../filters/match.ts'
import { currentMe, schemaOf, type FilterContext, type FilterRowValue } from '../filters/types.ts'
import { GridHeader } from './GridHeader.tsx'
import { GridFooter } from './GridFooter.tsx'
import { aggregateSources, buildGrid, clampWidth, frozenColumnStyle, orderColumns, useColumnAggregates, useColumnWidths, type Aggregatable, type ColumnDef } from './columns.ts'
import { COLUMN_GAP, GAP, INDENT, MARK, ROW_PAD, TOGGLE } from './geometry.ts'
import { useMoveQueue, type Move, type MoveCheck, type MoveIntent } from './moves.ts'
import { ownClick, Row } from './Row.tsx'
import { childrenByParent, depthOf, flattenTree, orderAfterMove, parentsUnder, subtreeHeight, treeRoots, type Projection, type TreeNode } from './tree.ts'
import { useGlide } from './useGlide.ts'
import { useTreeDrag } from './useTreeDrag.ts'
import { SETTINGS_GUTTER, SettingsBaseFooterContext, usePublishFooter } from '../settings/SettingsPane.tsx'
import { SettingsReadOnlyContext, blockSpacing, onCanvas, useCanvasMode } from '../settings/internal.tsx'
import { SettingsError } from '../settings/states.tsx'
import { GRID_PAD } from './chrome.ts'
import { GroupRow } from './GroupRow.tsx'
import { useListView } from './useListView.ts'

/** `full`: the page (bar on top, rows fill it). `card`: a framed card with its heading and bar in a
 *  strip. `section`: the card's layout unframed, a page section among others (a document's heading,
 *  the bar at its right end); the page draws the rules between sections. */
export type DataGridVariant = 'full' | 'card' | 'section'

/** The value of the sort axis that means "the order the rows are kept in" - the one drag writes. */
export const MANUAL_SORT = 'manual'

const DRAG_HINT = 'Drag needs the manual order, no grouping and no filters'

export interface DataGridColumn<T> {
  key: string
  label: string
  /** px */
  width: number
  hint?: string
  /** Always shown, between the name and the optional columns; not in the column picker. */
  fixed?: boolean
  /**
   * An icon column that may sit before the name: while it leads the column order it renders at the
   * row's left edge, its content in a `width` px box at the row's edge padding and the name cell's
   * GAP after it, so the content sits as far from the edge as from a name that pads its text by GAP.
   * Moved later in the order, it renders after the name like any optional column, centred in its
   * track. With `fixed` it always leads and stays out of the column picker (a record's own icon).
   */
  leading?: boolean
  /** The header's icon in place of the label (the label becomes its tooltip), centred over the cells. */
  icon?: ReactNode
  render: (row: T) => ReactNode
  /** The cell while the row is being edited in place (see `editing`); omitted, it keeps `render`. */
  edit?: (row: T) => ReactNode
  /** Which columns give way first when a card, section or settings grid is narrower than its
   *  columns: 3, then 2 drop before 1 (the default, kept as long as anything is). Measured on the
   *  grid's own width. A `full` page grid never drops a column; it scrolls sideways. */
  priority?: 1 | 2 | 3
  /** Off until someone turns it on in the column picker (pages with a picker only). */
  hidden?: boolean
  /** Makes the column totalable in the footer. */
  agg?: Aggregatable<T>
}

/** A group of a grouped grid known before its rows: kept in this order, shown while empty. */
export interface DataGridGroup {
  key: string
  label: ReactNode
  /** The plain name, for the fold button ("Expand Backups"). */
  name: string
  /** The group's own controls at the row's end (a "..." menu). */
  aside?: ReactNode
  /** Lets a drop target wrap the group row. */
  ref?: Ref<HTMLDivElement>
}

/** In-place editing, controlled: the row with `id` (or the new `row`) draws its edit cells. */
export interface DataGridEditing<T> {
  /** The row being edited, or null. */
  id: string | null
  /** A row that does not exist yet (the create row): drawn first and kept while the view narrows. */
  row?: T
  onSave: () => void | Promise<void>
  onCancel: () => void
  canSave?: boolean
  /** "Save" by default; "Create kind" for the create row. */
  saveLabel?: string
}

/** A move to write: the row, its new parent, the sibling it follows, and the whole order after it. */
export type DataGridMove = Move

export interface DataGridProps<T> {
  variant?: DataGridVariant
  rows: readonly T[]
  getId: (row: T) => string
  /**
   * The identity column: it flexes and holds the indentation, the fold chevron and the mark.
   * `labelClass` lines the header label up with how `render` pads its text; `edit` is its cell
   * while the row edits in place.
   */
  name: { label: string; min?: number; labelClass?: string; render: (row: T) => ReactNode; edit?: (row: T) => ReactNode }
  /** A small icon before the name (about 10-14px), e.g. a kind. It doubles as the drag handle. */
  icon?: (row: T) => ReactNode
  /** The row in words, for control labels and move announcements. Defaults to `searchText`. */
  rowLabel?: (row: T) => string
  columns: readonly DataGridColumn<T>[]

  /**
   * View state. Controlled when given (a page with presets); omitted, the grid keeps it itself,
   * starting from `defaultView` and kept per browser under `storageKey`. `columns` lists the
   * optional columns that are on, in render order.
   */
  view?: BoardBarValue
  onViewChange?: (patch: Partial<BoardBarValue>) => void
  defaultView?: Partial<BoardBarValue>
  /**
   * The bar's vocabulary. Only `noun` is required ("users"; `one` when dropping the final "s" is
   * wrong); no `sort`, `groupBy`, `fields` or `layouts` means no such control. Its `columns` and
   * `columnsNote` default from `columns`.
   */
  bar: { noun: string; one?: string } & Partial<Omit<BoardBarSpec, 'noun' | 'columns'>>
  /** Which bar controls draw. Defaults: everything on `full`; no grouping on `card`. */
  controls?: Partial<Record<BoardBarControl, boolean>>
  /** The preset control, drawn first in the bar (`full` only unless the host passes it to a card). */
  presets?: ReactNode

  /** The text a search matches against. Omit and search is not offered. */
  searchText?: (row: T) => string
  /**
   * A row's value on a filter field (`bar.fields[].key`), in the shape its type reads (see
   * `FilterRowValue`: a day or `{ day, open }` for a date, a number, a user id...). Omit it when the
   * host narrows `rows` itself: the bar still shows the filters, and the grid matches nothing.
   */
  filterValue?: (row: T, axis: string) => FilterRowValue
  /**
   * Whether a row with no value on a filtered `options` field still shows (a field that does not
   * apply to it). Defaults to false (a blank is no match). Pass true, or decide per field, where a
   * field does not apply to some rows and they should stay.
   * The other types say blanks themselves: a person's Nobody, a date's No date, a number's Empty.
   */
  filterKeepsBlank?: boolean | ((axis: string) => boolean)
  /** What date and person filters read: today (the default clock when absent) and who "me" is. */
  filterContext?: Partial<FilterContext>
  /** A row's value for a sort key. Blanks sink in both directions. */
  sortValue?: (row: T, key: string) => string | number | null
  /** Which group a row falls in for a group-by key, and how that group is titled. */
  groupOf?: (row: T, key: string) => { key: string; label: ReactNode }

  /** Rows nest when given. Siblings keep input order under the manual sort. */
  parentId?: (row: T) => string | null
  /**
   * Enables drag (and arrow keys on the handle) under the manual sort, ungrouped and unfiltered.
   * A move shows at once. Return a promise that settles once `rows` reflects the move (resolve after
   * the refetch, not after the request); until then the grid keeps drawing it, and a rejection puts
   * the rows back. Moves made meanwhile show at once too and are handed over one at a time, each
   * resolved against the rows as they are by then (see `moves.ts`).
   */
  onMove?: (move: DataGridMove) => void | Promise<unknown>
  /** A move that failed (the write threw or rejected) or no longer fit the rows (`MoveConflict`). */
  onMoveError?: (move: MoveIntent, error: unknown) => void
  /**
   * The view's sort, grouping, search and filters arrange the top-level rows only: a top-level row
   * that matches brings its whole tree (folded as the user left it), the rows under each keep their
   * given order and travel with their top-level row into its group, and they stay draggable in every
   * view, within their parent or into another top-level row's tree. A move lands after the shown
   * row above it. Top-level rows themselves still drag only under the manual
   * sort, ungrouped and unfiltered, and in other views no row is lifted to the top level.
   */
  arrangeTop?: boolean
  /**
   * Which rows show their children. Given, folding is controlled and a row with children is open
   * only when listed here (rows start folded); omit it and the grid keeps its own folds, rows open.
   */
  expanded?: readonly string[]
  onExpandedChange?: (ids: string[]) => void
  /** Folded group keys, controlled (e.g. to keep them per browser). Omit and the grid keeps its own. */
  foldedGroups?: readonly string[]
  onFoldedGroupsChange?: (keys: string[]) => void
  /** How deep a move may nest: 0 = reorder only. Defaults to unlimited when `parentId` is given. */
  maxDepth?: number
  /** Whether `row` may sit under `parent` (null = the top level). Defaults to anywhere. */
  canNest?: (row: T, parent: T | null) => boolean
  /** Whether `row` may be moved at all (e.g. read-only rows). Defaults to every row. */
  canMove?: (row: T) => boolean

  /**
   * Layouts the host draws itself (a board, a timeline), by `view.layout` value: the bar stays the
   * grid's, and the renderer gets the rows the view keeps, filtered and sorted.
   */
  layouts?: Record<string, (rows: readonly T[]) => ReactNode>
  /** Keeps the name column in view while the list scrolls sideways. */
  freezeName?: boolean
  /** The cards layout's card. Defaults to the icon and name plus the visible columns. */
  renderCard?: (row: T) => ReactNode
  selectedId?: string | null
  /**
   * Opens the row: a click anywhere on it, and a real button named `openLabel` ("Open Sales") for
   * the keyboard and screen readers. Controls inside cells stay independent of it.
   */
  onOpen?: (row: T) => void
  /** The open button's name; defaults to "Open " and the row's label. */
  openLabel?: (row: T) => string
  /**
   * The trailing cell (list) or corner (cards): the row's "..." menu or hover actions. The host
   * passes only the actions this person may take.
   */
  rowActions?: (row: T) => ReactNode
  /** Content under a row across every column (at the foot of its card in the cards layout), or null,
   *  always shown (an inline editor, a note the row needs). The host owns any toggle. For details the reader opens, use `expandDetail`. */
  rowDetail?: (row: T) => ReactNode
  /**
   * Details the reader opens in place (a log entry's full error, a delivery's payload): the row
   * itself is the toggle, a click anywhere or its open button (`aria-expanded`, "Show details for
   * ..."); the grid keeps which rows are open. Return null for a row with nothing more to show (it
   * then does not open). Not with `onOpen`: a row either opens a page or expands.
   */
  expandDetail?: (row: T) => ReactNode
  /** In-place editing of one row at a time (see `DataGridEditing`). */
  editing?: DataGridEditing<T>
  /** Rows drawn quieter (archived, superseded); say why in a cell too (a badge). */
  muted?: (row: T) => boolean
  /** Per grouping key, the groups known before their rows (folders that may be empty), in order.
   *  Groups `groupOf` finds beyond them follow. Empty ones hide while the view narrows. */
  groupCatalog?: Readonly<Record<string, readonly DataGridGroup[]>>
  /** Read-only: no drag, no editing. Also on under an active `SettingsReadOnly`. Search, filters,
   *  folding, opening and copying stay. */
  readOnly?: boolean
  /** The first load: skeleton rows in place of the body. */
  loading?: boolean
  /** The load failed: a notice with the message, and Retry with `onRetry`. */
  error?: unknown
  onRetry?: () => void
  /** Under the rows, e.g. a quick-add line. */
  footer?: ReactNode
  empty?: ReactNode

  /** `card` / `section`: the heading at the left of the top bar. */
  title?: ReactNode
  /** `card` / `section`: the heading's level. Defaults to 3 for a card (it sits under a page section's
   *  h2) and 2 for a section; a card standing directly under the page's h1 passes 2. */
  headingLevel?: 2 | 3 | 4
  /** `card` / `section`: at the far end of the bar. */
  actions?: ReactNode
  /** `card`: cap before the rows scroll, px. Omitted, the card grows with its rows. */
  maxHeight?: number
  /** `card` / `section`: makes it fold behind its heading (controlled; the caller keeps the state). Shut,
   *  only the heading shows: the bar's controls work on rows that are not drawn. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** `section`: px the grid reaches past its section on both sides, the page's padding, so its rules
   *  run to the pane's edges; the heading and the cells stay where they were. */
  bleed?: number

  /** Where widths, totals and (uncontrolled) the view are kept, e.g. `box.planning.tasks`.
   *  Omitted, they last while the grid is mounted. */
  storageKey?: string
  /** The preset the totals are remembered under. */
  preset?: string | null
  /** The list layout's footer with the count and totals. Defaults to on. */
  totals?: boolean
  /** How many rows there are before the host's own narrowing (a preset, a mine-only switch), when
   *  `rows` is already narrowed: the count then reads "4 of 12". Defaults to `rows.length`. */
  total?: number
  /** "4 of 12 initiatives" by default. */
  countLabel?: (shown: number, total: number) => ReactNode
}

/** An `options` row value with nothing in it: the case `filterKeepsBlank` decides. */
const isBlank = (v: FilterRowValue): boolean => v == null || v === '' || (Array.isArray(v) && v.length === 0)

function compare(a: string | number | null, b: string | number | null, dir: 1 | -1): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * dir
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }) * dir
}

const toggled = (cur: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(cur)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

type GroupOf<T> = (row: T, key: string) => { key: string; label: ReactNode }

/** Items bucketed by `groupOf`, in first-seen order; null when the view is not grouped. */
function groupItems<T, I>(items: readonly I[], rowOf: (item: I) => T, groupOf: GroupOf<T> | undefined, by: string | null) {
  if (!groupOf || by === null) return null
  const out = new Map<string, { key: string; label: ReactNode; items: I[] }>()
  for (const item of items) {
    const g = groupOf(rowOf(item), by)
    const entry = out.get(g.key) ?? { key: g.key, label: g.label, items: [] }
    entry.items.push(item)
    out.set(g.key, entry)
  }
  return [...out.values()]
}

/** Each drawn node with the group of the top-level row it sits under (the last depth-0 row above it). */
function withGroups<T>(nodes: readonly TreeNode<T>[], groups: readonly { key: string; roots: ReadonlySet<string> }[]) {
  const groupOfRoot = new Map<string, string>()
  for (const g of groups) for (const id of g.roots) groupOfRoot.set(id, g.key)
  let group = groups[0]?.key ?? ''
  return nodes.map((node) => {
    if (node.depth === 0) group = groupOfRoot.get(node.id) ?? group
    return { node, group }
  })
}

/** A group as drawn: its key, title, plain name, own controls and drop ref, and its items. */
type Section<I> = { key: string; label: ReactNode; name: string; aside?: ReactNode; ref?: Ref<HTMLDivElement>; items: I[] }

/** A full grid's place on a settings canvas, as the list bar's was: 24px below what precedes it; the
 *  first piece tucks under the title bar; inside a group it reaches the pane's edges. */
const SETTINGS_SPACING: Record<NonNullable<ReturnType<typeof useCanvasMode>>, string> = {
  canvas: 'mt-6 first:-mt-2',
  panel: 'mt-6 first:-mt-5',
  flow: 'mt-6',
  group: '-mx-4 md:-mx-6',
}

/** A frozen name cell's background: the row's surface with its tint (hover, selected) on top. */
const FROZEN_ROW_SURFACE = 'linear-gradient(var(--row-tint), var(--row-tint)), var(--row-surface)'

/**
 * The one list component for rows with columns: filter, search, sort, group, nest, fold and drag,
 * with `BoardViewBar` above and `GridHeader` and `GridFooter` around the rows.
 * Use it for a collection that needs sorting, filtering or column choice, as a page (`variant='full'`),
 * a card on a detail page (`card`) or an unframed page section (`section`). On a settings canvas
 * (`SettingsPage`, a tab panel) a `card` or `section` brings the canvas gutter itself: no wrapper.
 * Every list of records, in Settings too (inside a `SettingsPane` a `full` grid adapts to the pane).
 * Not for a feed (`ActionListRow`), a board of stages (`BoardKanban`) or settings with controls
 * (`SettingsControlList`).
 * Controlled: `view` in, a patch out; it keeps only column widths and totals, under `storageKey`.
 * Rule: give it a React `key` per dataset, so moves still being written never carry over.
 */
export function DataGrid<T>(props: DataGridProps<T>) {
  const { variant = 'full', getId, name, icon, columns, presets, searchText, filterValue, sortValue, groupOf, groupCatalog } = props
  const { parentId, onMove, onMoveError, canNest, canMove, renderCard, selectedId, onOpen, rowActions, rowDetail, footer, empty, title, actions } = props
  const { maxHeight, open = true, onOpenChange, bleed = 0, storageKey, preset = null, filterKeepsBlank = false, arrangeTop = false, expanded, onExpandedChange, layouts, freezeName = false } = props
  const card = variant === 'card'
  // Card and section share the layout: heading and bar in one strip, the grid under it.
  const framed = variant !== 'full'
  const canvasMode = useCanvasMode()
  // A full grid on a settings canvas: the pane scrolls it, its bar and header stick under the title
  // bar, and its count goes to the pane's footer row.
  const inSettings = !framed && canvasMode !== null
  const readOnly = useContext(SettingsReadOnlyContext) || (props.readOnly ?? false)
  const editing = readOnly ? undefined : props.editing
  // The create row is drawn first and survives the view's search and filters.
  const draft = editing?.row
  const draftId = draft === undefined ? null : getId(draft)
  const rows = draft === undefined ? props.rows : [draft, ...props.rows]
  const onMoveLive = readOnly ? undefined : onMove
  const bar: BoardBarSpec = {
    searchPlaceholder: `Search ${props.bar.noun}`,
    layouts: [],
    groupBy: [],
    sort: [],
    fields: [],
    columnsNote: '',
    columns: [],
    ...props.bar,
  }
  const optionalKeys = columns.filter((c) => !c.fixed && !c.hidden).map((c) => c.key)
  const [ownView, setOwnView] = useListView(
    { search: '', layout: 'list', groupBy: 'none', sort: bar.sort[0]?.value, sortDir: bar.sort[0]?.defaultDir ?? 'asc', filters: {}, columns: optionalKeys, ...props.defaultView },
    { sort: bar.sort.map((o) => o.value), groupBy: bar.groupBy.map((o) => o.value), columns: columns.map((c) => c.key), layouts: bar.layouts.map((l) => l.value), filters: schemaOf(bar.fields) },
    storageKey && `${storageKey}.view`,
  )
  const view = props.view ?? ownView
  const onViewChange = props.view ? (props.onViewChange ?? (() => {})) : setOwnView
  const totals = props.totals ?? true
  // In Settings and wherever no layouts are offered, the column picker and layout toggle are off
  // unless the host turns them on.
  const controls: Partial<Record<BoardBarControl, boolean>> = {
    group: !framed,
    ...(searchText ? {} : { search: false }),
    ...(bar.layouts.length === 0 ? { layout: false } : {}),
    // No column picker in Settings or with nothing optional to pick.
    ...(canvasMode !== null || columns.every((c) => c.fixed) ? { columns: false } : {}),
    ...props.controls,
  }
  const maxDepth = parentId ? (props.maxDepth ?? Infinity) : 0
  const labelOf = (row: T): string => props.rowLabel?.(row) ?? searchText?.(row) ?? getId(row)
  const [openDetails, setOpenDetails] = useState<ReadonlySet<string>>(() => new Set())
  const toggleDetail = (id: string) => setOpenDetails((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const openLabel = (row: T): string => props.openLabel?.(row) ?? (props.expandDetail && !onOpen ? `${openDetails.has(getId(row)) ? 'Hide' : 'Show'} details for ${labelOf(row)}` : `Open ${labelOf(row)}`)

  const { widths, setWidth } = useColumnWidths(storageKey)
  const aggregates = useColumnAggregates(storageKey, preset)
  const [ownCollapsed, setOwnCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [ownFoldedGroups, setOwnFoldedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const foldedGroups: ReadonlySet<string> = props.foldedGroups ? new Set(props.foldedGroups) : ownFoldedGroups
  const toggleGroup = (key: string): void => {
    if (props.foldedGroups) props.onFoldedGroupsChange?.([...toggled(foldedGroups, key)])
    else setOwnFoldedGroups((cur) => toggled(cur, key))
  }
  const [announcement, setAnnouncement] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const moveHelpId = useId()

  // ---- the rows, with the moves still being written applied --------------------------------------
  // Every resolve (preview and write) re-checks the rules against the rows as they are then.
  const check: MoveCheck<T> = (intent, rs, at) => {
    const index = new Map(rs.map((r) => [at.id(r), r]))
    const row = index.get(intent.id)
    if (row === undefined || canMove?.(row) === false) return false
    const parent = intent.parentId === null ? null : (index.get(intent.parentId) ?? null)
    const depth = intent.parentId === null ? 0 : depthOf(rs, at, intent.parentId) + 1
    if (depth + subtreeHeight(childrenByParent(rs, at), at, intent.id) > maxDepth) return false
    return canNest?.(row, parent) ?? true
  }
  const moves = useMoveQueue<T>({
    rows,
    at: { id: getId, parentId: (r) => parentId?.(r) ?? null },
    check,
    write: onMoveLive,
    onError: (intent, error) => {
      const row = rows.find((r) => getId(r) === intent.id)
      setAnnouncement(`Could not move ${row ? labelOf(row) : 'the row'}.`)
      onMoveError?.(intent, error)
    },
  })
  const current = moves.rows
  const access = moves.at
  const byId = new Map(current.map((r) => [getId(r), r]))

  // ---- columns ----------------------------------------------------------------------------------
  // A page of its own (`full`, outside Settings) keeps every chosen column and scrolls sideways.
  // In a card, a section or a settings pane, narrower than its columns, the list drops priority 3,
  // then 2, from the end, by its own width (cards keep them all: each card stacks its columns).
  const dropsColumns = (framed || inSettings) && view.layout !== 'cards'
  const [avail, setAvail] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!dropsColumns || !el || !columns.some((c) => (c.priority ?? 1) > 1)) return
    const observer = new ResizeObserver(() => setAvail(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [columns, dropsColumns])
  const actionsWidth = props.editing ? 176 : rowActions ? 64 : 8
  const optional = columns.filter((c) => !c.fixed)
  let fit = [...columns.filter((c) => c.fixed), ...orderColumns(optional, view.columns)]
  if (dropsColumns && avail !== null) {
    // The same geometry `buildGrid` resolves: saved widths, the real action slot. A column with an
    // edit cell stays while a row edits in place.
    const need = (cs: readonly DataGridColumn<T>[]): number =>
      clampWidth(widths['__name'] ?? name.min ?? 260) + cs.reduce((n, c) => n + clampWidth(widths[c.key] ?? c.width) + COLUMN_GAP, 0) + actionsWidth + 2 * ROW_PAD
    const keep = (c: DataGridColumn<T>): boolean => (c.priority ?? 1) === 1 || (props.editing?.id != null && c.edit != null)
    for (const p of [3, 2])
      for (let i = fit.length - 1; i >= 0 && need(fit) > avail; i--) if (!keep(fit[i]!) && fit[i]!.priority === p) fit = fit.filter((_, j) => j !== i)
  }
  // A fixed leading column always leads; other fixed columns sit right after the name.
  const fixedLead = fit.filter((c) => c.fixed && c.leading)
  const fixed = fit.filter((c) => c.fixed && !c.leading)
  const shown = fit.filter((c) => !c.fixed)
  const visible = fit
  const leadCount = shown.findIndex((c) => !c.leading) === -1 ? shown.length : shown.findIndex((c) => !c.leading)
  const lead = [...fixedLead, ...shown.slice(0, leadCount)]
  const trailing = shown.slice(leadCount)
  // Frozen: the leading columns and the name.
  const freeze = freezeName ? lead.length + 1 : 0

  // ---- filter, sort, group ----------------------------------------------------------------------
  const q = view.search.trim().toLowerCase()
  const activeFields = bar.fields.filter((f) => isActive(f.type, view.filters[f.key]))
  const narrowed = q.length > 0 || activeFields.length > 0
  // While the view narrows, every group shows what matched in it.
  // ...and the group holding the create row or the row being edited stays open, so starting an edit
  // always shows its fields.
  const editedRow = draft ?? (editing?.id != null ? props.rows.find((r) => getId(r) === editing.id) : undefined)
  const isFolded = (key: string): boolean =>
    !narrowed && foldedGroups.has(key) && !(editedRow !== undefined && groupBy !== null && groupOf!(editedRow, groupBy).key === key)
  const keepsBlank = (axis: string): boolean => (typeof filterKeepsBlank === 'function' ? filterKeepsBlank(axis) : filterKeepsBlank)
  const filterCtx: FilterContext = { today: props.filterContext?.today ?? currentToday(), me: props.filterContext?.me ?? currentMe() }
  const matches = (row: T): boolean => {
    // The create row and the row being edited stay while the view narrows.
    if ((draftId !== null && getId(row) === draftId) || (editing?.id != null && getId(row) === editing.id)) return true
    if (q && searchText && !searchText(row).toLowerCase().includes(q)) return false
    if (filterValue)
      for (const f of activeFields) {
        const have = filterValue(row, f.key)
        if (f.type === 'options' && isBlank(have)) {
          if (!keepsBlank(f.key)) return false
        } else if (!matchFilter(f.type, view.filters[f.key], have, filterCtx)) return false
      }
    return true
  }
  const sortKey = view.sort && view.sort !== MANUAL_SORT ? view.sort : null
  const dir = view.sortDir === 'desc' ? -1 : 1
  // Hiding the group control keeps whatever grouping the view holds (a fixed grouping).
  const groupBy = view.groupBy !== 'none' && groupOf ? view.groupBy : null
  // Arranged by the top level only: sort and group order the top-level rows, everything else keeps
  // its given order (siblings read in input order, so only the top level's order changes).
  const topOnly = arrangeTop && !!parentId
  const byOrder = (a: T, b: T): number => {
    if (draftId !== null && (getId(a) === draftId || getId(b) === draftId)) return getId(a) === draftId ? -1 : 1
    return sortKey === null || !sortValue ? 0 : compare(sortValue(a, sortKey), sortValue(b, sortKey), dir)
  }
  let sorted: readonly T[] = current
  let treeGroups: { key: string; label: ReactNode; roots: Set<string> }[] | null = null
  if (topOnly) {
    // Search and filters narrow the top level too: a top-level row that does not match leaves with
    // everything under it; one that matches brings its whole tree.
    const tree = childrenByParent(current, access)
    const roots = treeRoots(current, access, tree)
    const gone = new Set<string>()
    const drop = (row: T): void => {
      const id = getId(row)
      if (gone.has(id)) return
      gone.add(id)
      for (const child of tree.get(id) ?? []) drop(child)
    }
    if (narrowed) for (const root of roots) if (!matches(root)) drop(root)
    const ordered = roots.filter((r) => !gone.has(getId(r))).sort(byOrder)
    const buckets = groupItems(ordered, (r) => r, groupOf, groupBy)
    treeGroups = buckets && buckets.map((g) => ({ key: g.key, label: g.label, roots: new Set(g.items.map(getId)) }))
    const rootIds = new Set(roots.map(getId))
    sorted = [...(buckets ? buckets.flatMap((g) => g.items) : ordered), ...current.filter((r) => !rootIds.has(getId(r)) && !gone.has(getId(r)))]
  } else if (sortKey !== null && sortValue) sorted = [...current].sort(byOrder)
  const kept = topOnly ? sorted : sorted.filter(matches)
  // Rows are matched one by one (and folds set aside so every match shows) unless the view narrows
  // the top level only.
  const matchRows = narrowed && !topOnly
  const nested = !!parentId && (groupBy === null || topOnly)
  // Every row may be dragged (top-level rows included) only in the plain view; with `arrangeTop`
  // the rows under the top level may be dragged in any view.
  const plain = sortKey === null && groupBy === null && !narrowed
  const canDrag = !!onMoveLive && (plain || topOnly)
  const draggableAt = (depth: number): boolean => plain || depth > 0

  // ---- folding ----------------------------------------------------------------------------------
  // A chevron folds one row; with Shift the whole subtree under it too. The header's chevron does
  // the same for the top level: plain folds or unfolds the top-level rows, Shift every row. While
  // searching or filtering, folds are set aside so every match shows; they return afterwards.
  const children = nested ? childrenByParent(sorted, access) : new Map<string, T[]>()
  const hasKids = (id: string): boolean => (children.get(id)?.length ?? 0) > 0
  const topParents = nested ? treeRoots(sorted, access, children).map(getId).filter(hasKids) : []
  // Controlled: every parent not listed as expanded is folded.
  const expandedSet = expanded ? new Set(expanded) : null
  const collapsed: ReadonlySet<string> = expandedSet ? new Set([...children.keys()].filter((id) => id !== '' && !expandedSet.has(id))) : ownCollapsed
  const anyOpen = topParents.some((id) => !collapsed.has(id))
  const glideNext = useGlide(listRef)
  const setFold = (ids: readonly string[], fold: boolean): void => {
    glideNext()
    if (expandedSet) {
      const next = new Set(expandedSet)
      for (const id of ids) {
        if (fold) next.delete(id)
        else next.add(id)
      }
      onExpandedChange?.([...next])
      return
    }
    setOwnCollapsed((cur) => {
      const next = new Set(cur)
      for (const id of ids) {
        if (fold) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }
  const foldRow = (id: string, deep: boolean): void => setFold(deep ? [id, ...parentsUnder(sorted, access, children, id)] : [id], !collapsed.has(id))
  const foldAll = (deep: boolean): void => setFold(deep ? parentsUnder(sorted, access, children, null) : topParents, anyOpen)

  // ---- moving -----------------------------------------------------------------------------------
  const commit = (id: string, p: Projection): void => {
    const row = byId.get(id)
    if (row === undefined) return
    const order = orderAfterMove(current, access, id, p.parentId, p.afterId)
    if (access.parentId(row) === p.parentId && order.join('\n') === current.map(getId).join('\n')) return
    // A row moved into a folded parent would vanish (and take keyboard focus with it): unfold it.
    if (p.parentId !== null && collapsed.has(p.parentId)) setFold([p.parentId], false)
    moves.enqueue({ id, parentId: p.parentId, afterId: p.afterId })
    const parent = p.parentId === null ? undefined : byId.get(p.parentId)
    const after = p.afterId === null ? undefined : byId.get(p.afterId)
    setAnnouncement(`Moved ${labelOf(row)} ${parent ? `into ${labelOf(parent)}` : 'to the top level'}, ${after ? `after ${labelOf(after)}` : 'first'}.`)
  }
  const drag = useTreeDrag<T>({
    flatten: (fold) => {
      if (!nested) return kept.map((row) => ({ row, id: getId(row), depth: 0, parentId: null, childCount: 0 }))
      const folds = matchRows ? new Set<string>() : collapsed
      const all = flattenTree(sorted, access, { collapsed: fold ? new Set([...folds, fold]) : folds, keep: matchRows ? matches : undefined })
      if (!treeGroups || foldedGroups.size === 0) return all
      // A folded group's rows are not drawn, so they are not in the list a drag measures either.
      return withGroups(all, treeGroups).filter((x) => !isFolded(x.group)).map((x) => x.node)
    },
    rules: (id) => ({
      maxDepth,
      carry: subtreeHeight(children, access, id),
      allows:
        canNest || !plain
          ? (parent) => {
              if (parent === null && !plain) return false
              const row = byId.get(id)
              return row === undefined || !canNest || canNest(row, parent === null ? null : (byId.get(parent) ?? null))
            }
          : undefined,
    }),
    enabled: canDrag,
    list: listRef,
    glideNext,
    onCommit: commit,
  })
  const { nodes, active } = drag
  // Groups the rows fall in, after the host's catalog for this grouping (its empty folders too,
  // unless the view narrows).
  const catalog = groupBy !== null ? (groupCatalog?.[groupBy] ?? null) : null
  const sectionsOf = <I,>(found: { key: string; label: ReactNode; items: I[] }[]): Section<I>[] => {
    const plain = (g: { key: string; label: ReactNode; items: I[] }): Section<I> => ({ ...g, name: typeof g.label === 'string' ? g.label : g.key })
    if (!catalog) return found.map(plain)
    const byKey = new Map(found.map((g) => [g.key, g]))
    const known = new Set(catalog.map((c) => c.key))
    return [
      ...catalog.flatMap((c) => {
        const items = byKey.get(c.key)?.items ?? []
        return items.length === 0 && narrowed ? [] : [{ ...c, items }]
      }),
      ...found.filter((g) => !known.has(g.key)).map(plain),
    ]
  }
  const flatGroups = treeGroups ? null : groupItems(nodes, (n) => n.row, groupOf, groupBy)
  const groups = flatGroups && sectionsOf(flatGroups)

  // ---- editing in place -------------------------------------------------------------------------
  const editingId = editing?.id ?? null
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  useEffect(() => {
    setEditError(null)
    if (editingId === null) return
    const row = rootRef.current?.querySelector(`[data-row="${CSS.escape(editingId)}"]`)
    row?.querySelector<HTMLElement>('input, textarea, select, [role="combobox"]')?.focus()
  }, [editingId])
  // A write in flight holds the grid: no other row opens and Escape does not cancel until it
  // settles, so its result always lands on the row that started it.
  const editingRef = useRef(editingId)
  editingRef.current = editingId
  const save = async (): Promise<void> => {
    if (!editing || saving || editing.canSave === false) return
    const started = editingId
    setSaving(true)
    setEditError(null)
    try {
      await editing.onSave()
    } catch (err) {
      if (editingRef.current === started) setEditError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  const editKeys = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (!saving) editing?.onCancel()
    } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
      e.preventDefault()
      void save()
    }
  }
  const editActions = editing && (
    <div className='flex items-center justify-end gap-2'>
      <Button variant='ghost' size='sm' onClick={editing.onCancel} disabled={saving}>
        Cancel
      </Button>
      <Button size='sm' onClick={() => void save()} disabled={saving || editing.canSave === false}>
        {saving ? 'Saving…' : (editing.saveLabel ?? 'Save')}
      </Button>
    </div>
  )

  // ---- layout -----------------------------------------------------------------------------------
  const grid = buildGrid(
    {
      name: {
        key: '__name',
        label: name.label,
        min: name.min ?? 260,
        labelClass: name.labelClass,
        // The label starts at the cell's edge; expand/collapse-all sits at the right end, over the
        // rows' own chevrons.
        trail: parentId ? (
          <span className='flex shrink-0 items-center justify-center' style={{ width: TOGGLE }}>
            {topParents.length > 0 && (
              <button
                type='button'
                aria-expanded={anyOpen}
                aria-label={anyOpen ? 'Collapse all' : 'Expand all'}
                title={`${anyOpen ? 'Collapse' : 'Expand'} all (Shift: every level)`}
                onClick={(e) => foldAll(e.shiftKey)}
                className='flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent-tint hover:text-text'>
                <ChevronRight className={cn('size-4 transition-transform', anyOpen && 'rotate-90')} />
              </button>
            )}
          </span>
        ) : undefined,
      },
      // A leading column's `width` is all the row space it takes: its track plus the gap after it,
      // and for the first the row's edge padding too, so the name starts right at the square's edge.
      // A leading column's track and the column gap after it hold its content box and the name
      // cell's GAP (see `leading`); the header icon centres over the box, where the track starts.
      leading: lead.map((c) => ({
        key: c.key,
        label: c.label,
        width: c.width + GAP - COLUMN_GAP,
        lead: c.icon != null && (
          <span title={c.hint ?? c.label} className='flex shrink-0 items-center justify-center' style={{ width: c.width }}>
            {c.icon}
          </span>
        ),
      })),
      fixed: fixed.map((c) => ({ key: c.key, label: c.label, width: c.width })),
      actions: actionsWidth,
    },
    trailing.map((c): ColumnDef => ({ key: c.key, label: c.label, width: `${c.width}px`, hint: c.hint, icon: c.icon })),
    widths,
  )
  const barSpec: BoardBarSpec = {
    ...bar,
    // Grouping always offers "None".
    groupBy: bar.groupBy.length === 0 || bar.groupBy.some((o) => o.value === 'none') ? bar.groupBy : [{ value: 'none', label: 'None' }, ...bar.groupBy],
    columns: optional.map((c) => ({ key: c.key, label: c.label })),
    columnsNote: props.bar.columnsNote ?? `${[name.label, ...fixed.map((c) => c.label)].join(', ')} always show.`,
  }
  const total = props.total ?? props.rows.length
  const shownCount = kept.length - (draftId === null ? 0 : 1)
  const word = (n: number): string => (n === 1 ? (props.bar.one ?? bar.noun.replace(/ies$/, 'y').replace(/s$/, '')) : bar.noun)
  const count = props.countLabel?.(shownCount, total) ?? (narrowed || shownCount < total ? `${shownCount} of ${total} ${word(total)}` : `${total} ${word(total)}`)
  const sources = aggregateSources(kept, shown.map((c) => c.key), shown.flatMap((c) => (c.agg ? [{ key: c.key, agg: c.agg }] : [])))
  const clear = (): void => onViewChange({ search: '', filters: {} })
  const none = (
    <div className='flex flex-wrap items-center justify-center gap-2 px-4 py-8 text-center text-body-sm text-muted-foreground'>
      {narrowed ? (
        <>
          No {bar.noun} match.
          <Button variant='ghost' size='sm' onClick={clear}>
            Clear search and filters
          </Button>
        </>
      ) : (
        (empty ?? `No ${bar.noun} yet.`)
      )}
    </div>
  )

  // ---- render -----------------------------------------------------------------------------------
  const groupRow = (g: { key: string; label: ReactNode; name: string; aside?: ReactNode; ref?: Ref<HTMLDivElement> }, n: number) => (
    <GroupRow key={`group:${g.key}`} open={!isFolded(g.key)} onToggle={() => toggleGroup(g.key)} name={g.name} title={g.label} count={n} aside={g.aside} ref={g.ref} columns={grid.columns.length + 1} />
  )

  const markOf = (row: T): boolean => icon?.(row) != null || (!!onMoveLive && canMove?.(row) !== false)
  // A child's mark sits under its parent's name. When no top-level row draws a mark slot, the
  // top-level names start at the cell's edge, so the first level starts there too: its mark's left
  // edge (an 8px mark centred in the slot) meets the parent's text, which the name pads by GAP.
  const rootsMarked = drag.drawn.some((n) => n.depth === 0 && markOf(n.row))
  const indentOf = (depth: number): number => (rootsMarked || depth === 0 ? depth * INDENT : (depth - 1) * INDENT + GAP - (MARK - 8) / 2)

  const renderRow = (n: TreeNode<T>) => {
    const mark = icon?.(n.row)
    const movable = !!onMoveLive && n.id !== draftId && canMove?.(n.row) !== false
    const isEditing = editingId === n.id
    const expandable = !onOpen && !isEditing && props.expandDetail ? props.expandDetail(n.row) : null
    const isOpenDetail = expandable != null && openDetails.has(n.id)
    const detail = isEditing ? null : (rowDetail?.(n.row) ?? (isOpenDetail ? expandable : null))
    return (
      <Row
        key={n.id}
        id={n.id}
        label={labelOf(n.row)}
        depth={active?.id === n.id ? active.projection.depth : n.depth}
        indentOf={indentOf}
        template={grid.template}
        nameCell={isEditing && name.edit ? name.edit(n.row) : name.render(n.row)}
        leadCells={lead.map((c, i) => (
          <span key={c.key} role='cell' className='flex h-full min-w-0 items-center' style={freeze ? frozenColumnStyle(grid.columns, i, freeze, FROZEN_ROW_SURFACE) : undefined}>
            {/* The content box starts where the track does and spans it and the gap after it, less
                the name cell's GAP, so the name starts GAP past it. */}
            <span className='flex h-full shrink-0 items-center justify-center' style={{ width: c.width }}>
              {isEditing && c.edit ? c.edit(n.row) : c.render(n.row)}
            </span>
          </span>
        ))}
        cells={[...fixed, ...trailing].map((c) => (
          <span key={c.key} role='cell' className={cn('relative min-w-0', c.icon != null && 'flex justify-center')}>
            {isEditing && c.edit ? c.edit(n.row) : c.render(n.row)}
          </span>
        ))}
        actions={isEditing ? editActions : rowActions?.(n.row)}
        nests={!!parentId}
        childCount={n.childCount}
        open={matchRows || !collapsed.has(n.id)}
        onToggle={(deep) => foldRow(n.id, deep)}
        handle={mark != null || movable}
        mark={mark}
        draggable={movable && canDrag && draggableAt(n.depth)}
        dragHint={movable && !(canDrag && draggableAt(n.depth)) ? DRAG_HINT : undefined}
        nameStyle={freeze ? frozenColumnStyle(grid.columns, lead.length, freeze, FROZEN_ROW_SURFACE) : undefined}
        onPress={() => drag.press(n.id)}
        onMoveKey={(key) => drag.keyMove(n.id, key)}
        moveHelpId={moveHelpId}
        drop={active?.id === n.id ? active.projection : null}
        target={active?.projection.parentId === n.id}
        selected={selectedId === n.id}
        onOpen={onOpen && !isEditing && !saving ? () => onOpen(n.row) : expandable != null ? () => toggleDetail(n.id) : undefined}
        openLabel={openLabel(n.row)}
        expanded={expandable != null ? isOpenDetail : undefined}
        tall={isEditing}
        after={isEditing ? editError && <p role='alert' className='text-body-sm text-danger'>{editError}</p> : detail}
        onKeyDown={isEditing ? editKeys : undefined}
        editing={isEditing}
        muted={props.muted?.(n.row) ?? false}
        span={grid.columns.length + 1}
      />
    )
  }

  // Grouped by the top level: one header per group (folded groups too), each followed by its
  // top-level rows and their subtrees as drawn, the dragged row included wherever it now lands.
  // The top-level rows the view shows: those that match, or hold something that does.
  const shownRoots = new Set(treeGroups ? treeRoots(sorted, access, children).map(getId) : [])
  const treeSections = (gs: NonNullable<typeof treeGroups>) => {
    const placed = withGroups(drag.drawn, gs)
    return gs.filter((g) => [...g.roots].some((id) => shownRoots.has(id))).map((g) => [
      groupRow({ key: g.key, label: g.label, name: typeof g.label === 'string' ? g.label : g.key }, [...g.roots].filter((id) => shownRoots.has(id)).length),
      ...(isFolded(g.key) ? [] : placed.filter((x) => x.group === g.key).map((x) => renderRow(x.node))),
    ])
  }

  const skeleton = (
    <div role='status' aria-busy='true'>
      <span className='sr-only'>Loading {bar.noun}</span>
      {['w-2/5', 'w-1/2', 'w-1/3'].map((w) => (
        <div key={w} aria-hidden='true' className={cn('flex h-12 items-center border-b border-border', GRID_PAD)}>
          <div className={cn('h-3 animate-pulse rounded bg-surface-hover', w)} />
        </div>
      ))}
    </div>
  )
  const settingsHost = useContext(SettingsBaseFooterContext)
  const publishes = inSettings && settingsHost !== null
  // In a settings pane the count sits in the pane's footer row; the grid's own footer then only
  // carries totals, when a column has them.
  // No count or totals over rows that did not load.
  const gridFooter = totals && !props.loading && props.error == null && !(publishes && !shown.some((c) => c.agg))
  usePublishFooter(
    publishes ? settingsHost : null,
    publishes ? (
      <footer role='status' className={cn('relative z-10 flex h-10 shrink-0 items-center gap-2 border-t border-border bg-surface text-label tabular-nums text-muted-foreground', GRID_PAD)}>
        {count}
      </footer>
    ) : null,
    [count, publishes],
  )

  // The table holds the header and the rows; the states, the host's footer and the totals footer
  // sit after it, outside the table's structure.
  const list = (
    <div
      style={{ minWidth: grid.minWidth + 2 * bleed, '--row-surface': card || inSettings ? 'var(--surface)' : 'var(--bg)' } as CSSProperties}
      className='flex min-h-full flex-col'>
      <div role='table' aria-label={typeof title === 'string' ? title : bar.noun} aria-busy={props.loading || undefined}>
        <GridHeader
          columns={grid.columns}
          template={grid.template}
          onResize={setWidth}
          freeze={freeze}
          className={cn((card || inSettings) && 'bg-surface', inSettings && 'top-[var(--list-top,0px)] z-[5]')}
        />
        {props.loading || props.error != null ? null : groups ? (
          <div role='rowgroup'>{groups.map((g) => [groupRow(g, g.items.length), ...(isFolded(g.key) ? [] : g.items.map(renderRow))])}</div>
        ) : (
          <DndContext {...drag.dnd}>
            <div ref={listRef} role='rowgroup' className={cn(active && 'cursor-grabbing select-none [&_[data-row]]:pointer-events-none')}>
              {treeGroups ? treeSections(treeGroups) : drag.drawn.map(renderRow)}
            </div>
          </DndContext>
        )}
      </div>
      {props.loading ? skeleton : props.error != null && <SettingsError error={props.error} onRetry={props.onRetry} />}
      {!props.loading && props.error == null && nodes.length === 0 && !(groups && groups.length > 0) && none}
      {footer}
      {gridFooter && (
        <GridFooter
          columns={grid.columns}
          template={grid.template}
          freeze={freeze}
          label={count}
          sources={sources}
          store={aggregates}
          // A section has no frame to raise the footer on: it stays on the page.
          surface={variant === 'section' ? 'var(--bg)' : inSettings ? 'var(--surface)' : undefined}
        />
      )}
    </div>
  )

  const renderTile = (row: T) => {
    const id = getId(row)
    return (
      <div
        key={id}
        onClick={onOpen ? (e) => ownClick(e) && onOpen(row) : undefined}
        className={cn(
          'group relative flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-body-sm shadow-(--shadow-sm) transition-colors',
          onOpen && 'cursor-pointer hover:border-accent/40',
          onOpen && 'has-[>button[data-row-open]:focus-visible]:border-accent has-[>button[data-row-open]:focus-visible]:ring-2 has-[>button[data-row-open]:focus-visible]:ring-accent/50',
          selectedId === id && 'border-accent/60 bg-accent-tint/30',
        )}>
        {/* The tile opens through a stretched, click-through button rather than being a button itself:
            a tile holds the row's own controls (actions, links), and a button may not contain them.
            The tile takes the pointer click; the button is the keyboard and screen-reader way in. */}
        {onOpen && (
          <button
            type='button'
            data-row-open=''
            aria-label={openLabel(row)}
            aria-current={selectedId === id || undefined}
            onClick={(e) => {
              e.stopPropagation()
              onOpen(row)
            }}
            className='pointer-events-none absolute inset-0 rounded-[inherit] outline-none'
          />
        )}
        {renderCard ? (
          renderCard(row)
        ) : (
          <>
            <div className='flex min-w-0 items-center gap-2 font-medium text-text'>
              {icon?.(row)}
              <div className='min-w-0 flex-1'>{name.render(row)}</div>
            </div>
            {/* The value track may shrink below its content, so a long value truncates inside the card. */}
            <dl className='grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1'>
              {visible.map((c) => (
                <div key={c.key} className='contents'>
                  <dt className='text-label text-muted-foreground'>{c.label}</dt>
                  <dd className='flex min-w-0'>{c.render(row)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        {rowDetail?.(row) != null && <div className='border-t border-border pt-2'>{rowDetail(row)}</div>}
        {rowActions && (
          <div className='absolute top-2 right-2 flex items-center gap-0.5' onClick={(e) => e.stopPropagation()}>
            {rowActions(row)}
          </div>
        )}
      </div>
    )
  }
  const tiles = (items: readonly T[]) => <div className='grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 p-3'>{items.map(renderTile)}</div>
  const tileFound = groupItems(kept, (row) => row, groupOf, groupBy)
  const tileGroups = tileFound && sectionsOf(tileFound)
  const cards = (
    <div className='flex min-h-full flex-col'>
      {tileGroups
        ? tileGroups.map((g) => [groupRow(g, g.items.length), ...(isFolded(g.key) || g.items.length === 0 ? [] : [<div key={`tiles:${g.key}`}>{tiles(g.items)}</div>])])
        : kept.length > 0 && tiles(kept)}
      {kept.length === 0 && none}
      {footer}
    </div>
  )

  const isCards = view.layout === 'cards'
  const own = layouts?.[view.layout]
  // Loading and a failed read look the same in every layout: the list's skeleton or error with Retry.
  const body = props.loading || props.error != null ? list : own ? own(kept) : isCards ? cards : list
  // A leading column switched on in the picker goes to the front (its home); moved later, it stays.
  const onBarChange = (patch: Partial<BoardBarValue>): void => {
    if (!patch.columns) return onViewChange(patch)
    const added = new Set(patch.columns.filter((k) => !view.columns.includes(k) && optional.some((c) => c.key === k && c.leading)))
    onViewChange(added.size === 0 ? patch : { ...patch, columns: [...patch.columns.filter((k) => added.has(k)), ...patch.columns.filter((k) => !added.has(k))] })
  }
  const on = (c: BoardBarControl): boolean => controls[c] !== false
  // A bar with nothing to offer is not drawn (a short log, a list under its own toolbar).
  const barEmpty = !presets && !actions && !bar.notice && !(on('search') && searchText) && !(on('sort') && bar.sort.length > 0) && !(on('filters') && bar.fields.length > 0) && !(on('group') && bar.groupBy.length > 0) && !(on('layout') && bar.layouts.length > 0) && !(on('columns') && optional.length > 0)
  const barEl = barEmpty ? null : (
    <BoardViewBar
      value={view}
      onChange={onBarChange}
      spec={barSpec}
      presets={presets}
      controls={controls}
      pins
      today={filterCtx.today}
      dense={framed}
      settings={inSettings}
      trailing={framed || inSettings ? actions : undefined}
    />
  )
  const a11y = (
    <>
      <span id={moveHelpId} hidden>
        {parentId ? 'Arrow up and down move the row. Arrow right nests it under the row above, arrow left lifts it out.' : 'Arrow up and down move the row.'}
      </span>
      <div role='status' aria-live='polite' className='sr-only'>
        {announcement}
      </div>
    </>
  )

  // The settings frame: the pane scrolls the grid; the bar sticks under the title bar and the column
  // header under the bar (`--list-top`, measured on this grid only).
  const barRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = barRef.current
    const root = rootRef.current
    if (!inSettings || !el || !root) return
    const set = () => root.style.setProperty('--list-top', `${el.offsetHeight}px`)
    set()
    const observer = new ResizeObserver(set)
    observer.observe(el)
    return () => observer.disconnect()
  }, [inSettings])
  if (inSettings)
    return (
      <div ref={rootRef} className={cn('relative', SETTINGS_SPACING[canvasMode ?? 'flow'])}>
        <div ref={barRef} data-settings-lead='' data-settings-listbar='' className='sticky top-0 z-[6]'>
          {barEl}
        </div>
        {body}
        {a11y}
      </div>
    )

  // Card: heading strip, body text size. Section: a document heading (as CRM's account sections),
  // the controls kept in place while shut (hidden) so the heading does not move on fold.
  const Heading = (`h${props.headingLevel ?? (card ? 3 : 2)}`) as 'h2' | 'h3' | 'h4'
  const heading = (
    <Heading className='contents'>
      {onOpenChange ? (
        // The whole heading is the fold's hit target, as in `CollapsibleSection`.
        <button
          type='button'
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className={cn(
            '-ml-1 flex items-center gap-1.5 rounded px-1 py-0.5 font-semibold whitespace-nowrap text-text transition-colors hover:text-accent',
            card ? 'text-body' : 'text-heading-3',
          )}>
          <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
          {title}
        </button>
      ) : (
        <span className={cn('font-semibold whitespace-nowrap text-text', card ? 'text-body' : 'text-heading-3')}>{title}</span>
      )}
    </Heading>
  )
  if (framed) {
    const framedEl = (
      <section
        ref={rootRef}
        className={cn('flex flex-col', card && 'overflow-hidden rounded-lg border border-border bg-surface shadow-(--shadow-sm)')}
        style={bleed ? ({ marginInline: -bleed, '--grid-pad': `${bleed + ROW_PAD}px` } as CSSProperties) : undefined}>
        {/* The heading left, the bar's controls right; the count is in the footer, as on a page. */}
        <header
          className={cn(
            'flex flex-wrap items-center gap-x-3 gap-y-2',
            card ? cn('min-h-12 px-3 py-2', open && 'border-b border-border') : open && 'mb-3',
          )}
          style={bleed ? { paddingInline: bleed } : undefined}>
          {title && heading}
          {(open || !card) && (
            <div className='ml-auto min-w-fit' style={open ? undefined : { visibility: 'hidden' }}>
              {barEl}
            </div>
          )}
        </header>
        {open && (
          <div className='min-h-0 overflow-auto' style={maxHeight ? { maxHeight } : undefined}>
            {body}
          </div>
        )}
        {a11y}
      </section>
    )
    // Standing on a settings canvas, a card or section brings the canvas gutter and rhythm like every
    // other canvas piece, so the section around it writes no padding of its own.
    // Inside a settings group (which applied the gutter) a section reaches the pane's edges, like a list.
    if (canvasMode === 'group' && !card) return <div className={SETTINGS_SPACING.group}>{framedEl}</div>
    return onCanvas(canvasMode) ? <div className={cn(SETTINGS_GUTTER, blockSpacing(canvasMode), 'pb-6')}>{framedEl}</div> : framedEl
  }

  return (
    <div ref={rootRef} className='flex h-full min-h-0 flex-col'>
      {barEl}
      <div className='min-h-0 flex-1 overflow-auto'>{body}</div>
      {a11y}
    </div>
  )
}
