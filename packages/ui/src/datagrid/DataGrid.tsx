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
// value it has on a filter axis, what to sort and group it by, who its parent is, where it may go.
// The component does the mechanics (filter, sort, group, nest, fold, move) so every host does them
// the same way. Drag lives in `useTreeDrag`, pending moves in `moves.ts`, the row in `Row`, the
// pure tree in `tree.ts`.
//
// One grid instance shows one dataset: give it a React `key` per dataset (e.g. the initiative id),
// so moves still being written for one never carry over to another.

import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { DndContext } from '@dnd-kit/core'
import { ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { BoardViewBar, type BoardBarControl, type BoardBarSpec, type BoardBarValue } from '../board/BoardViewBar.tsx'
import { GridHeader } from '../grid/GridHeader.tsx'
import { GridFooter } from '../grid/GridFooter.tsx'
import { aggregateSources, buildGrid, frozenColumnStyle, orderColumns, useColumnAggregates, useColumnWidths, type Aggregatable, type ColumnDef } from '../grid/columns.ts'
import { COLUMN_GAP, GAP, INDENT, MARK, ROW_PAD, TOGGLE } from './geometry.ts'
import { useMoveQueue, type Move, type MoveCheck, type MoveIntent } from './moves.ts'
import { Row } from './Row.tsx'
import { childrenByParent, depthOf, flattenTree, orderAfterMove, parentsUnder, subtreeHeight, treeRoots, type Projection, type TreeNode } from './tree.ts'
import { useGlide } from './useGlide.ts'
import { useTreeDrag } from './useTreeDrag.ts'

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
   * track.
   */
  leading?: boolean
  /** The header's icon in place of the label (the label becomes its tooltip), centred over the cells. */
  icon?: ReactNode
  render: (row: T) => ReactNode
  /** Makes the column totalable in the footer. */
  agg?: Aggregatable<T>
}

/** A move to write: the row, its new parent, the sibling it follows, and the whole order after it. */
export type DataGridMove = Move

export interface DataGridProps<T> {
  variant?: DataGridVariant
  rows: readonly T[]
  getId: (row: T) => string
  /**
   * The identity column: it flexes and holds the indentation, the fold chevron and the mark. With
   * `onRowClick` the name is the row's open button, so `render` must not be interactive itself.
   */
  /** `labelClass` lines the header label up with how `render` pads its text. */
  name: { label: string; min?: number; labelClass?: string; render: (row: T) => ReactNode }
  /** A small icon before the name (about 10-14px), e.g. a kind. It doubles as the drag handle. */
  icon?: (row: T) => ReactNode
  /** The row in words, for control labels and move announcements. Defaults to `searchText`. */
  rowLabel?: (row: T) => string
  columns: readonly DataGridColumn<T>[]

  /** View state, controlled. `columns` lists the optional columns that are on, in render order. */
  view: BoardBarValue
  onViewChange: (patch: Partial<BoardBarValue>) => void
  /** The bar's vocabulary; its `columns` and `columnsNote` default from `columns`. */
  bar: Omit<BoardBarSpec, 'columns' | 'columnsNote'> & Partial<Pick<BoardBarSpec, 'columnsNote'>>
  /** Which bar controls draw. Defaults: everything on `full`; no grouping on `card`. */
  controls?: Partial<Record<BoardBarControl, boolean>>
  /** The preset control, drawn first in the bar (`full` only unless the host passes it to a card). */
  presets?: ReactNode

  /** The text a search matches against. Omit and search is not offered. */
  searchText?: (row: T) => string
  /** A row's value(s) on a filter axis (`bar.sections[].key`). */
  filterValue?: (row: T, axis: string) => string | readonly string[] | null
  /**
   * Whether a row with no value on a filtered axis still shows (an axis that does not apply to it).
   * Defaults to true. Pass false, or decide per axis, where a blank is a value of its own (e.g.
   * "unassigned": give it an option value instead and return that from `filterValue`).
   */
  filterKeepsBlank?: boolean | ((axis: string) => boolean)
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
  onRowClick?: (row: T) => void
  /** The trailing cell (list) or corner (cards): hover actions. */
  rowActions?: (row: T) => ReactNode
  /** Under the rows, e.g. a quick-add line. */
  footer?: ReactNode
  empty?: ReactNode

  /** `card` / `section`: the heading at the left of the top bar. */
  title?: ReactNode
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

  /** Where widths and totals are kept, e.g. `box.planning.tasks`. */
  storageKey: string
  /** The preset the totals are remembered under. */
  preset?: string | null
  /** The list layout's footer with the count and totals. Defaults to on. */
  totals?: boolean
  /** "4 / 12 initiatives" by default. */
  countLabel?: (shown: number, total: number) => ReactNode
}

