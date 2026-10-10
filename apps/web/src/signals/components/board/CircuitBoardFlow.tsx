import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './circuitBoard.css'
import { ExternalLink, FileText, Plus, Target, X } from 'lucide-react'
import { Button, UserChip } from '@silkweave/box-ui'
import { ATTACHMENTS_SHOWN, GRID, cardSize, placementKey, type BoardPlacement, type NodeSize } from '../../lib/boardGraph.ts'
import type { BoardKindInfo, BoardNodeAttachment, BoardNodeCard, BoardTone, BoardViewNode } from '../../lib/useBoardsData.ts'
import { cn } from '@/lib/utils'
import { connectable, visibleAttachments } from './connectable.ts'

// The circuit board canvas - React Flow, loaded through CircuitBoardFlowLazy so ~150 kB of graph
// library only reaches a browser that opens a board route.
//
// Positions come from the BOARD ROW and go back to it: this component is controlled by
// `placements` and reports every membership/position change up through `onPlacements`, where the
// debounced autosave lives. React Flow owns positions only for the duration of a drag, which is why
// the seed effect keys off a signature of the placements rather than their array identity - a
// refreshed card (a new point, a task closed) must never yank a node the user is dragging.
//
// Cards are resolved server-side per node kind, so this file draws a signal, a goal and an
// initiative with the same component and never learns what they are.

const TONE_TEXT: Record<BoardTone, string> = {
  neutral: 'text-muted-foreground',
  accent: 'text-accent',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
}
const TONE_BG: Record<BoardTone, string> = {
  neutral: 'bg-border',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

const TONE_PILL: Record<BoardTone, string> = {
  neutral: 'bg-border/60 text-muted-foreground',
  accent: 'bg-accent/15 text-accent',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
}

/** The per-node payload. React Flow requires an index signature on node data. */
type CardNodeData = {
  node: BoardViewNode
  kindLabel: string
  /** Attachments still drawn on the card (those placed as nodes of their own are left out). */
  attachments: BoardNodeAttachment[]
  size: NodeSize
  dimmed: boolean
  focused: boolean
  onRemove: (key: string) => void
  [key: string]: unknown
}

/** A bar sparkline of recent values, one neutral tone with a left-to-right opacity ramp. */
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null
  const max = Math.max(...values.map((v) => Math.abs(v)), 1)
  return (
    <div aria-hidden className={cn('pointer-events-none absolute flex items-end gap-[4px] opacity-35', className ?? 'inset-x-0 bottom-0 h-12')}>
      {values.map((v, i) => (
        <span
          key={i}
          className='flex-1 rounded-[1px]'
          style={{
            height: `${Math.max(12, (Math.abs(v) / max) * 100)}%`,
            background: 'var(--accent)',
            opacity: 0.1 + (i / Math.max(1, values.length - 1)) * 0.65,
          }}
        />
      ))}
    </div>
  )
}

function ProgressBar({ value, tone }: { value: number; tone: BoardTone }) {
  return (
    <div aria-hidden className='absolute inset-x-0 bottom-0 h-1 bg-border/50'>
      <div className={cn('h-full', TONE_BG[tone])} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  )
}

const pct = (n: number): string => `${Math.round(n * 100)}%`

/** The lead card's bar: progress in the health tone, a tick where the pace line is today. */
function PaceBar({ progress, pace, tone }: { progress: number | null; pace: number | null; tone: BoardTone }) {
  const clamp = (n: number): number => Math.max(0, Math.min(1, n))
  return (
    <div className='relative'>
      <div className='h-1.5 overflow-hidden rounded-full bg-border/60'>
        {progress != null && <div className={cn('h-full rounded-full', TONE_BG[tone])} style={{ width: `${clamp(progress) * 100}%` }} />}
      </div>
      {pace != null && (
        <span
          aria-hidden
          title={`Pace today: ${pct(pace)}`}
          className='absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-text/70'
          style={{ left: `${clamp(pace) * 100}%` }}
        />
      )}
    </div>
  )
}

