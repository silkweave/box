// Rows that nest, as pure functions. A row names its parent; siblings read in the order the caller
// hands them over (or in the sort's order). The list is drawn FLAT with an indentation per depth,
// which is what lets one list carry a whole tree: while a row is dragged its subtree folds away and
// travels with it, the vertical travel picks a slot among the other rows, and the horizontal travel
// picks the depth it lands at in whole steps, clamped to what the rows around the slot allow.
//
// Every row is always placed. A row whose parent is missing reads as top level, and rows caught in a
// parent cycle are placed at the top level where the cycle is first met, so a stored order written
// from `orderAfterMove` never loses a row to bad data.

export interface TreeNode<T> {
  row: T
  id: string
  depth: number
  /** The parent as the tree reads it: null at the top, and for a row whose parent is not in the list. */
  parentId: string | null
  childCount: number
}

export interface TreeAccess<T> {
  id: (row: T) => string
  parentId: (row: T) => string | null
}

/** Children per parent id ('' = top level), in input order. An unknown parent reads as top level. */
export function childrenByParent<T>(rows: readonly T[], at: TreeAccess<T>): Map<string, T[]> {
  const ids = new Set(rows.map(at.id))
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const p = at.parentId(row)
    const key = p && p !== at.id(row) && ids.has(p) ? p : ''
    const list = map.get(key) ?? []
    list.push(row)
    map.set(key, list)
  }
  return map
}

/**
 * Where walks start: the top-level rows, then (in input order) any row a walk from the top level
 * never reaches, which only a parent cycle produces. These are the rows drawn at depth 0.
 */
export function treeRoots<T>(rows: readonly T[], at: TreeAccess<T>, children: Map<string, T[]>): T[] {
  const reached = new Set<string>()
  const mark = (row: T): void => {
    const id = at.id(row)
    if (reached.has(id)) return
    reached.add(id)
    for (const child of children.get(id) ?? []) mark(child)
  }
  const out: T[] = []
  for (const row of [...(children.get('') ?? []), ...rows]) {
    if (reached.has(at.id(row))) continue
    out.push(row)
    mark(row)
  }
  return out
}

/** Visits every row at most once, depth-first, parents first; `visit` returns whether to descend. */
function walk<T>(rows: readonly T[], at: TreeAccess<T>, children: Map<string, T[]>, visit: (row: T, id: string, depth: number, parentKey: string) => boolean): void {
  const seen = new Set<string>()
  const go = (row: T, depth: number, parentKey: string): void => {
    const id = at.id(row)
    if (seen.has(id)) return
    seen.add(id)
    if (!visit(row, id, depth, parentKey)) return
    for (const child of children.get(id) ?? []) go(child, depth + 1, id)
  }
  for (const row of treeRoots(rows, at, children)) go(row, 0, '')
}

/**
 * The tree in depth-first order. `collapsed` ids keep their row but hide their subtree. `keep` (when
 * given) decides which rows are shown; a row that is not kept still shows while something under it
 * is, so a match always has its ancestors to hang from.
 */
export function flattenTree<T>(
  rows: readonly T[],
  at: TreeAccess<T>,
  opts: { collapsed?: ReadonlySet<string>; keep?: (row: T) => boolean } = {},
): TreeNode<T>[] {
  const children = childrenByParent(rows, at)
  const memo = new Map<string, boolean>()
  const shows = (row: T): boolean => {
    const id = at.id(row)
    const hit = memo.get(id)
    if (hit !== undefined) return hit
    memo.set(id, false) // a loop reads as not shown rather than recursing forever
    const yes = !opts.keep || opts.keep(row) || (children.get(id) ?? []).some(shows)
    memo.set(id, yes)
    return yes
  }
  const out: TreeNode<T>[] = []
  walk(rows, at, children, (row, id, depth, parentKey) => {
    if (!shows(row)) return false
    const childCount = (children.get(id) ?? []).filter(shows).length
    out.push({ row, id, depth, parentId: parentKey || null, childCount })
    return !opts.collapsed?.has(id)
  })
  return out
}

/** Every row under `id` (or under every root when `id` is null) that has children, cycle-safe. */
export function parentsUnder<T>(rows: readonly T[], at: TreeAccess<T>, children: Map<string, T[]>, id: string | null): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const visit = (row: T): void => {
    const key = at.id(row)
    if (seen.has(key)) return
    seen.add(key)
    const kids = children.get(key) ?? []
    if (kids.length === 0) return
    out.push(key)
    kids.forEach(visit)
  }
  if (id === null) treeRoots(rows, at, children).forEach(visit)
  else {
    seen.add(id)
    ;(children.get(id) ?? []).forEach(visit)
  }
  return out
}

/** How deep row `id` sits (0 = top level), cycle-safe. */
export function depthOf<T>(rows: readonly T[], at: TreeAccess<T>, id: string): number {
  const byId = new Map(rows.map((r) => [at.id(r), r]))
  const seen = new Set<string>([id])
  let depth = 0
  for (let p = byId.has(id) ? at.parentId(byId.get(id) as T) : null; p !== null && byId.has(p) && !seen.has(p); depth++) {
    seen.add(p)
    p = at.parentId(byId.get(p) as T)
  }
  return depth
}

