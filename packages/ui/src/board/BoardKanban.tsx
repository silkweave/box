// The board layout, for every module that has one: columns you drag cards between.
//
// It used to be two files - one per module - built the same way on purpose and then kept in step by
// hand. What is actually shared is everything structural: the DndContext and its activation
// threshold, bucketing rows into columns, the column shell (icon, label, count, the "terminal
// columns look like an exit" rule), the drag overlay, and the card frame. What differs is only ever
// the CARD BODY and the rule for whether a drop is allowed - so those two are the props, and nothing
// else needed to be.
//
// There is deliberately no manual ordering WITHIN a column: a position there would be a stored field
// nobody maintains, so each column takes the order the caller hands it in and stays honest.

import { useState, type ReactNode } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { cn } from '../lib/utils.ts'
import { CLICK_SLOP, DraggableCard } from './DraggableCard.tsx'
import type { NavIcon } from '../shell/Sidebar.tsx'

export interface KanbanColumn {
  /** The stored value this column holds - also the droppable id. */
  key: string
  label: string
  icon: NavIcon
  /** Text-colour class for the icon and title. */
  color: string
  /** True for a column that is an exit rather than a stage being worked; it renders visibly flatter. */
  terminal?: boolean
}

export function BoardKanban<T>({
  items,
  columns,
  columnOf,
  idOf,
  onDrop,
  renderCard,
  renderColumnBadge,
  cardLabel,
  emptyLabel = 'Nothing here',
  dropLabel = 'Drop to move here',
}: {
  /** Already filtered and sorted by the caller - this component only buckets. */
  items: T[]
  columns: KanbanColumn[]
  /** Which column a row belongs to. */
  columnOf: (item: T) => string
  idOf: (item: T) => string
  /**
   * A card was dropped on a column it did not come from. The caller decides what that means and
   * whether to allow it - a board that refuses a move can show the same dialog its list shows,
   * rather than writing and apologising afterwards.
   *
   * OMIT IT for a board where dragging has no single meaning: the cards then carry no grip and
   * nothing is droppable, which is the honest rendering of "this column is derived".
   */
  onDrop?: (item: T, column: string) => void
  renderCard: (item: T) => ReactNode
  /** The right-hand side of a column header, e.g. a column total. */
  renderColumnBadge?: (column: string, items: T[]) => ReactNode
  /** Accessible name for a card's drag handle. */
  cardLabel: (item: T) => string
  /** What an empty column says. English, so it is a prop: the caller names its own rows. */
  emptyLabel?: string
  /** What an empty column says while a card hovers over it. */
  dropLabel?: string
}) {
  const [dragging, setDragging] = useState<T | null>(null)
  // A small distance threshold keeps a click-to-open from being read as a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: CLICK_SLOP } }))

  const buckets = new Map<string, T[]>(columns.map((c) => [c.key, []]))
  for (const item of items) buckets.get(columnOf(item))?.push(item)

  const find = (id: string): T | undefined => items.find((i) => idOf(i) === id)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e: DragStartEvent) => setDragging(find(String(e.active.id)) ?? null)}
      onDragEnd={(e: DragEndEvent) => {
        setDragging(null)
        const { active, over } = e
        if (!over) return
        const item = find(String(active.id))
        const target = String(over.id)
        if (!item || columnOf(item) === target) return
        if (!columns.some((c) => c.key === target)) return
        onDrop?.(item, target)
      }}>
      <div className='flex gap-3 overflow-x-auto pb-4'>
        {columns.map((column) => {
          const held = buckets.get(column.key) ?? []
          return (
            <Column
              key={column.key}
              column={column}
              count={held.length}
              badge={renderColumnBadge?.(column.key, held)}
              emptyLabel={emptyLabel}
              dropLabel={dropLabel}>
              {held.map((item) => (
                <DraggableCard key={idOf(item)} id={idOf(item)} label={cardLabel(item)} draggable={!!onDrop}>
                  {renderCard(item)}
                </DraggableCard>
              ))}
            </Column>
          )
        })}
      </div>
      <DragOverlay>
        {dragging && (
          <DraggableCard id={idOf(dragging)} label={cardLabel(dragging)} draggable={!!onDrop} overlay>
            {renderCard(dragging)}
          </DraggableCard>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function Column({
  column,
  count,
  badge,
  emptyLabel,
  dropLabel,
  children,
}: {
  column: KanbanColumn
  count: number
  badge?: ReactNode
  emptyLabel: string
  dropLabel: string
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key })
  const { icon: Icon, color } = column

  return (
    <section
      ref={setNodeRef}
      aria-label={column.label}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-lg border bg-surface transition-colors',
        isOver ? 'border-accent bg-accent-tint/40' : 'border-border',
        // Terminal columns are visibly an exit, not a stage you are working.
        column.terminal && !isOver && 'bg-bg',
      )}>
      <header className='flex items-center gap-1.5 border-b border-border px-3 py-2'>
        <Icon className={cn('size-3.5 shrink-0', color)} />
        <span className={cn('truncate text-body-sm font-medium', color)}>{column.label}</span>
        <span className='ml-auto shrink-0 text-label tabular-nums text-muted-foreground'>
          {count}
          {badge && <span className='ml-1.5'>{badge}</span>}
        </span>
      </header>
      <div className='flex min-h-24 flex-col gap-2 p-2'>
        {count === 0 ? (
          <p className='px-1 py-4 text-center text-label text-muted-foreground'>{isOver ? dropLabel : emptyLabel}</p>
        ) : (
          children
        )}
      </div>
    </section>
  )
}
