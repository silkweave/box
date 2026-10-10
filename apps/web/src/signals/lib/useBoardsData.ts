// Circuit boards ride their OWN store, not `signalsData`. `signalsData` is the heavy payload
// (every point of every signal) and reloads on every `table:signal_points` event; a board changes
// on a ~2s autosave cadence while someone drags a node. Folding boards in would re-push the big
// payload once per drag-save echo. Separate stores mean a drag-save reload costs a few hundred
// bytes, and the board view simply composes the two.

import { useCallback, useEffect, useState } from 'react'
import type { BoardPlacement } from './boardGraph.ts'
import { registerStoreReloads, subscribeChanges } from '../../lib/changeFeed.ts'
import { createDataStore } from '../../lib/dataStore.ts'
import { trpc } from '../../lib/trpc.ts'
import { getActiveUserId } from '../../lib/useActiveUser.ts'

/** The active user as the mutation's `actor` audit stamp (created_by/updated_by server-side). */
const actor = (): string | undefined => getActiveUserId() ?? undefined

/** One board row: membership + positions in `nodes`, and nothing about edges (those are derived
 *  from the objects: a signal's drivers, a goal's signal, an initiative's goals). */
export interface CircuitBoard {
  id: string
  label: string
  description: string
  nodes: BoardPlacement[]
  sort: number
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export interface BoardsData {
  generatedAt: string
  boards: CircuitBoard[]
}

const store = createDataStore<BoardsData>(() => trpc.boardsList.query({}).then((d) => d as unknown as BoardsData))
registerStoreReloads(['table:signal_boards'], store)

export function useBoardsData(): { data: BoardsData | null; error: string | null } {
  return store.useData()
}

/** Force a refetch. */
export const reloadBoards = (): Promise<BoardsData> => store.reload()

/** Create or partially update a board's metadata. Deliberately cannot carry `nodes` - see
 *  boards.controller.ts: a label edit must never race the position autosave onto the same column. */
export async function saveBoard(input: {
  id: string
  label?: string
  description?: string
  sort?: number
}): Promise<void> {
  await trpc.boardsUpsert.mutate({ ...input, actor: actor() })
  await store.reload()
}

/** Delete a board. No undo, no soft delete - the arrangement is gone; the signals are untouched. */
export async function removeBoard(id: string): Promise<void> {
  await trpc.boardsDelete.mutate({ id, actor: actor() })
  await store.reload()
}

/**
 * Replace a board's WHOLE node list - the autosave path. Idempotent and last-write-wins per board:
 * no version precondition, no 409. Two people dragging one board lose one arrangement, attributed
 * by `updated_by` (the repo's standing posture, matching DocSave).
 */
export async function saveBoardNodes(id: string, nodes: BoardPlacement[]): Promise<void> {
  await trpc.boardsNodesSet.mutate({ id, nodes: JSON.stringify(nodes), actor: actor() })
  await store.reload()
}

// --- one board, resolved -------------------------------------------------------------------------
// The server resolves every node into a generic card (core signals/board-kinds.ts), so this view
// never needs to know what a goal or an initiative is.

export type BoardTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
export type BoardCardLook = 'metric' | 'lead' | 'work'

export interface BoardNodeAttachment {
  key: string
  title: string
  href: string
  status: { label: string; tone: BoardTone }
  meta?: string | null
  owner?: string | null
  progress?: number | null
}

export interface BoardNodeCard {
  title: string
  subtitle?: string | null
  value?: string | null
  unit?: string | null
  badge?: { label: string; tone: BoardTone } | null
  progress?: number | null
  pace?: number | null
  target?: string | null
  eyebrow?: string | null
  look?: BoardCardLook
  attachments?: BoardNodeAttachment[]
  sparkline?: number[]
  footer?: string | null
  footerTone?: BoardTone
  href: string
  details?: { label: string; value: string }[]
}

export interface BoardViewNode extends BoardPlacement {
  key: string
  card: BoardNodeCard | null
  neighbors: string[]
}

export interface BoardKindInfo {
  kind: string
  label: string
  layer: number
  /** Always the top row when arranged (goals). */
  lead: boolean
}

export interface ResolvedBoard {
  board: CircuitBoard
  kinds: BoardKindInfo[]
  nodes: BoardViewNode[]
  edges: { id: string; source: string; target: string }[]
  missing: { kind: string; ref: string; reason: string }[]
  watch: string[]
}

/**
 * One board resolved by the server, refetched whenever anything it shows changes (the server names
 * the change-feed scopes in `watch`). Positions are NOT taken from here while the canvas holds
 * unsaved edits - see BoardView's dirty flag.
 */
export function useBoardView(id: string): { view: ResolvedBoard | null; error: string | null; reload: () => Promise<void> } {
  const [view, setView] = useState<ResolvedBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(async () => {
    try {
      const next = (await trpc.boardsView.mutate({ id })) as unknown as ResolvedBoard
      setView(next)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [id])

  useEffect(() => {
    setView(null)
    void reload()
  }, [reload])

  const watch = view?.watch.join('|') ?? 'table:signal_boards'
  useEffect(() => subscribeChanges(watch.split('|'), () => void reload()), [watch, reload])

  return { view, error, reload }
}

export interface BoardCandidates {
  kind: string
  label: string
  candidates: { ref: string; title: string; group: string }[]
}

/** Everything a board could place, per installed node kind. */
export async function loadBoardCandidates(): Promise<BoardCandidates[]> {
  return ((await trpc.boardsCandidates.query({})) as unknown as { kinds: BoardCandidates[] }).kinds
}