/** The metric and work cards: title and value, a kind line, a bar or sparkline, a footer. */
function CardBody({ card, kindLabel }: { card: BoardNodeCard; kindLabel: string }) {
  const tone = card.badge?.tone ?? 'accent'
  const work = card.look === 'work'
  return (
    <>
      <div className='relative h-[78px] overflow-hidden rounded-t-[5px] px-3 py-2'>
        {card.sparkline && card.progress == null && <Sparkline values={card.sparkline} />}
        <div className='relative flex items-center gap-1.5'>
          {work && <FileText aria-hidden className='size-3.5 shrink-0 text-muted-foreground' />}
          <span className='min-w-0 flex-1 truncate text-body-sm font-medium text-text'>{card.title}</span>
          {card.value != null && (
            <span className='shrink-0 font-serif text-heading-3 leading-none text-text tabular-nums'>
              {card.value}
              {card.unit ? <span className='ml-1 text-label text-muted-foreground'>{card.unit}</span> : null}
            </span>
          )}
        </div>
        <div className='relative mt-1 flex items-baseline justify-between gap-2 text-label'>
          <span className='min-w-0 truncate text-muted-foreground' title={card.subtitle ?? undefined}>
            <span className='mr-1 uppercase tracking-wide opacity-70'>{kindLabel}</span>
            {card.subtitle}
          </span>
          {card.badge && <span className={cn('shrink-0 tabular-nums', TONE_TEXT[card.badge.tone])}>{card.badge.label}</span>}
        </div>
        {card.progress != null && <ProgressBar value={card.progress} tone={tone} />}
      </div>
      <div className='flex h-8 min-w-0 items-center gap-1.5 border-t border-border px-3 text-label'>
        <span className={cn('truncate', TONE_TEXT[card.footerTone ?? 'neutral'])} title={card.footer ?? undefined}>
          {card.footer}
        </span>
      </div>
    </>
  )
}

/** The lead card (a goal): what the board is about. Its number, target, pace and health, the
 *  signal's recent shape, and the work pushing on it. */
function LeadBody({ card, kindLabel, attachments }: { card: BoardNodeCard; kindLabel: string; attachments: BoardNodeAttachment[] }) {
  const tone = card.badge?.tone ?? 'accent'
  const shown = attachments.slice(0, ATTACHMENTS_SHOWN)
  const more = attachments.length - shown.length
  const [owner, ...rest] = (card.footer ?? '').split(' · ')
  return (
    <>
      <div className='relative flex h-[176px] flex-col overflow-hidden rounded-t-[9px] px-4 pt-3 pb-3'>
        <span aria-hidden className='absolute inset-x-0 top-0 h-[3px] bg-linear-to-r from-accent via-accent/70 to-accent/20' />
        {card.sparkline && <Sparkline values={card.sparkline} className='right-4 bottom-[52px] h-14 w-32' />}
        <div className='relative flex items-center gap-2 text-label'>
          <Target aria-hidden className='size-3.5 shrink-0 text-accent' />
          <span className='min-w-0 flex-1 truncate font-medium uppercase tracking-wider text-accent'>
            {kindLabel}
            {card.eyebrow ? <span className='text-muted-foreground'> · {card.eyebrow}</span> : null}
          </span>
          {card.badge && (
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 font-medium tabular-nums', TONE_PILL[card.badge.tone])}>{card.badge.label}</span>
          )}
        </div>
        <p className='relative mt-1.5 line-clamp-1 text-body font-semibold text-text' title={card.title}>
          {card.title}
        </p>
        <div className='relative mt-auto flex items-baseline gap-1.5'>
          <span className='font-serif text-heading-2 leading-none text-text tabular-nums'>{card.value ?? '-'}</span>
          {card.unit && <span className='text-label text-muted-foreground'>{card.unit}</span>}
          {card.target && <span className='ml-1 text-body-sm text-muted-foreground tabular-nums'>{card.target}</span>}
        </div>
        <div className='relative mt-2.5'>
          <PaceBar progress={card.progress ?? null} pace={card.pace ?? null} tone={tone} />
        </div>
        <div className='relative mt-2 flex items-center gap-2 text-label'>
          <span className='tabular-nums text-text'>{card.progress != null ? pct(card.progress) : 'no reading yet'}</span>
          {card.pace != null && <span className='tabular-nums text-muted-foreground'>pace {pct(card.pace)}</span>}
          <span className='ml-auto flex min-w-0 items-center gap-1.5'>
            {owner && <UserChip userId={owner} />}
            <span className={cn('truncate', TONE_TEXT[card.footerTone ?? 'neutral'])}>{rest.length ? rest.join(' · ') : owner}</span>
          </span>
        </div>
      </div>
      {shown.length > 0 && (
        <div className='flex flex-col border-t border-dashed border-border bg-bg/40 px-3 pt-2 pb-2'>
          {shown.map((a) => (
            <AttachmentRow key={a.key} a={a} />
          ))}
          {more > 0 && <p className='px-1 pt-0.5 text-label text-muted-foreground'>+{more} more initiative{more === 1 ? '' : 's'}</p>}
        </div>
      )}
    </>
  )
}

