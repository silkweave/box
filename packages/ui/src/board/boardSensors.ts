import { KeyboardCode, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useSensor, useSensors, type CollisionDetection, type KeyboardCoordinateGetter } from '@dnd-kit/core'
import { CLICK_SLOP } from './DraggableCard.tsx'

const DIRECTIONS: Record<string, [number, number]> = {
  [KeyboardCode.Right]: [1, 0],
  [KeyboardCode.Left]: [-1, 0],
  [KeyboardCode.Down]: [0, 1],
  [KeyboardCode.Up]: [0, -1],
}

/** `v` clamped to [lo, hi]; the middle when the range is empty (a target smaller than the card). */
const within = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi))

/**
 * Arrow keys move a lifted card to the nearest drop target in that direction (a column, a cell),
 * instead of dnd-kit's default 25 pixels a press, which on a board is many presses per column.
 */
export const dropTargetCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const dir = DIRECTIONS[event.code]
  const { collisionRect, droppableRects, droppableContainers, over } = context
  if (!dir || !collisionRect) return undefined
  event.preventDefault()
  const cx = collisionRect.left + collisionRect.width / 2
  const cy = collisionRect.top + collisionRect.height / 2
  let best: { x: number; y: number; score: number } | null = null
  for (const container of droppableContainers.getEnabled()) {
    if (container.id === over?.id) continue
    const rect = droppableRects.get(container.id)
    if (!rect) continue
    // The nearest place the card would sit fully inside the target: a card low in a tall column
    // moves straight across to the same height in the next column, not up to its top.
    const tx = within(cx, rect.left + collisionRect.width / 2, rect.left + rect.width - collisionRect.width / 2)
    const ty = within(cy, rect.top + collisionRect.height / 2, rect.top + rect.height - collisionRect.height / 2)
    const dx = tx - cx
    const dy = ty - cy
    // Ahead of the card along the arrow, and not further off to the side than ahead.
    const ahead = dx * dir[0] + dy * dir[1]
    const side = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0])
    if (ahead <= 1 || side > ahead * 2) continue
    const score = ahead + side * 2
    if (!best || score < best.score) best = { x: tx, y: ty, score }
  }
  if (!best) return currentCoordinates
  return {
    x: currentCoordinates.x + (best.x - cx),
    y: currentCoordinates.y + (best.y - cy),
  }
}

/**
 * The sensors every board's `DndContext` takes: the pointer with the click-vs-drag threshold, and
 * the keyboard (Space lifts and drops, arrows move between drop targets, Escape puts it back).
 * Enter is left to open the card, so a surface card can be opened and dragged from the keyboard.
 * Use it for: `BoardKanban` (it does) and any custom board built on `DraggableCard`.
 */
export function useBoardSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: CLICK_SLOP } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: dropTargetCoordinates,
      keyboardCodes: { start: [KeyboardCode.Space], cancel: [KeyboardCode.Esc], end: [KeyboardCode.Space, KeyboardCode.Enter] },
    }),
  )
}

/**
 * The collision detection that goes with `useBoardSensors`: the target under the pointer for a
 * pointer drag, the target the card overlaps most for a keyboard drag (which has no pointer, so
 * `pointerWithin` alone finds nothing and the drop is lost).
 */
export const boardCollision: CollisionDetection = (args) => (args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args))
