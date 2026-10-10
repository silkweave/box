// The circuit board's geometry and layout - pure functions over placements, node keys and edges,
// with no React and no React Flow types, so the layering is testable and the library stays
// swappable.
//
// A board places nodes of any installed kind (signals; with planning goals and initiatives). Edges
// are derived server-side and point from what moves to what it moves: driver -> signal,
// signal -> goal, initiative -> goal. An edge is a claim of influence and NOTHING more: the board
// never sums a parent from its children and never implies arithmetic.
//
// Positions are TEAM state, persisted on the board row (never localStorage). The layout below only
// SEEDS them ("Arrange", "Start from the wired graph", "Add connected"), so everything it produces
// is snapped to the same 16px grid the canvas snaps to.

import type { Signal } from '../../types.ts'

// Geometry and the layered layout are shared with the server (a board seeded from a planning
// cycle), so they live in core.
import { NODE_H, NODE_W, layoutLayers, snap } from '@silkweave/box-core/signals/board-layout'
export {
  ATTACHMENTS_SHOWN,
  GRID,
  NODE_H,
  NODE_W,
  cardSize,
  layoutLayers,
  snap,
  type LayoutEdge,
  type LayoutNode,
  type NodeSize,
} from '@silkweave/box-core/signals/board-layout'
const COL_GAP = 48
const ROW_GAP = 96

/** One placement on one board: which object, and where it sits. Mirrors the server's node shape. */
export interface BoardPlacement {
  kind: string
  ref: string
  x: number
  y: number
}

/** `kind:ref`, the node key. Kinds never contain ':'; refs may. */
export const placementKey = (p: { kind: string; ref: string }): string => `${p.kind}:${p.ref}`

export function parseKey(key: string): { kind: string; ref: string } {
  const i = key.indexOf(':')
  return { kind: key.slice(0, i), ref: key.slice(i + 1) }
}

/** Every signal that PARTICIPATES in a `depends_on` edge (drives something or is driven). */
export function wiredSignals(all: Signal[]): Signal[] {
  const ids = new Set(all.map((s) => s.id))
  const connected = new Set<string>()
  for (const s of all) {
    for (const dep of s.depends_on) {
      if (!ids.has(dep)) continue
      connected.add(s.id)
      connected.add(dep)
    }
  }
  return all.filter((s) => connected.has(s.id))
}

/** Placements for a signal-only seed ("Start from the wired graph"), laid out by depth. */
export function layoutSignals(members: Signal[]): BoardPlacement[] {
  const ids = new Set(members.map((s) => s.id))
  const laid = layoutLayers(
    members.map((s) => ({ key: placementKey({ kind: 'signal', ref: s.id }), layer: 0, label: `${s.group} ${s.label}` })),
    members.flatMap((s) =>
      s.depends_on.filter((d) => ids.has(d)).map((d) => ({ source: `signal:${d}`, target: `signal:${s.id}` })),
    ),
  )
  return members.map((s) => ({ kind: 'signal', ref: s.id, ...laid.get(`signal:${s.id}`)! }))
}

/**
 * Where a newly picked node lands: the next free grid slot, scanning left to right in rows just
 * below the current bounding box. Deterministic, never overlapping, always snapped - "add" must
 * not open a layout decision.
 */
export function nextFreeSlot(placements: BoardPlacement[]): { x: number; y: number } {
  if (placements.length === 0) return { x: 0, y: 0 }
  const minX = Math.min(...placements.map((p) => p.x))
  const maxY = Math.max(...placements.map((p) => p.y))
  const maxX = Math.max(...placements.map((p) => p.x))
  const cols = Math.max(1, Math.floor((maxX - minX) / (NODE_W + COL_GAP)) + 1)
  const startY = snap(maxY + NODE_H + ROW_GAP)
  const taken = new Set(placements.map((p) => `${p.x},${p.y}`))
  for (let row = 0; row < 100; row++) {
    for (let col = 0; col < cols; col++) {
      const x = snap(minX + col * (NODE_W + COL_GAP))
      const y = snap(startY + row * (NODE_H + ROW_GAP))
      if (!taken.has(`${x},${y}`)) return { x, y }
    }
  }
  return { x: snap(minX), y: snap(startY) }
}

/**
 * Where nodes added next to `anchor` land: a row above or below it (by layer), centred on it,
 * shifted past anything already there.
 */
export function slotsNear(
  anchor: { x: number; y: number; layer: number },
  added: { layer: number }[],
  placements: BoardPlacement[],
): { x: number; y: number }[] {
  const taken = new Set(placements.map((p) => `${p.x},${p.y}`))
  const out: { x: number; y: number }[] = []
  const rows = new Map<number, number>()
  for (const a of added) {
    const dy = a.layer > anchor.layer ? -1 : a.layer < anchor.layer ? 1 : 0
    const y = snap(anchor.y + dy * (NODE_H + ROW_GAP))
    let i = rows.get(y) ?? 0
    let x = 0
    // Alternate right/left of the anchor until a free slot turns up.
    for (; ; i++) {
      const step = Math.ceil((i + (dy === 0 ? 1 : 0)) / 2) * (i % 2 === 0 ? -1 : 1)
      x = snap(anchor.x + step * (NODE_W + COL_GAP))
      if (!taken.has(`${x},${y}`)) break
    }
    rows.set(y, i + 1)
    taken.add(`${x},${y}`)
    out.push({ x, y })
  }
  return out
}