/** How many levels a row's subtree reaches below it (0 = a leaf), folded or not. */
export function subtreeHeight<T>(children: Map<string, T[]>, at: TreeAccess<T>, id: string): number {
  const seen = new Set<string>()
  const height = (key: string): number => {
    if (seen.has(key)) return 0
    seen.add(key)
    let h = 0
    for (const child of children.get(key) ?? []) h = Math.max(h, 1 + height(at.id(child)))
    return h
  }
  return height(id)
}

/** `nodes` without the rows drawn under `id` (the contiguous deeper rows that follow it). */
export function withoutSubtree<T>(nodes: readonly TreeNode<T>[], id: string): TreeNode<T>[] {
  const at = nodes.findIndex((n) => n.id === id)
  if (at < 0) return [...nodes]
  let end = at + 1
  while (end < nodes.length && nodes[end].depth > nodes[at].depth) end++
  return [...nodes.slice(0, at + 1), ...nodes.slice(end)]
}

/**
 * Whole nesting steps for a horizontal drag offset. A step needs a deliberate push: the first level
 * engages at `step - slack` px, each further one `step` px on, so the wobble of a vertical drag never
 * changes the depth.
 */
export function nestLevels(offsetX: number, step: number, slack = step / 4): number {
  const n = Math.floor((Math.abs(offsetX) + slack) / step)
  return n === 0 ? 0 : Math.sign(offsetX) * n
}

export interface Projection {
  depth: number
  /** The depths this slot allows, shallowest first: what a horizontal push can choose between. */
  depths: number[]
  parentId: string | null
  /** The sibling it lands after; null = first among its siblings. */
  afterId: string | null
}

export interface DropRules {
  /** Deepest depth any row may reach. 0 = reorder only. */
  maxDepth?: number
  /** Levels the dragged row carries below it: it may go no deeper than `maxDepth - carry`. */
  carry?: number
  /** Whether the dragged row may sit under `parentId` (null = the top level). */
  allows?: (parentId: string | null) => boolean
}

/** The parent a row at `depth` gets when inserted at index `to` of `moved` (after `moved[to - 1]`). */
function parentAt<T>(moved: readonly TreeNode<T>[], to: number, depth: number): string | null {
  const prev = moved[to - 1]
  if (depth === 0 || !prev) return null
  if (depth > prev.depth) return prev.id
  for (let i = to - 1; i >= 0; i--) if (moved[i].depth === depth) return moved[i].parentId
  return null
}

/**
 * Where a dragged row would land: at `slot` among the other rows (0 = first), pushed `levels` steps
 * right (negative: left) of its own depth (see `nestLevels`). `nodes` is the flat list as drawn,
 * without the dragged row's subtree (`withoutSubtree`). Null when the slot allows no depth under
 * `rules`.
 */
export function projectDrop<T>(nodes: readonly TreeNode<T>[], activeId: string, slot: number, levels: number, rules: DropRules = {}): Projection | null {
  const active = nodes.find((n) => n.id === activeId)
  if (!active) return null
  const moved = nodes.filter((n) => n.id !== activeId)
  const to = Math.max(0, Math.min(moved.length, slot))
  moved.splice(to, 0, active)
  const prev = moved[to - 1]
  const next = moved[to + 1]
  // The row above bounds it from above (at most one level under it), the row below from below (at
  // least its depth, or the row below would change parent), the rules from both.
  const max = Math.min((rules.maxDepth ?? Infinity) - (rules.carry ?? 0), prev ? prev.depth + 1 : 0)
  const min = next ? next.depth : 0
  const depths: number[] = []
  for (let d = min; d <= max; d++) if (!rules.allows || rules.allows(parentAt(moved, to, d))) depths.push(d)
  if (depths.length === 0) return null
  const wanted = active.depth + levels
  const depth = depths.reduce((best, d) => (Math.abs(d - wanted) < Math.abs(best - wanted) ? d : best))
  const parentId = parentAt(moved, to, depth)
  // Walking up from the new position: the first row with the same parent is the one it follows;
  // reaching the parent itself first means it lands as the first child.
  let afterId: string | null = null
  for (let i = to - 1; i >= 0; i--) {
    if (moved[i].parentId === parentId) {
      afterId = moved[i].id
      break
    }
    if (moved[i].id === parentId) break
  }
  return { depth, depths, parentId, afterId }
}

/**
 * Every id in depth-first order after moving `activeId` under `parentId`, right after `afterId`
 * among its new siblings (null = first). Every parent precedes its subtree and every row appears
 * exactly once, so a caller that stores one order sequence per list can write this as is.
 */
export function orderAfterMove<T>(rows: readonly T[], at: TreeAccess<T>, activeId: string, parentId: string | null, afterId: string | null): string[] {
  const placed: TreeAccess<T> = { id: at.id, parentId: (r) => (at.id(r) === activeId ? parentId : at.parentId(r)) }
  const children = childrenByParent(rows, placed)
  const active = rows.find((r) => at.id(r) === activeId)
  if (active) {
    const key = parentId && rows.some((r) => at.id(r) === parentId) ? parentId : ''
    const list = (children.get(key) ?? []).filter((r) => at.id(r) !== activeId)
    const i = afterId ? list.findIndex((r) => at.id(r) === afterId) + 1 : 0
    list.splice(i, 0, active)
    children.set(key, list)
  }
  const out: string[] = []
  walk(rows, placed, children, (_row, id) => {
    out.push(id)
    return true
  })
  return out
}
