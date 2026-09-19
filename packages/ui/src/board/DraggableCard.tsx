// The card frame every board drags: the dnd-kit wiring, the two drag affordances, and the
// click-vs-drag measurement. What is INSIDE the card is always the app's.
//
// It unifies two frames that were written separately and had already converged on the same lessons
// (the overlay copy needs its own id; a small distance threshold is what tells a click from a drag):
// the kanban card, whose grip is the handle so the body stays clickable, and the sprint card, which
// is draggable across its whole surface because a dense grid of small cards has no room for a grip.
// That is the `handle` prop and nothing else had to differ.
//
// THE SOURCE CARD DOES NOT FOLLOW THE POINTER. Every board here renders a `<DragOverlay>`, which is
// the copy that moves; translating the original as well means two cards travelling together, and
// the faded original is meant to be the hole the card came out of.

import { useRef, type ReactNode } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { GripVertical } from 'lucide-react'
import { cn } from '../lib/utils.ts'

/** How far the pointer may travel between down and up and still count as a click, not a drag. It is
 *  measured here rather than taken from dnd-kit because a drag that ends on the card it started on
 *  still fires a click. */
export const CLICK_SLOP = 6

export interface DraggableCardProps {
  /** The row's id. The overlay copy takes `overlay:<id>` internally - two live draggables sharing
   *  one id makes dnd-kit resolve the wrong node while a drag is in flight. */
  id: string
  /** Accessible name of the thing being dragged, e.g. the row's title. */
  label: string
  /**
   * `grip` puts the drag on a handle that appears on hover, leaving the body clickable and its text
   * selectable - right for a wide card carrying links and buttons. `surface` makes the whole card
   * the drag target and reports a non-drag press through `onClick` - right for a dense card that is
   * a label rather than a form.
   */
  handle?: 'grip' | 'surface'
  /** False on a board where dragging has no meaning: no grip, no listeners, no touch-action. */
  draggable?: boolean
  /** This is the copy inside a `<DragOverlay>`: same geometry, no listeners of its own. */
  overlay?: boolean
  /** Payload dnd-kit carries on `active.data.current`, for a drop handler that wants the row. */
  data?: Record<string, unknown>
  /** A press that was not a drag. */
  onClick?: () => void
  title?: string
  className?: string
  children: ReactNode
}

export function DraggableCard({
  id,
  label,
  handle = 'grip',
  draggable = true,
  overlay = false,
  data,
  onClick,
  title,
  className,
  children,
}: DraggableCardProps) {
  const grip = handle === 'grip'
  // The overlay copy keeps the frame but never the wiring.
  const live = draggable && !overlay
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: overlay ? `overlay:${id}` : id,
    data,
    disabled: !live,
  })
  const surfaceDrag = live && !grip
  const down = useRef<{ x: number; y: number } | null>(null)

  return (
    <article
      ref={setNodeRef}
      {...(surfaceDrag ? { ...listeners, ...attributes } : {})}
      // Spread AFTER the listeners on purpose: this replaces dnd-kit's own `onPointerDown`, so it
      // has to call it on the way past.
      onPointerDown={(e) => {
        down.current = { x: e.clientX, y: e.clientY }
        if (surfaceDrag) listeners?.onPointerDown?.(e)
      }}
      onClick={
        onClick &&
        ((e) => {
          const from = down.current
          down.current = null
          // No recorded press at all is not ours to act on.
          if (!from) return
          if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > CLICK_SLOP) return
          onClick()
        })
      }
      title={title}
      className={cn(
        // No resting shadow on a surface card: a cell of cards each casting one reads as a pile of
        // chips rather than a list. The lift is reserved for the two states where it MEANS
        // something - the card under the pointer, and the card in the air.
        'group/card rounded-md border border-border bg-bg outline-none',
        'transition-[color,background-color,border-color,box-shadow,opacity]',
        grip ? 'p-2.5 shadow-(--shadow-sm)' : 'p-2 text-left',
        surfaceDrag && 'cursor-grab touch-none hover:border-border-strong hover:shadow-(--shadow-sm)',
        onClick && 'focus-visible:border-accent',
        isDragging && 'opacity-40',
        overlay && 'cursor-grabbing shadow-md',
        className,
      )}>
      {grip ? (
        <div className='flex items-start gap-1'>
          {/* Drawn for the overlay too, inert: without it the copy in the air is 18px narrower than
              the hole it left behind. */}
          {draggable && (
            <button
              type='button'
              ref={live ? setActivatorNodeRef : undefined}
              {...(live ? { ...listeners, ...attributes } : { tabIndex: -1, 'aria-hidden': true })}
              aria-label={`Drag ${label}`}
              className='-ml-1 mt-0.5 cursor-grab touch-none rounded p-0.5 text-fg-4 opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100'>
              <GripVertical className='size-3.5' />
            </button>
          )}
          <div className='min-w-0 flex-1'>{children}</div>
        </div>
      ) : (
        children
      )}
    </article>
  )
}
