import { describe, expect, it } from 'bun:test'
import { KeyboardCode } from '@dnd-kit/core'
import { dropTargetCoordinates } from './boardSensors.ts'

type R = { left: number; top: number; width: number; height: number }
const rect = (r: R) => ({ ...r, right: r.left + r.width, bottom: r.top + r.height })

/** Runs the coordinate getter for one arrow press with the card at `card` over `over`. */
function press(code: string, card: R, targets: Record<string, R>, over: string | null) {
  const rects = new Map(Object.entries(targets).map(([id, r]) => [id, rect(r)]))
  const context = {
    collisionRect: rect(card),
    droppableRects: rects,
    droppableContainers: { getEnabled: () => [...rects.keys()].map((id) => ({ id })) },
    over: over ? { id: over } : null,
  }
  const event = { code, preventDefault() {} } as unknown as KeyboardEvent
  return dropTargetCoordinates(event, { active: 'card', currentCoordinates: { x: card.left, y: card.top }, context } as never)
}

describe('dropTargetCoordinates', () => {
  const columns = { a: { left: 0, top: 0, width: 250, height: 1500 }, b: { left: 300, top: 0, width: 250, height: 1500 } }

  it('moves a card low in a tall column straight across to the next column', () => {
    const card = { left: 0, top: 1000, width: 200, height: 100 }
    const to = press(KeyboardCode.Right, card, columns, 'a')
    expect(to).toEqual({ x: 300, y: 1000 })
  })

  it('stays put when nothing lies in that direction', () => {
    const card = { left: 300, top: 200, width: 200, height: 100 }
    expect(press(KeyboardCode.Right, card, columns, 'b')).toEqual({ x: 300, y: 200 })
  })

  it('moves down a grid of cells one cell at a time', () => {
    const cells = { c1: { left: 0, top: 0, width: 300, height: 80 }, c2: { left: 0, top: 80, width: 300, height: 80 }, c3: { left: 0, top: 160, width: 300, height: 80 } }
    const card = { left: 10, top: 10, width: 200, height: 40 }
    expect(press(KeyboardCode.Down, card, cells, 'c1')).toEqual({ x: 10, y: 80 })
  })
})
