import { describe, expect, test } from 'bun:test'
import { applyIntents, MoveQueue, resolveIntent, type MoveIntent } from './moves.ts'
import { flattenTree, type TreeAccess } from './tree.ts'

interface R {
  id: string
  parent: string | null
}
const at: TreeAccess<R> = { id: (r) => r.id, parentId: (r) => r.parent }
const r = (id: string, parent: string | null = null): R => ({ id, parent })
const shape = ({ rows, at: access }: { rows: readonly R[]; at: TreeAccess<R> }) => flattenTree(rows, access).map((n) => `${n.depth}:${n.id}`)
const move = (id: string, parentId: string | null, afterId: string | null = null): MoveIntent => ({ id, parentId, afterId })

const ROWS = [r('a'), r('a1', 'a'), r('b'), r('c')]

describe('resolveIntent', () => {
  test('a valid move resolves unchanged', () => {
    expect(resolveIntent(ROWS, at, move('c', 'a', 'a1'))).toEqual(move('c', 'a', 'a1'))
  })

  test('a row that went away resolves to nothing', () => {
    expect(resolveIntent(ROWS, at, move('gone', null))).toBeNull()
  })

  test('a parent that went away cancels rather than landing at the top level', () => {
    expect(resolveIntent(ROWS, at, move('c', 'gone'))).toBeNull()
  })

  test('a parent that is the row or under it cancels (a concurrent re-parent made a cycle)', () => {
    expect(resolveIntent(ROWS, at, move('a', 'a'))).toBeNull()
    expect(resolveIntent(ROWS, at, move('a', 'a1'))).toBeNull()
    // Queued: a under b. Meanwhile fresh rows put b under a. Applying would make a <-> b.
    const fresh = [r('a'), r('b', 'a')]
    expect(resolveIntent(fresh, at, move('a', 'b'))).toBeNull()
  })

  test('a sibling to follow that went away or moved elsewhere reads as first', () => {
    expect(resolveIntent(ROWS, at, move('c', null, 'gone'))).toEqual(move('c', null, null))
    expect(resolveIntent(ROWS, at, move('c', null, 'a1'))).toEqual(move('c', null, null))
  })

  test('the check is consulted on the resolved intent', () => {
    const noNesting = (i: MoveIntent) => i.parentId === null
    expect(resolveIntent(ROWS, at, move('c', 'a'), noNesting)).toBeNull()
    expect(resolveIntent(ROWS, at, move('c', null, 'gone'), noNesting)).toEqual(move('c', null, null))
  })
})

describe('applyIntents', () => {
  test('no intents returns the rows untouched', () => {
    expect(applyIntents(ROWS, at, []).rows).toBe(ROWS)
  })

  test('moves and re-parents in turn', () => {
    expect(shape(applyIntents(ROWS, at, [move('c', 'a', 'a1'), move('b', null)]))).toEqual(['0:b', '0:a', '1:a1', '1:c'])
  })

  test('rebases on fresh rows: a row added meanwhile stays, the move still applies', () => {
    expect(shape(applyIntents([...ROWS, r('d')], at, [move('d', 'b')]))).toEqual(['0:a', '1:a1', '0:b', '1:d', '0:c'])
  })

  test('intents that no longer resolve are skipped, the rest still apply', () => {
    const out = applyIntents(ROWS, at, [move('c', 'gone'), move('gone', 'a'), move('b', 'a', 'a1')])
    expect(shape(out)).toEqual(['0:a', '1:a1', '1:b', '0:c'])
  })

  test('never builds a cycle out of a stale move', () => {
    const fresh = [r('a'), r('b', 'a')]
    expect(shape(applyIntents(fresh, at, [move('a', 'b')]))).toEqual(['0:a', '1:b'])
  })
})

/** A dispatch whose writes the test settles by hand. */
function manual() {
  const calls: { intent: MoveIntent; resolve: () => void; reject: (e: unknown) => void }[] = []
  const dispatch = (intent: MoveIntent) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ intent, resolve, reject })
    })
  return { calls, dispatch }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('MoveQueue', () => {
  test('hands over one move at a time, in order, and empties as they settle', async () => {
    const q = new MoveQueue()
    const { calls, dispatch } = manual()
    q.dispatch = dispatch
    q.enqueue(move('a', null))
    q.enqueue(move('b', null))
    await tick()
    expect(calls.map((c) => c.intent.id)).toEqual(['a'])
    expect(q.snapshot().length).toBe(2)
    calls[0].resolve()
    await tick()
    expect(calls.map((c) => c.intent.id)).toEqual(['a', 'b'])
    expect(q.snapshot().map((i) => i.id)).toEqual(['b'])
    calls[1].resolve()
    await tick()
    expect(q.snapshot()).toEqual([])
  })

  test('a rejection reports the move and the queue goes on with the next', async () => {
    const q = new MoveQueue()
    const { calls, dispatch } = manual()
    const errors: string[] = []
    q.dispatch = dispatch
    q.onError = (intent, error) => errors.push(`${intent.id}:${String(error)}`)
    q.enqueue(move('a', null))
    q.enqueue(move('b', null))
    await tick()
    calls[0].reject('denied')
    await tick()
    expect(errors).toEqual(['a:denied'])
    expect(calls.map((c) => c.intent.id)).toEqual(['a', 'b'])
  })

  test('a dispatch that throws synchronously settles like a rejection', async () => {
    const q = new MoveQueue()
    const errors: unknown[] = []
    q.dispatch = () => {
      throw new Error('boom')
    }
    q.onError = (_intent, error) => errors.push(error)
    q.enqueue(move('a', null))
    await tick()
    expect(errors.length).toBe(1)
    expect(q.snapshot()).toEqual([])
  })

  test('a plain return settles at once; dispatch reads the latest assignment', async () => {
    const q = new MoveQueue()
    const seen: string[] = []
    q.dispatch = () => seen.push('old')
    q.enqueue(move('a', null))
    q.dispatch = () => seen.push('new')
    q.enqueue(move('b', null))
    await tick()
    expect(seen).toEqual(['old', 'new'])
    expect(q.snapshot()).toEqual([])
  })

  test('subscribers hear every change', async () => {
    const q = new MoveQueue()
    let heard = 0
    const off = q.subscribe(() => heard++)
    q.enqueue(move('a', null))
    await tick()
    off()
    expect(heard).toBe(2) // enqueued, settled
  })
})
