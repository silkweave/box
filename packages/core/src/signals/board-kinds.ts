// The circuit board node-kind port. A board places NODES of any registered kind (core's `signal`;
// planning's `goal` and `initiative`) and draws the edges between them. Core owns the canvas and
// this registry; a dependent registers its kinds from its server module's onModuleInit ("the
// dependent registers into the dependency", like `registerSignalHooks`). A Box without planning
// simply has signal-only boards.
//
// The web stays kind-agnostic: every node is resolved here into a generic CARD (title, value,
// badge, progress, sparkline, link, details), so the canvas never learns what a goal is.
//
// Edges are never stored. Each kind contributes the edges it OWNS (signal: `depends_on`; goal: the
// signal it measures; initiative: the goals it contributes to). An edge points from the thing that
// moves to the thing it moves: driver -> signal, signal -> the goal it measures, initiative -> goal.
// So a board reads bottom-up into its goals, and a `lead` kind (goals) always takes the top row.

export interface BoardNodeRef {
  kind: string
  ref: string
}

export type BoardTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

/**
 * How a card is drawn. `metric` (the default) is the plain card; `lead` is the larger, accented
 * card for what the board is about (a goal); `work` is the dashed card for effort (an initiative).
 * A look, never a kind: the canvas still knows nothing about goals.
 */
export type BoardCardLook = 'metric' | 'lead' | 'work'

/** A small card drawn ON its parent card (an initiative on its goal). `key` is the node key the
 *  object would have on a board, so the canvas can leave out an attachment that is placed as a
 *  node of its own. */
export interface BoardNodeAttachment {
  key: string
  title: string
  href: string
  status: { label: string; tone: BoardTone }
  /** One short line ("10 open · 6 h"). */
  meta?: string | null
  owner?: string | null
  /** 0..1, drawn as a thin bar; null = none. */
  progress?: number | null
}

/** One node, presented. Every field but `title` and `href` is optional. */
export interface BoardNodeCard {
  title: string
  /** One short line under the title (a target, a status word, an interval). */
  subtitle?: string | null
  /** The headline number, already formatted ("8.2K"). */
  value?: string | null
  unit?: string | null
  badge?: { label: string; tone: BoardTone } | null
  /** 0..1 (may exceed 1). Drawn as a bar; null = none. */
  progress?: number | null
  /** Where `progress` should be by now, 0..1, drawn as a marker on the bar; null = none. */
  pace?: number | null
  /** The value's reference, shown after it ("of 15K"). */
  target?: string | null
  /** A short line above the title on a `lead` card (the cycle). */
  eyebrow?: string | null
  look?: BoardCardLook
  attachments?: BoardNodeAttachment[]
  /** Recent values, oldest first, for a bar sparkline. */
  sparkline?: number[]
  footer?: string | null
  footerTone?: BoardTone
  /** App route that opens the object. */
  href: string
  /** Shown in the focused node's detail panel. */
  details?: { label: string; value: string }[]
}

export interface BoardEdgeRef {
  /** The node that moves the target. */
  source: BoardNodeRef
  target: BoardNodeRef
}

export interface BoardCandidate {
  ref: string
  title: string
  /** Picker section ("GitHub", "2026-q4", "Active"). */
  group: string
}

export interface BoardNodeKind {
  kind: string
  /** Plural, for the picker ("Signals"). */
  label: string
  /** Auto-arrange row: a node sits at least on this layer (0 = bottom). Initiatives 0, goals 1,
   *  signals 2, goals 3, so the work sits under what it moves. */
  layer: number
  /** Always on the top row when the board is arranged, above everything it does not move. */
  lead?: boolean
  /** Change-feed scopes whose events can alter this kind's cards or edges. */
  watch: string[]
  /** The refs that exist (write validation). */
  exists: (refs: string[]) => Promise<Set<string>>
  /** Cards for the refs that resolve; a missing ref is simply absent from the map. */
  resolve: (refs: string[]) => Promise<Map<string, BoardNodeCard>>
  /** Everything a board could place, for the picker. */
  candidates: () => Promise<BoardCandidate[]>
  /** Every edge THIS kind owns that touches any of `nodes` (either end), board or not. */
  edges: (nodes: BoardNodeRef[]) => Promise<BoardEdgeRef[]>
}

const kinds: BoardNodeKind[] = []

/** Register once per kind. Returns the unregister. */
export function registerBoardNodeKind(k: BoardNodeKind): () => void {
  if (kinds.some((x) => x.kind === k.kind)) throw new Error(`board node kind "${k.kind}" registered twice`)
  if (k.kind.includes(':')) throw new Error(`board node kind "${k.kind}" may not contain ':'`)
  kinds.push(k)
  return () => {
    const i = kinds.indexOf(k)
    if (i >= 0) kinds.splice(i, 1)
  }
}

export function boardNodeKinds(): readonly BoardNodeKind[] {
  return kinds
}

export function boardNodeKind(kind: string): BoardNodeKind | undefined {
  return kinds.find((k) => k.kind === kind)
}

/** `kind:ref`, the node key the view and the web use. Refs may contain ':'; kinds may not. */
export const boardNodeKey = (n: BoardNodeRef): string => `${n.kind}:${n.ref}`

/** Compact display number: 12345 -> "12.3K", 0.052 -> "0.052". */
export function formatBoardNumber(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null
  const abs = Math.abs(n)
  const trim = (s: string): string => s.replace(/\.0+$|(\.\d*?)0+$/, '$1')
  if (abs >= 1e9) return `${trim((n / 1e9).toFixed(1))}B`
  if (abs >= 1e6) return `${trim((n / 1e6).toFixed(1))}M`
  if (abs >= 1e4) return `${trim((n / 1e3).toFixed(1))}K`
  if (abs >= 100) return String(Math.round(n))
  return trim(n.toFixed(abs >= 1 ? 1 : 3))
}