/** One initiative on its goal: a small "work" card. Clicking it opens the initiative. */
function AttachmentRow({ a }: { a: BoardNodeAttachment }) {
  const navigate = useNavigate()
  return (
    <button
      type='button'
      title={`${a.title} · ${a.status.label}`}
      onClick={(e) => {
        e.stopPropagation()
        void navigate({ to: a.href })
      }}
      className='nodrag group/att relative flex h-9 w-full items-center gap-2 overflow-hidden rounded-md border border-dashed border-border bg-surface px-2 text-left text-label hover:border-accent/60'
      style={{ marginBottom: 4 }}>
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', TONE_BG[a.status.tone])} />
      <FileText aria-hidden className='size-3 shrink-0 text-muted-foreground' />
      <span className='min-w-0 flex-1 truncate text-text group-hover/att:text-accent'>{a.title}</span>
      {a.meta && <span className='shrink-0 tabular-nums text-muted-foreground'>{a.meta}</span>}
      {a.owner && <UserChip userId={a.owner} />}
      {a.progress != null && (
        <span aria-hidden className='absolute inset-x-0 bottom-0 h-0.5 bg-border/40'>
          <span className={cn('block h-full', TONE_BG[a.status.tone])} style={{ width: `${Math.max(0, Math.min(1, a.progress)) * 100}%` }} />
        </span>
      )}
    </button>
  )
}

function CardNode({ data }: NodeProps<Node<CardNodeData>>) {
  const { node, kindLabel, attachments, size, dimmed, focused, onRemove } = data
  const card = node.card
  const look = card?.look ?? 'metric'
  return (
    <div
      style={{ width: size.w, height: size.h }}
      title={card?.title ?? node.ref}
      className={cn(
        'group relative flex flex-col border bg-surface transition-opacity',
        look === 'lead' ? 'rounded-[10px] shadow-(--shadow-glow)' : 'rounded-[6px] shadow-(--shadow-sm)',
        focused ? 'border-accent ring-2 ring-accent/40' : look === 'lead' ? 'border-accent/40' : 'border-border',
        (!card || look === 'work') && 'border-dashed',
        dimmed && 'opacity-25',
      )}>
      <Handle type='target' position={Position.Bottom} className='!size-1 !min-h-0 !min-w-0 !border-0 !opacity-0' />
      {/* Remove-from-board affordance. It never touches the object or its links. */}
      <button
        type='button'
        aria-label={`Remove ${card?.title ?? node.ref} from this board`}
        title='Remove from this board'
        onClick={(e) => {
          e.stopPropagation()
          onRemove(node.key)
        }}
        className='absolute -top-2 -right-2 z-10 hidden size-5 place-items-center rounded-full border border-border bg-surface text-muted-foreground shadow-(--shadow-sm) group-hover:grid hover:text-danger'>
        <X className='size-3' />
      </button>
      {card ? (
        look === 'lead' ? (
          <LeadBody card={card} kindLabel={kindLabel} attachments={attachments} />
        ) : (
          <CardBody card={card} kindLabel={kindLabel} />
        )
      ) : (
        <div className='grid h-full place-items-center px-3 text-center text-label text-warning'>
          {node.kind} {node.ref} no longer resolves
        </div>
      )}
      <Handle type='source' position={Position.Top} className='!size-1 !min-h-0 !min-w-0 !border-0 !opacity-0' />
    </div>
  )
}

const NODE_TYPES: NodeTypes = { card: CardNode }