const asList = (v: string | readonly string[] | null): readonly string[] => (v == null ? [] : typeof v === 'string' ? [v] : v)

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

/** A frozen name cell's background: the row's surface with its tint (hover, selected) on top. */
const FROZEN_ROW_SURFACE = 'linear-gradient(var(--row-tint), var(--row-tint)), var(--row-surface)'

export function DataGrid<T>(props: DataGridProps<T>) {
  const { variant = 'full', rows, getId, name, icon, columns, view, onViewChange, bar, presets, searchText, filterValue, sortValue, groupOf } = props
  const { parentId, onMove, onMoveError, canNest, canMove, renderCard, selectedId, onRowClick, rowActions, footer, empty, title, actions } = props
  const { maxHeight, open = true, onOpenChange, bleed = 0, storageKey, preset = null, filterKeepsBlank = true, arrangeTop = false, expanded, onExpandedChange, layouts, freezeName = false } = props
  const card = variant === 'card'
  // Card and section share the layout: heading and bar in one strip, the grid under it.
  const framed = variant !== 'full'
  const totals = props.totals ?? true
  const controls: Partial<Record<BoardBarControl, boolean>> = { group: !framed, ...(searchText ? {} : { search: false }), ...props.controls }
  const maxDepth = parentId ? (props.maxDepth ?? Infinity) : 0
  const labelOf = (row: T): string => props.rowLabel?.(row) ?? searchText?.(row) ?? getId(row)

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
    write: onMove,
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
  const fixed = columns.filter((c) => c.fixed)
  const optional = columns.filter((c) => !c.fixed)
  const shown = orderColumns(optional, view.columns)
  const visible = [...fixed, ...shown]
  const leadCount = shown.findIndex((c) => !c.leading) === -1 ? shown.length : shown.findIndex((c) => !c.leading)
  const lead = shown.slice(0, leadCount)
  const trailing = shown.slice(leadCount)
  // Frozen: the leading columns and the name.
  const freeze = freezeName ? leadCount + 1 : 0

  // ---- filter, sort, group ----------------------------------------------------------------------
  const q = view.search.trim().toLowerCase()
  const axes = Object.entries(view.filters as Record<string, string[]>).filter(([, v]) => v.length > 0)
  const narrowed = q.length > 0 || axes.length > 0
  const keepsBlank = (axis: string): boolean => (typeof filterKeepsBlank === 'function' ? filterKeepsBlank(axis) : filterKeepsBlank)
  const matches = (row: T): boolean => {
    if (q && searchText && !searchText(row).toLowerCase().includes(q)) return false
    for (const [axis, wanted] of axes) {
      const have = asList(filterValue?.(row, axis) ?? null)
      if (have.length === 0 ? !keepsBlank(axis) : !have.some((v) => wanted.includes(v))) return false
    }
    return true
  }
  const sortKey = view.sort && view.sort !== MANUAL_SORT ? view.sort : null
  const dir = view.sortDir === 'desc' ? -1 : 1
  const groupBy = view.groupBy !== 'none' && groupOf && controls.group !== false ? view.groupBy : null
  // Arranged by the top level only: sort and group order the top-level rows, everything else keeps
  // its given order (siblings read in input order, so only the top level's order changes).
  const topOnly = arrangeTop && !!parentId
  const byOrder = (a: T, b: T): number => (sortKey === null || !sortValue ? 0 : compare(sortValue(a, sortKey), sortValue(b, sortKey), dir))
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
  const canDrag = !!onMove && (plain || topOnly)
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
      return withGroups(all, treeGroups).filter((x) => !foldedGroups.has(x.group)).map((x) => x.node)
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
  const groups = treeGroups ? null : groupItems(nodes, (n) => n.row, groupOf, groupBy)

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
          <span className='-my-1 flex shrink-0 items-center justify-center' style={{ width: TOGGLE }}>
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
      actions: rowActions ? 64 : 8,
    },
    trailing.map((c): ColumnDef => ({ key: c.key, label: c.label, width: `${c.width}px`, hint: c.hint, icon: c.icon })),
    widths,
  )
  const barSpec: BoardBarSpec = {
    ...bar,
    columns: optional.map((c) => ({ key: c.key, label: c.label })),
    columnsNote: bar.columnsNote ?? `${[name.label, ...fixed.map((c) => c.label)].join(', ')} always show.`,
  }
  const count = props.countLabel?.(kept.length, rows.length) ?? (narrowed ? `${kept.length} / ${rows.length} ${bar.noun}` : `${rows.length} ${bar.noun}`)
  const sources = aggregateSources(kept, shown.map((c) => c.key), shown.flatMap((c) => (c.agg ? [{ key: c.key, agg: c.agg }] : [])))
  const none = <div className='px-4 py-8 text-center text-body-sm text-muted-foreground'>{narrowed ? `No ${bar.noun} match.` : (empty ?? `No ${bar.noun} yet.`)}</div>

  // ---- render -----------------------------------------------------------------------------------
  const groupSection = (key: string, label: ReactNode, count: number, body: ReactNode) => {
    const folded = foldedGroups.has(key)
    return (
      <div key={key}>
        <button
          type='button'
          onClick={() => toggleGroup(key)}
          aria-expanded={!folded}
          style={{ gap: GAP }}
          className='flex w-full items-center border-b border-border bg-surface-2/60 px-[var(--grid-pad,0.5rem)] py-1.5 text-left text-body-sm font-medium text-text hover:bg-surface-2'>
          <span className='flex shrink-0 justify-center' style={{ width: MARK }}>
            <ChevronRight className={cn('size-3.5 text-muted-foreground transition-transform', !folded && 'rotate-90')} />
          </span>
          {label}
          <span className='text-label tabular-nums text-muted-foreground'>{count}</span>
        </button>
        {!folded && body}
      </div>
    )
  }

  const markOf = (row: T): boolean => icon?.(row) != null || (!!onMove && canMove?.(row) !== false)
  // A child's mark sits under its parent's name. When no top-level row draws a mark slot, the
  // top-level names start at the cell's edge, so the first level starts there too: its mark's left
  // edge (an 8px mark centred in the slot) meets the parent's text, which the name pads by GAP.
  const rootsMarked = drag.drawn.some((n) => n.depth === 0 && markOf(n.row))
  const indentOf = (depth: number): number => (rootsMarked || depth === 0 ? depth * INDENT : (depth - 1) * INDENT + GAP - (MARK - 8) / 2)

  const renderRow = (n: TreeNode<T>) => {
    const mark = icon?.(n.row)
    const movable = !!onMove && canMove?.(n.row) !== false
    return (
      <Row
        key={n.id}
        id={n.id}
        label={labelOf(n.row)}
        depth={active?.id === n.id ? active.projection.depth : n.depth}
        indentOf={indentOf}
        template={grid.template}
        nameCell={name.render(n.row)}
        leadCells={lead.map((c, i) => (
          <span key={c.key} className='flex h-full min-w-0 items-center' style={freeze ? frozenColumnStyle(grid.columns, i, freeze, FROZEN_ROW_SURFACE) : undefined}>
            {/* The content box starts where the track does and spans it and the gap after it, less
                the name cell's GAP, so the name starts GAP past it. */}
            <span className='flex h-full shrink-0 items-center justify-center' style={{ width: c.width }}>
              {c.render(n.row)}
            </span>
          </span>
        ))}
        cells={[...fixed, ...trailing].map((c) => (
          <span key={c.key} className={cn('min-w-0', c.icon != null && 'flex justify-center')}>
            {c.render(n.row)}
          </span>
        ))}
        actions={rowActions?.(n.row)}
        nests={!!parentId}
        childCount={n.childCount}
        open={matchRows || !collapsed.has(n.id)}
        onToggle={(deep) => foldRow(n.id, deep)}
        handle={mark != null || movable}
        mark={mark}
        draggable={movable && canDrag && draggableAt(n.depth)}
        dragHint={movable && !(canDrag && draggableAt(n.depth)) ? DRAG_HINT : undefined}
        nameStyle={freeze ? frozenColumnStyle(grid.columns, leadCount, freeze, FROZEN_ROW_SURFACE) : undefined}
        onPress={() => drag.press(n.id)}
        onMoveKey={(key) => drag.keyMove(n.id, key)}
        moveHelpId={moveHelpId}
        drop={active?.id === n.id ? active.projection : null}
        target={active?.projection.parentId === n.id}
        selected={selectedId === n.id}
        onClick={onRowClick ? () => onRowClick(n.row) : undefined}
      />
    )
  }

  // Grouped by the top level: one header per group (folded groups too), each followed by its
  // top-level rows and their subtrees as drawn, the dragged row included wherever it now lands.
  // The top-level rows the view shows: those that match, or hold something that does.
  const shownRoots = new Set(treeGroups ? treeRoots(sorted, access, children).map(getId) : [])
  const treeSections = (gs: NonNullable<typeof treeGroups>) => {
    const placed = withGroups(drag.drawn, gs)
    return gs.filter((g) => [...g.roots].some((id) => shownRoots.has(id))).map((g) => {
      const folded = foldedGroups.has(g.key)
      return [
        <button
          key={`group:${g.key}`}
          type='button'
          onClick={() => toggleGroup(g.key)}
          aria-expanded={!folded}
          style={{ gap: GAP }}
          className='flex w-full items-center border-b border-border bg-surface-2/60 px-[var(--grid-pad,0.5rem)] py-1.5 text-left text-body-sm font-medium text-text hover:bg-surface-2'>
          <span className='flex shrink-0 justify-center' style={{ width: MARK }}>
            <ChevronRight className={cn('size-3.5 text-muted-foreground transition-transform', !folded && 'rotate-90')} />
          </span>
          {g.label}
          <span className='text-label tabular-nums text-muted-foreground'>{[...g.roots].filter((id) => shownRoots.has(id)).length}</span>
        </button>,
        ...(folded ? [] : placed.filter((x) => x.group === g.key).map((x) => renderRow(x.node))),
      ]
    })
  }

  const list = (
    <div style={{ minWidth: grid.minWidth + 2 * bleed, '--row-surface': card ? 'var(--surface)' : 'var(--bg)' } as CSSProperties} className='flex min-h-full flex-col'>
      <GridHeader columns={grid.columns} template={grid.template} onResize={setWidth} freeze={freeze} className={card ? 'bg-surface' : undefined} />
      {groups ? (
        groups.map((g) => groupSection(g.key, g.label, g.items.length, g.items.map(renderRow)))
      ) : (
        <DndContext {...drag.dnd}>
          <div ref={listRef} className={cn(active && 'cursor-grabbing select-none [&_[data-row]]:pointer-events-none')}>
            {treeGroups ? treeSections(treeGroups) : drag.drawn.map(renderRow)}
          </div>
        </DndContext>
      )}
      {nodes.length === 0 && none}
      {footer}
      {totals && (
        <GridFooter
          columns={grid.columns}
          template={grid.template}
          freeze={freeze}
          label={count}
          sources={sources}
          store={aggregates}
          // A section has no frame to raise the footer on: it stays on the page.
          surface={variant === 'section' ? 'var(--bg)' : undefined}
        />
      )}
    </div>
  )

  const renderTile = (row: T) => {
    const id = getId(row)
    return (
      <div
        key={id}
        role={onRowClick ? 'button' : undefined}
        tabIndex={onRowClick ? 0 : undefined}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
        onKeyDown={
          onRowClick
            ? (e) => {
                if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
                e.preventDefault()
                onRowClick(row)
              }
            : undefined
        }
        className={cn(
          'group relative flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-body-sm shadow-(--shadow-sm) transition-colors',
          onRowClick && 'cursor-pointer hover:border-accent/40',
          selectedId === id && 'border-accent/60 bg-accent-tint/30',
        )}>
        {renderCard ? (
          renderCard(row)
        ) : (
          <>
            <div className='flex min-w-0 items-center gap-2 font-medium text-text'>
              {icon?.(row)}
              <div className='min-w-0 flex-1'>{name.render(row)}</div>
            </div>
            <dl className='grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1'>
              {visible.map((c) => (
                <div key={c.key} className='contents'>
                  <dt className='text-label text-muted-foreground'>{c.label}</dt>
                  <dd className='min-w-0'>{c.render(row)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
        {rowActions && (
          <div className='absolute top-2 right-2 flex items-center gap-0.5' onClick={(e) => e.stopPropagation()}>
            {rowActions(row)}
          </div>
        )}
      </div>
    )
  }
  const tiles = (items: readonly T[]) => <div className='grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3 p-3'>{items.map(renderTile)}</div>
  const tileGroups = groupItems(kept, (row) => row, groupOf, groupBy)
  const cards = (
    <div className='flex min-h-full flex-col'>
      {tileGroups ? tileGroups.map((g) => groupSection(g.key, g.label, g.items.length, tiles(g.items))) : kept.length > 0 && tiles(kept)}
      {kept.length === 0 && none}
      {footer}
    </div>
  )

  const isCards = view.layout === 'cards'
  const own = layouts?.[view.layout]
  const body = own ? own(kept) : isCards ? cards : list
  // A leading column switched on in the picker goes to the front (its home); moved later, it stays.
  const onBarChange = (patch: Partial<BoardBarValue>): void => {
    if (!patch.columns) return onViewChange(patch)
    const added = new Set(patch.columns.filter((k) => !view.columns.includes(k) && optional.some((c) => c.key === k && c.leading)))
    onViewChange(added.size === 0 ? patch : { ...patch, columns: [...patch.columns.filter((k) => added.has(k)), ...patch.columns.filter((k) => !added.has(k))] })
  }
  const barEl = <BoardViewBar value={view} onChange={onBarChange} spec={barSpec} presets={presets} controls={controls} dense={framed} trailing={framed ? actions : undefined} />
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

  // Card: heading strip, body text size. Section: a document heading (as CRM's account sections),
  // the controls kept in place while shut (hidden) so the heading does not move on fold.
  const Heading = card ? 'h3' : 'h2'
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
  if (framed)
    return (
      <section
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

  return (
    <div className='flex h-full min-h-0 flex-col'>
      {barEl}
      <div className='min-h-0 flex-1 overflow-auto'>{body}</div>
      {a11y}
    </div>
  )
}
