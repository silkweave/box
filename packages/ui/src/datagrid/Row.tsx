// One DataGrid row in the list layout: the name cell (indentation, fold chevron, mark/handle, name),
// the column cells, and the trailing actions. Pure presentation; the grid decides everything.

import type { CSSProperties, PointerEvent, ReactNode } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { ChevronRight, GripVertical } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { GAP, MARK, ROW_HEIGHT, TOGGLE } from './geometry.ts'
import type { Projection } from './tree.ts'

export interface RowProps {
  id: string
  /** The row in words, for its controls' labels. */
  label: string
  depth: number
  /** px of indentation at a depth (the grid's rule; the drop ticks use it too). */
  indentOf: (depth: number) => number
  template: string
  nameCell: ReactNode
  /** Leading icon columns' cells, before the name. */
  leadCells?: ReactNode
  cells: ReactNode
  actions?: ReactNode

  /** The grid nests: draw the chevron slot. */
  nests: boolean
  childCount: number
  open: boolean
  /** `deep`: the whole subtree too (Shift-click). */
  onToggle: (deep: boolean) => void

  /** Draw the mark slot (the row has an icon or can be moved in some view). */
  handle: boolean
  mark?: ReactNode
  /** The handle is live in this view. */
  draggable: boolean
  /** Why it is not, shown on the mark when the grid can be dragged in another view. */
  dragHint?: string
  /** The handle went down (the grid folds the row's subtree before the drag starts). */
  onPress: () => void
  /** A key on the focused handle; returns whether it was a move key. */
  onMoveKey: (key: string) => boolean
  /** The id of the element that explains the handle's keys. */
  moveHelpId?: string

  /** Set on the dragged row: where it lands. */
  drop: Projection | null
  /** The row the dragged one would nest under. */
  target: boolean
  selected: boolean
  /** Opens the row: a click anywhere on it, or the name, which is a button for the keyboard. */
  onClick?: () => void
  /** Extra style for the name cell (a frozen column's stickiness). */
  nameStyle?: CSSProperties
}

const toggleTitle = (open: boolean): string => `${open ? 'Collapse' : 'Expand'} (Shift: with everything under it)`

