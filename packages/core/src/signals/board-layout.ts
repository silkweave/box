// The circuit board's geometry and auto-layout: pure functions over node keys, sizes and edges, with
// no React, no React Flow and no warehouse, so the web canvas ("Arrange") and the server (a board
// seeded from a planning cycle) lay a board out the same way and the layering is testable.
//
// Edges point from what moves to what it moves (driver -> signal, signal -> goal, initiative ->
// goal), so rows read BOTTOM-UP: movers sit below what they move. A `lead` node (a goal) always
// takes the top row, whatever its depth, so a goal board opens on its goals.
//
// Everything produced is snapped to the 16px grid the canvas snaps to.

/** The metric card is 240x112 on a 16px grid, so the visible dots ARE the snap grid. */
export const NODE_W = 240
export const NODE_H = 112
/** The lead card (a goal) is wider and taller; its attachments add rows below. */
export const LEAD_W = 336
export const LEAD_H = 176
/** One attachment row on a lead card, the "+N more" line, and the band's padding. */
export const ATTACHMENT_ROW_H = 40
export const ATTACHMENT_MORE_H = 24
export const ATTACHMENT_PAD = 16
/** Attachments drawn before collapsing to "+N more". */
export const ATTACHMENTS_SHOWN = 3
/** The one grid size: snapGrid, the Background dot gap, and every layout constant divide by it. */
export const GRID = 16
const COL_GAP = 48
const ROW_GAP = 96

/** Snap a flow coordinate to the grid. The server stores coordinates verbatim; snapping is a layout
 *  concern, so the grid size never becomes a wire contract. */
export const snap = (n: number): number => Math.round(n / GRID) * GRID
const snapUp = (n: number): number => Math.ceil(n / GRID) * GRID

export interface NodeSize {
  w: number
  h: number
}

/** A card's size from its look and how many attachments it draws. */
export function cardSize(look: 'metric' | 'lead' | 'work' | undefined, attachments = 0): NodeSize {
  if (look !== 'lead') return { w: NODE_W, h: NODE_H }
  if (attachments === 0) return { w: LEAD_W, h: LEAD_H }
  const rows = Math.min(attachments, ATTACHMENTS_SHOWN)
  const more = attachments > ATTACHMENTS_SHOWN ? ATTACHMENT_MORE_H : 0
  return { w: LEAD_W, h: snapUp(LEAD_H + ATTACHMENT_PAD + rows * ATTACHMENT_ROW_H + more) }
}

export interface LayoutNode {
  key: string
  /** The lowest row this node may sit on (its kind's layer). */
  layer: number
  /** Tie-break inside a row. */
  label: string
  /** Always the top row. */
  lead?: boolean
  /** Defaults to the metric card. */
  size?: NodeSize
}

export interface LayoutEdge {
  /** Moves the target; sits below it. */
  source: string
  target: string
}

/**
 * Lay nodes out in rows, MOVERS AT THE BOTTOM: a node sits on its kind's layer or one row above the
 * highest node that moves it, whichever is higher, so every edge points upward. Lead nodes then
 * move to one row above everything else. Within a row, nodes are ordered and placed near the
 * centre of what they connect to, so a goal sits over its signal and a driver under what it
 * drives. Returns snapped top-left positions keyed by node key.
 */
