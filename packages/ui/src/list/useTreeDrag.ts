// Drag to reorder and nest, for the DataGrid's flat tree.
//
// DRAGGING SHOWS THE RESULT. Nothing floats under the pointer: while a row is dragged the list is
// drawn as it would be after the drop, the row itself in its new slot at its new depth and the
// others moved aside. Releasing commits exactly what is on screen, never a recomputation.
//
// The slot comes from the vertical pointer travel measured against the row heights taken when the
// drag starts, not from what is under the pointer, so rows moving aside never feed back into the
// choice. The depth comes from the horizontal travel in whole steps (`nestLevels`). The vertical
// travel is the pointer's, measured against the list's own position on screen, so scrolling any
// ancestor (or the page) counts; dnd-kit's delta is relative to the dragged node's current box,
// which moves here as the row takes its new slot. dnd-kit still does what it is good at: activation
// (a 6px move) and scrolling near the edges.
//
// The geometry is taken once, so a drag only lives while the rows keep their shape: if rows come or
// go mid-drag (a refetch, another user) or drag stops being offered, the drag is cancelled rather
// than steered by a stale frame.
//
// Pressing a handle folds the row's subtree at once, so the rows below close up before the drag
// activates; a release without a drag unfolds it again. The handle also moves by keyboard: arrows
// up and down move one slot, right and left nest under the row above or lift out.

import { useEffect, useRef, useState, type RefObject } from 'react'
import { PointerSensor, useSensor, useSensors, type DragStartEvent } from '@dnd-kit/core'
import { NEST_STEP } from './geometry.ts'
import { nestLevels, projectDrop, withoutSubtree, type DropRules, type Projection, type TreeNode } from './tree.ts'

/** Scroll only vertically and only close to the edge: a sideways push nests, it never scrolls. */
const AUTO_SCROLL = { threshold: { x: 0, y: 0.1 }, acceleration: 8 }

/** Geometry at drag start. */
interface Frame {
  /** tops[k] = the offset slot k starts at (k = 0..others.length), relative to the first row. */
  tops: number[]
  /** Where the dragged row started, on the same scale. */
  start: number
  /** The pointer, relative to the list's top, at the start. */
  pointer: { x: number; y: number }
}

const shapeOf = <T,>(nodes: readonly TreeNode<T>[]): string => nodes.map((n) => n.id).join('\n')

export interface TreeDragOptions<T> {
  /** The rows as drawn, with `fold` (the pressed or dragged row) folded on top of the user's folds. */
  flatten: (fold: string | null) => TreeNode<T>[]
  /** The rules for moving row `id` (its depth limit, what it carries, where it may go). */
  rules: (id: string) => DropRules
  /** Drag is offered in this view. */
  enabled: boolean
  /** The element holding the rows (`[data-row]`). */
  list: RefObject<HTMLElement | null>
  /** Announces a render whose layout change should glide (see `useGlide`). */
  glideNext: () => void
  /** A move to commit: row `id` lands where `projection` says. */
  onCommit: (id: string, projection: Projection) => void
}

/** Slot indexes ordered by how close each slot's top is to `y`. */
function slotsNear(tops: readonly number[], y: number): number[] {
  return tops.map((_, k) => k).sort((a, b) => Math.abs(tops[a] - y) - Math.abs(tops[b] - y))
}

