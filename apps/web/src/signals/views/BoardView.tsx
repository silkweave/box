import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { CircuitBoardFlow } from '../components/board/CircuitBoardFlowLazy.tsx'
import { connectable } from '../components/board/connectable.ts'
import { loadBoardCandidates, saveBoardNodes, useBoardView, type BoardCandidates } from '../lib/useBoardsData.ts'
import { cardSize, layoutLayers, nextFreeSlot, parseKey, placementKey, slotsNear, type BoardPlacement } from '../lib/boardGraph.ts'
import { cn } from '@/lib/utils'

// One circuit board: placed nodes of any installed kind (signals; with planning goals and
// initiatives), resolved into cards by the server, with the edges between them.
//
// PERSISTENCE, and the one subtle rule in this file. `placements` is local state; a position change
// (drag stop, arrange) arms a ~2s debounced save of the WHOLE node list, and a membership change
// (add, remove) saves at once so the server can resolve the new node's card. A DIRTY FLAG - local
// edits not yet acknowledged by a resolved save - governs what an incoming view may do: while dirty
// it is ignored for COORDINATES (our copy is the newer truth and, under last-write-wins, the one that
// will land), while cards and edges keep updating freely.
//
// Saves are idempotent and last-write-wins per board: the whole column is replaced, no version
// precondition, no 409. Two people arranging one board concurrently lose one arrangement,
// attributed by `updated_by`.

const SAVE_DEBOUNCE_MS = 2_000

const sameNodes = (a: BoardPlacement[], b: BoardPlacement[]): boolean =>
  a.length === b.length && a.every((p, i) => placementKey(p) === placementKey(b[i]) && p.x === b[i].x && p.y === b[i].y)

export function BoardView() {
  const { id } = useParams({ strict: false }) as { id: string }
  const { view, error, reload } = useBoardView(id)

  // `null` until this board's stored nodes have been adopted once - so the canvas mounts WITH its
  // arrangement and React Flow's one-shot fitView frames the real board rather than an empty pane.
  const [adopted, setPlacements] = useState<BoardPlacement[] | null>(null)
  const placements = useMemo(() => adopted ?? [], [adopted])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const dirty = useRef(false)
  const pending = useRef<{ id: string; nodes: BoardPlacement[] } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  /** Send whatever is queued, now. Called by the debounce timer, membership changes and on leave. */
  const flush = useCallback(() => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
    const queued = pending.current
    if (!queued) return
    pending.current = null
    void saveBoardNodes(queued.id, queued.nodes)
      .then(() => {
        setSaveError(null)
        // Only stop being dirty if nothing was edited while this save was in flight.
        if (pending.current === null) dirty.current = false
        void reload()
      })
      .catch((e: unknown) => {
        // Stay dirty on failure: the local arrangement is still the newer truth, and the next edit
        // (or the next flush) retries it. Nothing is silently discarded.
        setSaveError(e instanceof Error ? e.message : String(e))
      })
  }, [reload])

  const commit = useCallback(
    (next: BoardPlacement[], now = false) => {
      setPlacements(next)
      dirty.current = true
      pending.current = { id, nodes: next }
      if (timer.current !== undefined) clearTimeout(timer.current)
      if (now) flush()
      else timer.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS)
    },
    [id, flush],
  )
  // Membership changes save at once; pure moves debounce.
  const onPlacements = useCallback(
    (next: BoardPlacement[]) => {
      const before = new Set(placements.map(placementKey))
      const membership = next.length !== placements.length || next.some((p) => !before.has(placementKey(p)))
      commit(next, membership)
    },
    [placements, commit],
  )

  // Switching boards (or leaving) flushes the arrangement we were holding.
  useEffect(() => {
    dirty.current = false
    setPlacements(null)
    return () => flush()
  }, [id, flush])

  // The refetch rule: adopt the server's node list wholesale when NOT dirty, ignore it when dirty.
  const stored = view?.board.id === id ? view.board.nodes : null
  useEffect(() => {
    if (!stored || dirty.current) return
    setPlacements((cur) => (cur && sameNodes(cur, stored) ? cur : stored))
  }, [stored])

  const layerOf = useMemo(() => new Map((view?.kinds ?? []).map((k) => [k.kind, k.layer])), [view])
  const leads = useMemo(() => new Set((view?.kinds ?? []).filter((k) => k.lead).map((k) => k.kind)), [view])

  const add = useCallback(
    (kind: string, ref: string) => commit([...placements, { kind, ref, ...nextFreeSlot(placements) }], true),
    [placements, commit],
  )

  const addConnected = useCallback(
    (key: string) => {
      const node = view?.nodes.find((n) => n.key === key)
      const anchor = placements.find((p) => placementKey(p) === key)
      if (!node || !anchor) return
      const onBoard = new Set(placements.map(placementKey))
      const added = connectable(node, onBoard).map(parseKey)
      const slots = slotsNear(
        { x: anchor.x, y: anchor.y, layer: layerOf.get(anchor.kind) ?? 0 },
        added.map((a) => ({ layer: layerOf.get(a.kind) ?? 0 })),
        placements,
      )
      commit([...placements, ...added.map((a, i) => ({ ...a, ...slots[i] }))], true)
    },
    [view, placements, layerOf, commit],
  )

  const arrange = useCallback(() => {
    if (!view) return
    const byKey = new Map(view.nodes.map((n) => [n.key, n]))
    const onBoard = new Set(placements.map(placementKey))
    const laid = layoutLayers(
      placements.map((p) => {
        const key = placementKey(p)
        const card = byKey.get(key)?.card
        const attached = (card?.attachments ?? []).filter((a) => !onBoard.has(a.key)).length
        return { key, layer: layerOf.get(p.kind) ?? 0, lead: leads.has(p.kind), label: card?.title ?? p.ref, size: cardSize(card?.look, attached) }
      }),
      view.edges,
    )
    commit(placements.map((p) => ({ ...p, ...laid.get(placementKey(p)) })))
  }, [view, placements, layerOf, leads, commit])

  if (error && !view) {
    return (
      <div className='grid h-full place-items-center px-8 text-center text-body-sm text-muted-foreground'>
        <p className='max-w-prose'>{/not found/.test(error) ? <>No board with the id <code>{id}</code>. It may have been deleted - pick one from the sidebar.</> : error}</p>
      </div>
    )
  }
  if (!view || view.board.id !== id) {
    return <div className='grid h-full place-items-center text-body-sm text-muted-foreground'>Loading board…</div>
  }

  return (
    <div className='flex h-full min-h-0 flex-col'>
      <div className='flex min-h-0 flex-1'>
        <div className='relative min-w-0 flex-1'>
          {adopted === null ? (
            <div className='grid h-full place-items-center text-body-sm text-muted-foreground'>Loading board…</div>
          ) : (
            <CircuitBoardFlow
              nodes={view.nodes}
              edges={view.edges}
              kinds={view.kinds}
              placements={adopted}
              onPlacements={onPlacements}
              onArrange={arrange}
              onAddConnected={addConnected}
              onTogglePicker={() => setPickerOpen((o) => !o)}
              pickerOpen={pickerOpen}
              missing={view.missing.length}
            />
          )}
          {saveError && (
            <p className='absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-md border border-danger/40 bg-bg px-3 py-1.5 text-label text-danger shadow-sm'>
              Board not saved: {saveError}
            </p>
          )}
          {adopted?.length === 0 && (
            <div className='pointer-events-none absolute inset-0 grid place-items-center px-8 text-center'>
              <p className='max-w-prose text-body-sm text-muted-foreground'>
                This board is empty. Open "Add nodes" and pick a goal, an initiative or a signal, then use "Add
                connected" on it to pull in what it is linked to.
              </p>
            </div>
          )}
        </div>
        {pickerOpen && <PickerPanel placed={new Set(placements.map(placementKey))} onAdd={add} onClose={() => setPickerOpen(false)} />}
      </div>
    </div>
  )
}