export function layoutLayers(nodes: LayoutNode[], edges: LayoutEdge[]): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map()
  const keys = new Set(nodes.map((n) => n.key))
  const inner = edges.filter((e) => keys.has(e.source) && keys.has(e.target) && e.source !== e.target)
  const moversOf = new Map<string, string[]>()
  const movesOf = new Map<string, string[]>()
  for (const e of inner) {
    moversOf.set(e.target, [...(moversOf.get(e.target) ?? []), e.source])
    movesOf.set(e.source, [...(movesOf.get(e.source) ?? []), e.target])
  }
  const byKey = new Map(nodes.map((n) => [n.key, n]))
  const sizeOf = (key: string): NodeSize => byKey.get(key)?.size ?? { w: NODE_W, h: NODE_H }

  // Depth = max(layer, 1 + the deepest mover). Iterative with a relaxation cap rather than
  // recursion: the server refuses cycles in each edge family, but a client that hard-loops on bad
  // data is a worse failure than one that lays a cycle out slightly wrong.
  const depth = new Map<string, number>(nodes.map((n) => [n.key, n.layer]))
  for (let pass = 0; pass < nodes.length; pass++) {
    let moved = false
    for (const n of nodes) {
      const d = Math.max(n.layer, ...(moversOf.get(n.key) ?? []).map((k) => (depth.get(k) ?? 0) + 1))
      if (d > (depth.get(n.key) ?? 0)) {
        depth.set(n.key, d)
        moved = true
      }
    }
    if (!moved) break
  }
  // Lead nodes share one row above every other node.
  const rest = nodes.filter((n) => !n.lead)
  if (rest.length < nodes.length) {
    const top = rest.length ? Math.max(...rest.map((n) => depth.get(n.key)!)) + 1 : 0
    for (const n of nodes) if (n.lead) depth.set(n.key, top)
  }

  // Compress empty rows; rows[0] is the bottom.
  const used = [...new Set(depth.values())].sort((a, b) => a - b)
  const rowOf = new Map(used.map((d, i) => [d, i]))
  const rows: LayoutNode[][] = used.map(() => [])
  for (const n of nodes) rows[rowOf.get(depth.get(n.key)!)!].push(n)
  rows.forEach((r) => r.sort((a, b) => a.label.localeCompare(b.label)))

  // Ordering: barycenter sweeps over the INDEX of linked nodes in any other row (an edge may skip
  // rows), alternating down and up, enough to keep a dozen-node board from crossing itself.
  const rank = (): Map<string, number> => {
    const out = new Map<string, number>()
    for (const row of rows) row.forEach((n, i) => out.set(n.key, i - (row.length - 1) / 2))
    return out
  }
  const reorder = (row: LayoutNode[], links: Map<string, string[]>, at: Map<string, number>): LayoutNode[] =>
    row
      .map((n, i) => {
        const xs = (links.get(n.key) ?? []).map((k) => at.get(k)).filter((x): x is number => x !== undefined)
        return { n, key: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : i - (row.length - 1) / 2 }
      })
      .sort((a, b) => a.key - b.key)
      .map((e) => e.n)
  for (let sweep = 0; sweep < 3; sweep++) {
    for (let r = 1; r < rows.length; r++) rows[r] = reorder(rows[r], moversOf, rank())
    for (let r = rows.length - 2; r >= 0; r--) rows[r] = reorder(rows[r], movesOf, rank())
  }

  // Placement, bottom-up: the bottom row is packed and centred on x = 0; every row above puts each
  // node over the centre of its movers when it can, never overlapping the node to its left. Then
  // the top row is re-centred over the whole board if it has no anchors.
  const centre = new Map<string, number>()
  const place = (row: LayoutNode[], wanted: (n: LayoutNode) => number | null): void => {
    const total = row.reduce((s, n) => s + sizeOf(n.key).w, 0) + (row.length - 1) * COL_GAP
    let cursor = -total / 2
    const desired = row.map(wanted)
    const anchored = desired.some((d) => d !== null)
    // Spread the row around the mean of its anchors, so an anchored row does not drift off-centre.
    if (anchored) {
      const mean = desired.filter((d): d is number => d !== null).reduce((a, b) => a + b, 0) / desired.filter((d) => d !== null).length
      cursor = mean - total / 2
    }
    let right = -Infinity
    row.forEach((n, i) => {
      const w = sizeOf(n.key).w
      const natural = cursor + w / 2
      const want = desired[i] ?? natural
      const c = Math.max(want, right + COL_GAP + w / 2)
      centre.set(n.key, c)
      right = c + w / 2
      cursor += w + COL_GAP
    })
  }
  const mean = (keys: string[]): number | null => {
    const xs = keys.map((k) => centre.get(k)).filter((x): x is number => x !== undefined)
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
  }
  rows.forEach((row, r) => {
    if (r === 0) return place(row, () => null)
    place(row, (n) => mean(moversOf.get(n.key) ?? []))
  })
  // The bottom row was packed only to seed the rows above; now that they are placed, put each
  // bottom node under what it drives, so a driver sits beneath its signal.
  if (rows.length > 1) place(rows[0], (n) => mean(movesOf.get(n.key) ?? []))

  // Rows stack top-down by their tallest card, cards top-aligned within a row.
  const out = new Map<string, { x: number; y: number }>()
  let y = 0
  for (let r = rows.length - 1; r >= 0; r--) {
    const h = Math.max(...rows[r].map((n) => sizeOf(n.key).h))
    for (const n of rows[r]) out.set(n.key, { x: snap(centre.get(n.key)! - sizeOf(n.key).w / 2), y: snap(y) })
    y += h + ROW_GAP
  }
  return out
}
