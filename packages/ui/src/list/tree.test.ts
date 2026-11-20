import { describe, expect, test } from 'bun:test'
import { childrenByParent, depthOf, flattenTree, nestLevels, orderAfterMove, parentsUnder, projectDrop, subtreeHeight, treeRoots, withoutSubtree, type TreeAccess } from './tree.ts'

interface R {
  id: string
  parent: string | null
}
const at: TreeAccess<R> = { id: (r) => r.id, parentId: (r) => r.parent }
const r = (id: string, parent: string | null = null): R => ({ id, parent })

// a        (0)
//   a1     (1)
//   a2     (1)
//     a2x  (2)
// b        (0)
// c        (0)
const ROWS = [r('a'), r('a1', 'a'), r('a2', 'a'), r('a2x', 'a2'), r('b'), r('c')]
const flat = (rows: R[] = ROWS, collapsed: string[] = []) => flattenTree(rows, at, { collapsed: new Set(collapsed) })
const shape = (rows: R[] = ROWS, collapsed: string[] = []) => flat(rows, collapsed).map((n) => `${n.depth}:${n.id}`)

describe('flattenTree', () => {
  test('depth-first with depths and child counts', () => {
    expect(shape()).toEqual(['0:a', '1:a1', '1:a2', '2:a2x', '0:b', '0:c'])
    expect(flat().find((n) => n.id === 'a')?.childCount).toBe(2)
  })

  test('collapsed rows keep their row and hide their subtree', () => {
    expect(shape(ROWS, ['a'])).toEqual(['0:a', '0:b', '0:c'])
  })

  test('a missing parent reads as top level', () => {
    expect(shape([r('x', 'gone'), r('y')])).toEqual(['0:x', '0:y'])
  })

  test('rows in a parent cycle are still placed, once each', () => {
    const rows = [r('p', 'q'), r('q', 'p'), r('self', 'self'), r('ok')]
    const ids = flat(rows).map((n) => n.id)
    expect(ids.sort()).toEqual(['ok', 'p', 'q', 'self'])
  })

  test('keep shows matches with their ancestors', () => {
    const nodes = flattenTree(ROWS, at, { keep: (row) => row.id === 'a2x' })
    expect(nodes.map((n) => n.id)).toEqual(['a', 'a2', 'a2x'])
    expect(nodes[0].childCount).toBe(1)
  })
})