export function useTreeDrag<T>({ flatten, rules, enabled, list, glideNext, onCommit }: TreeDragOptions<T>) {
  // `shape`: the rows' ids in order at the start; a drag only lives while they hold.
  const [drag, setDrag] = useState<{ id: string; slot: number; levels: number; shape: string } | null>(null)
  const [pressed, setPressed] = useState<string | null>(null)
  const frame = useRef<Frame | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  // A press ends with a release anywhere; the drag (if one started) has its own end.
  useEffect(() => {
    if (!pressed) return
    const release = (): void => {
      glideNext()
      setPressed(null)
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [pressed, glideNext])

  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const track = (e: PointerEvent): void => {
      pointer.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointermove', track, { capture: true })
    return () => window.removeEventListener('pointermove', track, { capture: true })
  }, [dragging])

  const nodes = flatten(drag?.id ?? pressed)
  const stale = drag !== null && (!enabled || drag.shape !== shapeOf(nodes))
  const projection = drag && !stale ? projectDrop(nodes, drag.id, drag.slot, drag.levels, rules(drag.id)) : null

  // During a drag the list is drawn in its after-drop order. A slot no depth fits never gets chosen
  // (see `onDragMove`), so a null projection only means the row went away mid-drag.
  let drawn = nodes
  if (drag && projection) {
    const active = nodes.find((n) => n.id === drag.id)
    if (active) {
      drawn = nodes.filter((n) => n.id !== drag.id)
      drawn.splice(Math.min(drag.slot, drawn.length), 0, active)
    }
  }

  const onDragStart = (e: DragStartEvent): void => {
    const id = String(e.active.id)
    const el = list.current
    const at = nodes.findIndex((n) => n.id === id)
    if (!el || at < 0) return
    const rowEls = new Map([...el.querySelectorAll<HTMLElement>('[data-row]')].map((r) => [r.dataset.row ?? '', r]))
    // Measured without the dragged row's subtree, which folds away with it.
    const others = withoutSubtree(nodes, id).filter((n) => n.id !== id)
    // Each slot's top as it would sit with the dragged row taken out: the rows below it move up by
    // its height. Measured positions, not summed heights, so anything drawn between rows (a group
    // header) keeps its place in the frame.
    const origin = rowEls.get(nodes[0].id)?.offsetTop ?? 0
    const self = rowEls.get(id)
    const selfTop = self?.offsetTop ?? 0
    const selfHeight = self?.offsetHeight ?? 0
    const topOf = (el: HTMLElement | undefined): number => (el ? el.offsetTop - origin - (el.offsetTop > selfTop ? selfHeight : 0) : 0)
    const tops = others.map((n) => topOf(rowEls.get(n.id)))
    const last = rowEls.get(others[others.length - 1]?.id ?? '')
    tops.push(last ? topOf(last) + last.offsetHeight : 0)
    const { clientX = 0, clientY = 0 } = e.activatorEvent as PointerEvent
    pointer.current = { x: clientX, y: clientY }
    frame.current = { tops, start: (rowEls.get(id)?.offsetTop ?? 0) - origin, pointer: { x: clientX, y: clientY - el.getBoundingClientRect().top } }
    glideNext()
    setDrag({ id, slot: at, levels: 0, shape: shapeOf(nodes) })
  }

  const onDragMove = (): void => {
    const f = frame.current
    const el = list.current
    if (!f || !el || !drag || stale) return
    const dx = pointer.current.x - f.pointer.x
    const dy = pointer.current.y - el.getBoundingClientRect().top - f.pointer.y
    const levels = nestLevels(dx, NEST_STEP)
    const r = rules(drag.id)
    const slot = slotsNear(f.tops, f.start + dy).find((k) => projectDrop(nodes, drag.id, k, levels, r) !== null)
    if (slot === undefined || (slot === drag.slot && levels === drag.levels)) return
    glideNext()
    setDrag({ ...drag, slot, levels })
  }

  const end = (commit: boolean): void => {
    glideNext()
    frame.current = null
    setDrag(null)
    if (commit && drag && projection) onCommit(drag.id, projection)
  }

  // A stale drag ends as a cancel. The rows already draw unmoved; this clears the drag itself.
  useEffect(() => {
    if (!stale) return
    frame.current = null
    setDrag(null)
  }, [stale])

  /** Moves row `id` one step by keyboard. Returns whether the key was a move key. */
  const keyMove = (id: string, key: string): boolean => {
    if (key !== 'ArrowUp' && key !== 'ArrowDown' && key !== 'ArrowLeft' && key !== 'ArrowRight') return false
    const view = withoutSubtree(nodes, id)
    const at = view.findIndex((n) => n.id === id)
    if (at < 0) return true
    const slot = at + (key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0)
    const levels = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0
    const p = projectDrop(view, id, slot, levels, rules(id))
    if (p) {
      glideNext()
      onCommit(id, p)
    }
    return true
  }

  return {
    /** The rows in tree order (folds applied), before any drag reordering. */
    nodes,
    /** The rows as drawn: during a drag, in after-drop order. */
    drawn,
    /** The dragged row and where it lands; null when nothing is dragged. */
    active: drag && projection ? { id: drag.id, projection } : null,
    /** The handle of row `id` went down. */
    press: (id: string): void => {
      if (!enabled) return
      glideNext()
      setPressed(id)
    },
    keyMove,
    /** Spread on the `DndContext`. */
    dnd: {
      sensors,
      autoScroll: AUTO_SCROLL,
      onDragStart,
      onDragMove,
      onDragEnd: () => end(true),
      onDragCancel: () => end(false),
    },
  }
}