/**
 * The picker: everything NOT on this board, one tab per node kind, searchable and grouped, click to
 * add. A side panel rather than a modal, because seeing the canvas while choosing is the point.
 */
function PickerPanel({
  placed,
  onAdd,
  onClose,
}: {
  placed: Set<string>
  onAdd: (kind: string, ref: string) => void
  onClose: () => void
}) {
  const [kinds, setKinds] = useState<BoardCandidates[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => {
    loadBoardCandidates()
      .then((k) => {
        setKinds(k)
        setTab((cur) => cur ?? k[0]?.kind ?? null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const active = kinds?.find((k) => k.kind === tab) ?? null
  const q = query.trim().toLowerCase()
  const groups = useMemo(() => {
    if (!active) return []
    const open = active.candidates.filter(
      (c) => !placed.has(placementKey({ kind: active.kind, ref: c.ref })) && (!q || c.title.toLowerCase().includes(q) || c.ref.toLowerCase().includes(q)),
    )
    const byGroup = new Map<string, typeof open>()
    for (const c of open) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c])
    return [...byGroup.entries()]
  }, [active, placed, q])

  return (
    <aside className='flex w-72 shrink-0 flex-col border-l border-border bg-surface'>
      <div className='flex items-center gap-2 border-b border-border px-3 py-2'>
        <Search className='size-3.5 shrink-0 text-muted-foreground' />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search…'
          className='min-w-0 flex-1 bg-transparent text-body-sm text-text outline-none placeholder:text-muted-foreground'
        />
        <button type='button' onClick={onClose} className='shrink-0 text-label text-muted-foreground hover:text-text'>
          Close
        </button>
      </div>
      {kinds && kinds.length > 1 && (
        <div className='flex gap-1 border-b border-border px-3 py-1.5'>
          {kinds.map((k) => (
            <button
              key={k.kind}
              type='button'
              onClick={() => setTab(k.kind)}
              className={cn(
                'rounded px-2 py-0.5 text-label',
                k.kind === tab ? 'bg-bg font-medium text-text' : 'text-muted-foreground hover:text-text',
              )}>
              {k.label}
            </button>
          ))}
        </div>
      )}
      <div className='min-h-0 flex-1 overflow-y-auto px-3 py-2'>
        {error ? (
          <p className='text-label text-danger'>{error}</p>
        ) : !kinds ? (
          <p className='text-label text-muted-foreground'>Loading…</p>
        ) : groups.length === 0 ? (
          <p className='text-label text-muted-foreground'>{q ? 'Nothing matches that.' : `Every ${active?.label.toLowerCase() ?? 'item'} is already on this board.`}</p>
        ) : (
          groups.map(([group, list]) => (
            <div key={group} className='mb-3'>
              <p className='mb-1 text-label font-medium text-muted-foreground'>{group}</p>
              <ul>
                {list.map((c) => (
                  <li key={c.ref}>
                    <button
                      type='button'
                      onClick={() => onAdd(active!.kind, c.ref)}
                      title={`Add ${c.ref} to this board`}
                      className='flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-body-sm text-text hover:bg-bg hover:text-accent'>
                      <span aria-hidden className='size-2 shrink-0 rounded-full bg-border' />
                      <span className='truncate'>{c.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
