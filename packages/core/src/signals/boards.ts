// Circuit boards (docs/WAREHOUSE.md): user-named canvases that place nodes of any registered kind
// (signals, and through planning goals and initiatives; see ./board-kinds.ts). A board row holds
// MEMBERSHIP + POSITIONS and nothing else. Edges are derived from the objects themselves (a
// signal's `depends_on`, a goal's signal, an initiative's goals) and draw when both ends are on
// the board, so there is no per-board edge storage and no second cycle checker.
//
// The write pattern is whole-board: `nodes` is replaced in full on every autosave, last write wins
// per board, no version precondition. That is why `nodes` is a JSON column rather than a join table,
// and why board-upsert deliberately does NOT accept nodes: a label edit can then never race the
// autosave onto the same column.
//
// Stored node shape: `{kind, ref, x, y}`.
//
// Rename/delete cascades: an owner of a kind calls `renameBoardRef` / `pruneBoardRef` from its own
// rename and delete (signals from signals/definitions.ts, planning from its goal and initiative
// writes).

import { emitChange } from '../changes.js'
import { ensureSchema, withWrite } from '../warehouse/db.js'
import { deleteRecord, readRecord, readRecords, upsertRecord } from '../warehouse/model.js'
import { SIGNAL_BOARDS } from './models.js'
import {
  boardNodeKey,
  boardNodeKind,
  boardNodeKinds,
  type BoardCandidate,
  type BoardNodeCard,
  type BoardNodeRef,
} from './board-kinds.js'

/** Board ids share the data-source id charset: a plain slug, because a board is a user-named thing. */
const BOARD_ID = /^[a-z0-9][a-z0-9-]*$/

/** One PLACEMENT on one board. Never the object itself: removing a node removes it from THIS
 *  board only, and one object may sit on any number of boards. */
export interface BoardNode extends BoardNodeRef {
  /** Flow units. Stored verbatim (floats); snapping to the grid is the client's job. */
  x: number
  y: number
}