describe('subtreeHeight and withoutSubtree', () => {
  test('height counts levels below, folded or not', () => {
    const kids = childrenByParent(ROWS, at)
    expect(subtreeHeight(kids, at, 'a')).toBe(2)
    expect(subtreeHeight(kids, at, 'a2')).toBe(1)
    expect(subtreeHeight(kids, at, 'b')).toBe(0)
  })

  test('withoutSubtree drops the rows drawn under a row', () => {
    expect(withoutSubtree(flat(), 'a').map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(withoutSubtree(flat(), 'c').map((n) => n.id)).toEqual(['a', 'a1', 'a2', 'a2x', 'b', 'c'])
  })
})

describe('folding helpers', () => {
  test('parentsUnder lists rows with children, under a row or every root', () => {
    const kids = childrenByParent(ROWS, at)
    expect(parentsUnder(ROWS, at, kids, 'a')).toEqual(['a2'])
    expect(parentsUnder(ROWS, at, kids, null)).toEqual(['a', 'a2'])
  })

  test('parentsUnder and treeRoots survive a parent cycle', () => {
    const rows = [r('p', 'q'), r('q', 'p'), r('ok')]
    const kids = childrenByParent(rows, at)
    expect(treeRoots(rows, at, kids).map((x) => x.id)).toEqual(['ok', 'p'])
    expect(parentsUnder(rows, at, kids, 'p')).toEqual(['q'])
    expect(parentsUnder(rows, at, kids, null).sort()).toEqual(['p', 'q'])
  })

  test('depthOf counts ancestors, cycle-safe', () => {
    expect(depthOf(ROWS, at, 'a2x')).toBe(2)
    expect(depthOf(ROWS, at, 'b')).toBe(0)
    expect(depthOf([r('p', 'q'), r('q', 'p')], at, 'p')).toBe(1)
  })
})

describe('nestLevels', () => {
  test('a vertical wobble never nests', () => {
    expect(nestLevels(0, 28)).toBe(0)
    expect(nestLevels(20, 28)).toBe(0)
    expect(nestLevels(-20, 28)).toBe(0)
  })

  test('whole steps after the first push', () => {
    expect(nestLevels(21, 28)).toBe(1)
    expect(nestLevels(48, 28)).toBe(1)
    expect(nestLevels(49, 28)).toBe(2)
    expect(nestLevels(-21, 28)).toBe(-1)
  })
})

describe('projectDrop', () => {
  // The list as drawn while 'c' is dragged (a leaf, so nothing folds).
  const nodes = flat()

  test('staying put keeps the depth and parent', () => {
    const p = projectDrop(nodes, 'c', 5, 0)
    expect(p).toMatchObject({ depth: 0, parentId: null, afterId: 'b' })
  })

  test('a push right nests under the row above', () => {
    const p = projectDrop(nodes, 'c', 5, 1)
    expect(p).toMatchObject({ depth: 1, parentId: 'b', afterId: null })
    expect(p?.depths).toEqual([0, 1])
  })

  test('between a parent and its first child the row must become that child', () => {
    // slot 1 = after 'a', before 'a1' (depth 1): depth 0 would re-parent a1.
    const p = projectDrop(nodes, 'c', 1, 0)
    expect(p).toMatchObject({ depth: 1, parentId: 'a', afterId: null })
    expect(p?.depths).toEqual([1])
  })

  test('after a deep row, a push left lifts out level by level', () => {
    // slot 4 = after 'a2x' (depth 2), before 'b' (depth 0): depths 0..3 allowed.
    expect(projectDrop(nodes, 'c', 4, 0)?.depths).toEqual([0, 1, 2, 3])
    expect(projectDrop(nodes, 'c', 4, 2)).toMatchObject({ depth: 2, parentId: 'a2', afterId: 'a2x' })
    expect(projectDrop(nodes, 'c', 4, 1)).toMatchObject({ depth: 1, parentId: 'a', afterId: 'a2' })
    expect(projectDrop(nodes, 'c', 4, 0)).toMatchObject({ depth: 0, parentId: null, afterId: 'a' })
  })

  test('maxDepth caps the depth', () => {
    expect(projectDrop(nodes, 'c', 4, 3, { maxDepth: 1 })?.depths).toEqual([0, 1])
    expect(projectDrop(nodes, 'c', 5, 1, { maxDepth: 0 })).toMatchObject({ depth: 0 })
  })

  test('a carried subtree counts against maxDepth', () => {
    // Dragging 'a2' (carries a2x one level down) with maxDepth 1: a2 may only sit at depth 0.
    const view = withoutSubtree(flat(ROWS, ['a2']), 'a2')
    const p = projectDrop(view, 'a2', 3, 0, { maxDepth: 1, carry: 1 })
    expect(p?.depths).toEqual([0])
  })

  test('a slot no depth fits is refused', () => {
    // Between 'a' and 'a1' the row must nest under 'a'; maxDepth 0 forbids that.
    expect(projectDrop(nodes, 'c', 1, 0, { maxDepth: 0 })).toBeNull()
  })

  test('allows filters parents, and falls back to the nearest allowed depth', () => {
    const onlyTop = (parent: string | null) => parent === null
    expect(projectDrop(nodes, 'c', 5, 1, { allows: onlyTop })).toMatchObject({ depth: 0, parentId: null })
    expect(projectDrop(nodes, 'c', 1, 0, { allows: onlyTop })).toBeNull()
    const notUnderA2 = (parent: string | null) => parent !== 'a2'
    expect(projectDrop(nodes, 'c', 4, 2, { allows: notUnderA2 })?.depths).toEqual([0, 1, 3])
  })

  test('an unknown row projects nothing', () => {
    expect(projectDrop(nodes, 'nope', 0, 0)).toBeNull()
  })
})

describe('orderAfterMove', () => {
  test('re-parents and keeps every parent before its subtree', () => {
    expect(orderAfterMove(ROWS, at, 'c', 'a', 'a1')).toEqual(['a', 'a1', 'c', 'a2', 'a2x', 'b'])
  })

  test('first among siblings when afterId is null', () => {
    expect(orderAfterMove(ROWS, at, 'b', null, null)).toEqual(['b', 'a', 'a1', 'a2', 'a2x', 'c'])
  })

  test('a moved parent takes its subtree along', () => {
    expect(orderAfterMove(ROWS, at, 'a2', null, 'c')).toEqual(['a', 'a1', 'b', 'c', 'a2', 'a2x'])
  })

  test('never loses a row: cycles and orphans stay in the order', () => {
    const rows = [r('p', 'q'), r('q', 'p'), r('x', 'gone'), r('y')]
    const order = orderAfterMove(rows, at, 'y', null, 'x')
    expect([...order].sort()).toEqual(['p', 'q', 'x', 'y'])
    expect(order.indexOf('y')).toBe(order.indexOf('x') + 1)
  })

  test('a move under its own descendant still keeps every row', () => {
    const order = orderAfterMove(ROWS, at, 'a', 'a2x', null)
    expect([...order].sort()).toEqual(['a', 'a1', 'a2', 'a2x', 'b', 'c'])
  })
})