/** The focused node's details: what it is, its links, and the way to open it or pull in its links. */
function FocusPanel({
  node,
  offBoard,
  onAddConnected,
  onClose,
}: {
  node: BoardViewNode
  offBoard: number
  onAddConnected: () => void
  onClose: () => void
}) {
  const navigate = useNavigate()
  const card = node.card
  return (
    <aside className='absolute top-3 right-3 z-10 w-64 rounded-lg border border-border bg-surface p-3 shadow-(--shadow-md)'>
      <div className='flex items-start gap-2'>
        <p className='min-w-0 flex-1 text-body-sm font-medium text-text'>{card?.title ?? node.ref}</p>
        <button type='button' aria-label='Close' onClick={onClose} className='text-muted-foreground hover:text-text'>
          <X className='size-3.5' />
        </button>
      </div>
      {card?.details && card.details.length > 0 && (
        <dl className='mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-label'>
          {card.details.map((d) => (
            <div key={d.label} className='contents'>
              <dt className='text-muted-foreground'>{d.label}</dt>
              <dd className='truncate text-text' title={d.value}>
                {d.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className='mt-3 flex flex-wrap gap-1'>
        {card && (
          <Button size='sm' variant='secondary' onClick={() => void navigate({ to: card.href })}>
            <ExternalLink /> Open
          </Button>
        )}
        <Button size='sm' variant='ghost' disabled={offBoard === 0} onClick={onAddConnected}>
          <Plus /> {offBoard === 0 ? 'All links on board' : `Add connected (${offBoard})`}
        </Button>
      </div>
    </aside>
  )
}

export interface CircuitBoardFlowProps {
  /** The resolved nodes (cards, neighbours) and edges. Positions come from `placements`. */
  nodes: BoardViewNode[]
  edges: { id: string; source: string; target: string }[]
  kinds: BoardKindInfo[]
  placements: BoardPlacement[]
  /** Every membership/position change (drag stop, remove, delete key) - the caller debounces. */
  onPlacements: (next: BoardPlacement[]) => void
  onArrange: () => void
  onAddConnected: (key: string) => void
  onTogglePicker: () => void
  pickerOpen: boolean
  /** Placements that resolve to nothing, from the server. */
  missing: number
}

export function CircuitBoardFlow({
  nodes: viewNodes,
  edges: viewEdges,
  kinds,
  placements,
  onPlacements,
  onArrange,
  onAddConnected,
  onTogglePicker,
  pickerOpen,
  missing,
}: CircuitBoardFlowProps) {
  const navigate = useNavigate()
  const [focus, setFocus] = useState<string | null>(null)
  const byKey = useMemo(() => new Map(viewNodes.map((n) => [n.key, n])), [viewNodes])
  const kindLabel = useMemo(() => new Map(kinds.map((k) => [k.kind, k.label.replace(/s$/, '')])), [kinds])

  // The path through the focused node: everything that moves it (down) and everything it moves
  // (up). This is the "where is the red coming from" affordance - the rest dims out.
  const chain = useMemo(() => {
    if (!focus) return null
    const up = new Map<string, string[]>()
    const down = new Map<string, string[]>()
    for (const e of viewEdges) {
      up.set(e.source, [...(up.get(e.source) ?? []), e.target])
      down.set(e.target, [...(down.get(e.target) ?? []), e.source])
    }
    const walk = (from: string, adj: Map<string, string[]>): string[] => {
      const seen = new Set<string>()
      const stack = [from]
      while (stack.length > 0) {
        const cur = stack.pop()!
        for (const next of adj.get(cur) ?? []) {
          if (seen.has(next)) continue
          seen.add(next)
          stack.push(next)
        }
      }
      return [...seen]
    }
    return new Set<string>([focus, ...walk(focus, up), ...walk(focus, down)])
  }, [viewEdges, focus])

  const remove = useCallback(
    (key: string) => {
      if (focus === key) setFocus(null)
      onPlacements(placements.filter((p) => placementKey(p) !== key))
    },
    [placements, onPlacements, focus],
  )

  const onBoard = useMemo(() => new Set(placements.map(placementKey)), [placements])
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CardNodeData>>([])
  // Seeding is keyed on a SIGNATURE of the placements, not their array identity: a refreshed view
  // must not re-seed positions and yank a node mid-drag, while a real membership/position change -
  // including the one we just reported upward - must.
  const signature = useMemo(() => placements.map((p) => `${placementKey(p)}@${p.x},${p.y}`).join('|'), [placements])
  // A seed that arrives WHILE a node is under the pointer is deferred to drag-stop.
  const dragging = useRef(false)
  const deferredSeed = useRef(false)
  const [seedTick, setSeedTick] = useState(0)
  useEffect(() => {
    if (dragging.current) {
      deferredSeed.current = true
      return
    }
    setNodes(
      placements.map((p) => ({
        id: placementKey(p),
        type: 'card',
        position: { x: p.x, y: p.y },
        data: {} as CardNodeData, // filled in by `decorated` below, from the live view
        draggable: true,
      })),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` IS the placement content
  }, [signature, seedTick, setNodes])

  const decorated = useMemo(
    () =>
      nodes.flatMap((n) => {
        const node = byKey.get(n.id)
        if (!node) return [] // placed locally, not yet in the server's view: drawn after the next refetch
        const attachments = visibleAttachments(node, onBoard)
        const size = cardSize(node.card?.look, attachments.length)
        return [
          {
            ...n,
            width: size.w,
            height: size.h,
            data: {
              node,
              attachments,
              size,
              kindLabel: kindLabel.get(node.kind) ?? node.kind,
              dimmed: !!chain && !chain.has(n.id),
              focused: focus === n.id,
              onRemove: remove,
            } satisfies CardNodeData,
          },
        ]
      }),
    [nodes, byKey, kindLabel, chain, focus, remove, onBoard],
  )
  const edges = useMemo<Edge[]>(
    () =>
      viewEdges
        .filter((e) => onBoard.has(e.source) && onBoard.has(e.target))
        .map((e) => {
          const inChain = !chain || (chain.has(e.source) && chain.has(e.target))
          // An edge into a lead card (a signal into its goal) is the board's main line.
          const lead = byKey.get(e.target)?.card?.look === 'lead'
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            type: 'smoothstep',
            pathOptions: { borderRadius: 12 },
            animated: !!chain && inChain,
            style: { stroke: 'var(--accent)', strokeWidth: lead ? 2.5 : 1.5, opacity: inChain ? (lead ? 1 : 0.75) : 0.12 },
          }
        }),
    [viewEdges, chain, onBoard, byKey],
  )

  const focused = focus ? byKey.get(focus) : undefined
  const offBoard = focused ? connectable(focused, onBoard).length : 0

  return (
    <div className='circuit-board flex h-full w-full flex-col'>
      {/* A real row, not an overlay: React Flow's attribution lives bottom-right of the canvas and
          the license requires it stay legible. */}
      <div className='flex items-center justify-between gap-3 border-b border-border px-4 py-1.5 md:px-8'>
        <p className='text-label text-muted-foreground'>
          Click a node to trace its path · double-click to open · drag to arrange - positions save automatically.
          {missing > 0 && <span className='text-warning'> {missing} placement(s) no longer resolve.</span>}
        </p>
        <div className='flex shrink-0 items-center gap-1'>
          <Button size='sm' variant='ghost' onClick={onArrange}>
            Arrange
          </Button>
          <Button size='sm' variant={pickerOpen ? 'secondary' : 'ghost'} onClick={onTogglePicker}>
            Add nodes
          </Button>
        </div>
      </div>
      <div className='relative min-h-0 flex-1'>
        <ReactFlow
          nodes={decorated}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeDragStart={() => {
            dragging.current = true
          }}
          onNodeDragStop={(_, __, dragged) => {
            dragging.current = false
            onPlacements(
              placements.map((p) => {
                const moved = dragged.find((d) => d.id === placementKey(p))
                return moved ? { ...p, x: moved.position.x, y: moved.position.y } : p
              }),
            )
            if (deferredSeed.current) {
              deferredSeed.current = false
              setSeedTick((t) => t + 1)
            }
          }}
          onNodesDelete={(deleted) => onPlacements(placements.filter((p) => !deleted.some((d) => d.id === placementKey(p))))}
          onNodeClick={(_, n) => setFocus((cur) => (cur === n.id ? null : n.id))}
          onNodeDoubleClick={(_, n) => {
            const href = byKey.get(n.id)?.card?.href
            if (href) void navigate({ to: href })
          }}
          onPaneClick={() => setFocus(null)}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          minZoom={0.2}
          snapToGrid
          snapGrid={[GRID, GRID]}
          proOptions={{ hideAttribution: false }}
          nodesConnectable={false}
          // Edges come from the objects (a signal's drivers, a goal's signal, an initiative's goals)
          // and are edited there - never drawn here by dragging.
          edgesFocusable={false}
          defaultEdgeOptions={{ type: 'smoothstep' }}>
          <Background variant={BackgroundVariant.Dots} gap={GRID} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
        {focused && (
          <FocusPanel node={focused} offBoard={offBoard} onAddConnected={() => onAddConnected(focused.key)} onClose={() => setFocus(null)} />
        )}
      </div>
    </div>
  )
}