export interface Board {
  id: string
  label: string
  description: string
  nodes: BoardNode[]
  sort: number
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export interface BoardInput {
  id: string
  label?: string
  /** '' clears it. */
  description?: string
  sort?: number
  actor?: string
}

// --- reads ---------------------------------------------------------------------------------------

/** One stored entry, or null when it is not a placement at all. */
function readNode(raw: unknown): BoardNode | null {
  const n = raw as Partial<BoardNode>
  if (!n || typeof n !== 'object' || typeof n.x !== 'number' || typeof n.y !== 'number') return null
  if (typeof n.kind === 'string' && typeof n.ref === 'string') return { kind: n.kind, ref: n.ref, x: n.x, y: n.y }
  return null
}

// A JSON column can read back null on rows written outside the record layer; hand callers an array.
const norm = (b: Board): Board => ({
  ...b,
  nodes: Array.isArray(b.nodes) ? (b.nodes as unknown[]).flatMap((n) => readNode(n) ?? []) : [],
})

/** Every board, sorted by `sort` then id. Boards are few and small - `nodes` always rides along. */
export async function readBoards(): Promise<Board[]> {
  return (await readRecords<Board>(SIGNAL_BOARDS, { orderBy: 'sort, id' })).map(norm)
}

/** One board, or null. */
export async function readBoard(id: string): Promise<Board | null> {
  const b = await readRecord<Board>(SIGNAL_BOARDS, { id })
  return b ? norm(b) : null
}

// --- the resolved view ---------------------------------------------------------------------------

export interface BoardViewNode extends BoardNode {
  key: string
  /** Null when the object is gone or its kind is not registered (see `missing`). */
  card: BoardNodeCard | null
  /** Keys of every object this one is linked to, on the board or not ("Add connected"). */
  neighbors: string[]
}

export interface BoardViewEdge {
  id: string
  /** Node key of the node that moves the target. */
  source: string
  target: string
}

export interface BoardView {
  board: Board
  kinds: { kind: string; label: string; layer: number; lead: boolean }[]
  nodes: BoardViewNode[]
  /** Edges with both ends on this board. */
  edges: BoardViewEdge[]
  /** Placements that resolve to nothing, with the reason. Never written away by a read. */
  missing: { kind: string; ref: string; reason: string }[]
  /** Change-feed scopes that can alter this view. */
  watch: string[]
}

/** A board with every node resolved into a card, its edges and its neighbours. */
export async function readBoardView(id: string): Promise<BoardView | null> {
  const board = await readBoard(id)
  if (!board) return null
  const registered = boardNodeKinds()

  const cards = new Map<string, BoardNodeCard>()
  const missing: BoardView['missing'] = []
  for (const k of registered) {
    const refs = board.nodes.filter((n) => n.kind === k.kind).map((n) => n.ref)
    if (refs.length === 0) continue
    const resolved = await k.resolve(refs)
    for (const ref of refs) {
      const card = resolved.get(ref)
      if (card) cards.set(boardNodeKey({ kind: k.kind, ref }), card)
      else missing.push({ kind: k.kind, ref, reason: `no ${k.kind} ${ref}` })
    }
  }
  for (const n of board.nodes) {
    if (!boardNodeKind(n.kind)) missing.push({ kind: n.kind, ref: n.ref, reason: `kind ${n.kind} is not installed` })
  }

  // Every edge touching a placed node, from every kind; deduplicated by key.
  const all = new Map<string, BoardViewEdge>()
  const refs: BoardNodeRef[] = board.nodes.map(({ kind, ref }) => ({ kind, ref }))
  for (const k of registered) {
    for (const e of await k.edges(refs)) {
      const source = boardNodeKey(e.source)
      const target = boardNodeKey(e.target)
      all.set(`${source}->${target}`, { id: `${source}->${target}`, source, target })
    }
  }
  const resolvedKeys = new Set(cards.keys())
  const neighbors = new Map<string, Set<string>>()
  const link = (a: string, b: string): void => {
    if (!neighbors.has(a)) neighbors.set(a, new Set())
    neighbors.get(a)!.add(b)
  }
  for (const e of all.values()) {
    link(e.source, e.target)
    link(e.target, e.source)
  }

  return {
    board,
    kinds: registered.map(({ kind, label, layer, lead }) => ({ kind, label, layer, lead: !!lead })),
    nodes: board.nodes.map((n) => {
      const key = boardNodeKey(n)
      return { ...n, key, card: cards.get(key) ?? null, neighbors: [...(neighbors.get(key) ?? [])].sort() }
    }),
    edges: [...all.values()].filter((e) => resolvedKeys.has(e.source) && resolvedKeys.has(e.target)),
    missing,
    watch: [...new Set(['table:signal_boards', ...registered.flatMap((k) => k.watch)])],
  }
}

/** Everything a board could place, per registered kind. */
export async function readBoardCandidates(): Promise<{ kind: string; label: string; candidates: BoardCandidate[] }[]> {
  const out: { kind: string; label: string; candidates: BoardCandidate[] }[] = []
  for (const k of boardNodeKinds()) out.push({ kind: k.kind, label: k.label, candidates: await k.candidates() })
  return out
}

// --- writes --------------------------------------------------------------------------------------

/**
 * Create or partially update a board's METADATA. Never touches `nodes`: the record layer's partial
 * upsert leaves unprovided columns alone, which is exactly what keeps a rename from clobbering an
 * in-flight drag autosave.
 */
export async function upsertBoard(input: BoardInput): Promise<Board> {
  if (!BOARD_ID.test(input.id)) {
    throw new Error(`invalid board id "${input.id}" (lowercase; a-z 0-9 and dashes; must start alphanumeric)`)
  }
  const prev = await readBoard(input.id)
  return norm(
    await upsertRecord<Board>(
      SIGNAL_BOARDS,
      {
        id: input.id,
        label: input.label ?? prev?.label ?? input.id,
        description: input.description ?? prev?.description ?? '',
        sort: input.sort ?? prev?.sort ?? 0,
        // A fresh board is born empty; an existing one keeps whatever the autosave last wrote.
        nodes: prev?.nodes ?? [],
        ...(input.actor ? { actor: input.actor } : {}),
      },
      { prev },
    ),
  )
}

/** Delete a board. Nothing cascades - a board owns placements, never the objects or their links. */
export async function deleteBoard(id: string): Promise<{ id: string; nodes: number }> {
  const board = await readBoard(id)
  if (!board) throw new Error(`board ${id} not found`)
  await deleteRecord(SIGNAL_BOARDS, { id })
  return { id, nodes: board.nodes.length }
}

/**
 * Replace a board's whole node list - the autosave path, and the only writer of `nodes`.
 *
 * Each entry is `{kind, ref, x, y}` with
 * FINITE coordinates; one object sits at most once per board; every ref must exist for its kind.
 * A node whose kind is not installed, or whose object is gone, is kept only if the board already
 * held it, so a removed feature or a stale reference never makes a board unsaveable.
 */
export async function setBoardNodes(id: string, nodes: unknown, actor?: string): Promise<Board> {
  const prev = await readBoard(id)
  if (!prev) throw new Error(`board ${id} not found`)
  const clean = await validateNodes(prev, nodes)
  return norm(await upsertRecord<Board>(SIGNAL_BOARDS, { id, nodes: clean, ...(actor ? { actor } : {}) }, { prev }))
}

/** Shape + membership validation for a proposed node list. Refuses with the reason, never coerces. */
async function validateNodes(prev: Board, raw: unknown): Promise<BoardNode[]> {
  const boardId = prev.id
  if (!Array.isArray(raw)) throw new Error(`board ${boardId}: nodes must be an array of {kind, ref, x, y}`)
  const clean: BoardNode[] = []
  const seen = new Set<string>()
  raw.forEach((entry, i) => {
    const e = entry as Partial<BoardNode>
    if (!e || typeof e !== 'object') throw new Error(`board ${boardId}: nodes[${i}] must be an object {kind, ref, x, y}`)
    const kind = typeof e.kind === 'string' ? e.kind.trim() : ''
    const ref = typeof e.ref === 'string' ? e.ref.trim() : ''
    if (!kind || !ref) throw new Error(`board ${boardId}: nodes[${i}] needs a non-empty kind and ref`)
    if (typeof e.x !== 'number' || !Number.isFinite(e.x) || typeof e.y !== 'number' || !Number.isFinite(e.y)) {
      throw new Error(`board ${boardId}: nodes[${i}] (${kind} ${ref}) needs finite numeric x and y`)
    }
    const key = boardNodeKey({ kind, ref })
    if (seen.has(key)) throw new Error(`board ${boardId}: ${kind} ${ref} appears twice - an object sits at one place per board`)
    seen.add(key)
    clean.push({ kind, ref, x: e.x, y: e.y })
  })

  const held = new Set(prev.nodes.map(boardNodeKey))
  const byKind = new Map<string, string[]>()
  for (const n of clean) {
    if (held.has(boardNodeKey(n))) continue
    byKind.set(n.kind, [...(byKind.get(n.kind) ?? []), n.ref])
  }
  const problems: string[] = []
  for (const [kind, refs] of byKind) {
    const k = boardNodeKind(kind)
    if (!k) {
      problems.push(`unknown kind ${kind} (installed: ${boardNodeKinds().map((x) => x.kind).join(', ') || 'none'})`)
      continue
    }
    const known = await k.exists(refs)
    const unknown = refs.filter((r) => !known.has(r))
    if (unknown.length > 0) problems.push(`unknown ${kind}(s) ${unknown.join(', ')}`)
  }
  if (problems.length > 0) throw new Error(`board ${boardId}: nodes reference ${problems.join('; ')}`)
  return clean
}

// --- the rename/delete cascade legs ----------------------------------------------------------------
// Every placement names an object by id, so every id change and delete has to reach this table -
// `signal_points` was orphaned by a rename once (2026-08-10) and boards are the next that could be.

/** Write one board's `nodes` verbatim (the cascades bypass the validating upsert on purpose: they
 *  rewrite rows that were already valid, for an id the caller has just moved or removed). */
async function writeNodes(id: string, nodes: BoardNode[], actor?: string): Promise<void> {
  await ensureSchema()
  await withWrite(async (conn) => {
    await conn.run(
      `UPDATE signal_boards SET nodes = ?::JSON, updated_at = now(),
              updated_by = COALESCE(?, updated_by) WHERE id = ?`,
      [JSON.stringify(nodes), actor ?? null, id],
    )
  })
}

/** Rename cascade: re-key `kind:oldRef` to `kind:newRef` on every board. Returns the boards touched. */
export async function renameBoardRef(kind: string, oldRef: string, newRef: string, actor?: string): Promise<string[]> {
  const touched: string[] = []
  for (const board of await readBoards()) {
    if (!board.nodes.some((n) => n.kind === kind && n.ref === oldRef)) continue
    // A board that somehow already holds newRef keeps ONE placement - the moved one wins.
    const next: BoardNode[] = []
    const seen = new Set<string>()
    for (const n of board.nodes) {
      const moved = n.kind === kind && n.ref === oldRef ? { ...n, ref: newRef } : n
      const key = boardNodeKey(moved)
      if (seen.has(key)) continue
      seen.add(key)
      next.push(moved)
    }
    await writeNodes(board.id, next, actor)
    touched.push(board.id)
  }
  if (touched.length > 0) emitChange('table:signal_boards')
  return touched
}

/** Delete cascade: PRUNE the object's placement from every board. Returns the boards touched. */
export async function pruneBoardRef(kind: string, ref: string, actor?: string): Promise<string[]> {
  const touched: string[] = []
  for (const board of await readBoards()) {
    if (!board.nodes.some((n) => n.kind === kind && n.ref === ref)) continue
    await writeNodes(
      board.id,
      board.nodes.filter((n) => !(n.kind === kind && n.ref === ref)),
      actor,
    )
    touched.push(board.id)
  }
  if (touched.length > 0) emitChange('table:signal_boards')
  return touched
}