export function Row({
  id,
  label,
  depth,
  indentOf,
  template,
  nameCell,
  leadCells,
  cells,
  actions,
  nests,
  childCount,
  open,
  onToggle,
  handle,
  mark,
  draggable,
  dragHint,
  onPress,
  onMoveKey,
  moveHelpId,
  drop,
  target,
  selected,
  onClick,
  nameStyle,
}: RowProps) {
  const d = useDraggable({ id, disabled: !draggable })
  const lifted = d.isDragging && drop !== null

  return (
    <div
      ref={d.setNodeRef}
      data-row={id}
      aria-current={selected || undefined}
      onClick={onClick}
      style={{ gridTemplateColumns: template, height: ROW_HEIGHT }}
      // The tint is a variable, not a background class, so a frozen name cell (opaque, so the columns
      // scrolling under it stay hidden) can paint it over the row surface too.
      className={cn(
        'group relative grid items-center gap-2 border-b border-border bg-(--row-tint) px-[var(--grid-pad,0.5rem)] text-body-sm text-text [--row-tint:transparent]',
        onClick && 'cursor-pointer',
        selected ? '[--row-tint:color-mix(in_oklab,var(--accent-tint)_50%,transparent)]' : !lifted && 'hover:[--row-tint:color-mix(in_oklab,var(--accent-tint)_30%,transparent)]',
        // The bar runs over the row's own bottom border (-bottom-px), so it meets the dragged row's
        // outline below with no gap; above the frozen cells (z-20).
        target &&
          "[--row-tint:color-mix(in_oklab,var(--accent-tint)_60%,transparent)] before:pointer-events-none before:absolute before:top-0 before:-bottom-px before:left-0 before:z-20 before:w-0.5 before:bg-accent before:content-['']",
        // The outline is an overlay above the frozen cells (z-20): an outline on the row itself is
        // painted under them, so the opaque frozen cells would cut it.
        lifted &&
          "z-10 bg-(--row-surface) shadow-(--shadow-md) after:pointer-events-none after:absolute after:inset-0 after:z-20 after:border after:border-accent after:content-['']",
      )}>
      {leadCells}
      <div className='relative flex h-full min-w-0 items-center' style={{ ...nameStyle, gap: GAP }}>
        {/* In the name cell, which a frozen grid keeps in view, so they do not scroll away with the row. */}
        {lifted && <DepthTicks drop={drop} indentOf={indentOf} />}
        <div className='flex min-w-0 flex-1 items-center transition-[padding] duration-100' style={{ gap: GAP, paddingLeft: indentOf(depth) }}>
          {handle &&
            (draggable ? (
              <button
                type='button'
                aria-label={`Move ${label}`}
                aria-describedby={moveHelpId}
                title={nests ? 'Drag to move; push right to nest under the row above, left to lift out. Arrow keys move it too.' : 'Drag to move. Arrow keys move it too.'}
                {...d.listeners}
                onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
                  d.listeners?.onPointerDown?.(e)
                  if (e.button === 0) onPress()
                }}
                onKeyDown={(e) => {
                  if (onMoveKey(e.key)) e.preventDefault()
                }}
                onClick={(e) => e.stopPropagation()}
                style={{ width: MARK }}
                className='group/handle grid h-5 shrink-0 cursor-grab grid-cols-[minmax(0,1fr)] place-items-center rounded touch-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-accent/50'>
                {/* Mark and grip share one cell and cross-fade: the icon gives way to the grip on hover or
                    keyboard focus (not plain focus, which a mouse drag leaves on the handle). */}
                <span
                  className={cn(
                    'flex items-center justify-center transition-[opacity,scale] duration-150 [grid-area:1/1]',
                    lifted ? 'scale-50 opacity-0' : 'group-hover:scale-50 group-hover:opacity-0 group-focus-visible/handle:scale-50 group-focus-visible/handle:opacity-0',
                  )}>
                  {mark}
                </span>
                <GripVertical
                  className={cn(
                    'size-3.5 text-muted-foreground transition-[opacity,scale] duration-150 [grid-area:1/1]',
                    lifted ? 'scale-100 opacity-100' : 'scale-50 opacity-0 group-hover:scale-100 group-hover:opacity-100 group-focus-visible/handle:scale-100 group-focus-visible/handle:opacity-100',
                  )}
                />
              </button>
            ) : (
              <span title={dragHint} className='flex h-5 shrink-0 items-center justify-center' style={{ width: MARK }}>
                {mark}
              </span>
            ))}
          {onClick ? (
            <button
              type='button'
              onClick={(e) => {
                e.stopPropagation()
                onClick()
              }}
              className='min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/50'>
              {nameCell}
            </button>
          ) : (
            <div className='min-w-0 flex-1'>{nameCell}</div>
          )}
        </div>
        {nests && (
          <span className='flex h-full shrink-0 items-center justify-center' style={{ width: TOGGLE }}>
            {childCount > 0 && (
              <button
                type='button'
                aria-expanded={open}
                aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
                title={toggleTitle(open)}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(e.shiftKey)
                }}
                className='flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent-tint hover:text-text'>
                <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
              </button>
            )}
          </span>
        )}
      </div>
      {cells}
      <div className='flex items-center justify-end gap-0.5' onClick={(e) => e.stopPropagation()}>
        {actions}
      </div>
    </div>
  )
}

/**
 * Along the dragged row's bottom edge: a tick under the mark slot of every depth its slot allows, the chosen one
 * in the accent, so a horizontal push has visible steps to snap to.
 */
function DepthTicks({ drop, indentOf }: { drop: Projection; indentOf: (depth: number) => number }) {
  if (drop.depths.length < 2) return null
  return (
    // Half pills inside the row, standing on the outline overlay's bottom border (bottom-px).
    <span aria-hidden className='pointer-events-none absolute inset-x-0 bottom-px h-1'>
      {drop.depths.map((d) => (
        <span
          key={d}
          className={cn('absolute inset-y-0 rounded-t-sm transition-colors', d === drop.depth ? 'bg-accent' : 'bg-accent/30')}
          style={{ left: indentOf(d), width: MARK }}
        />
      ))}
    </span>
  )
}
