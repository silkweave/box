import { describe, expect, test } from 'bun:test'
import { leaveState, type DraftState } from './internal.tsx'

function held(): { promise: Promise<boolean>; finish: (ok: boolean) => void } {
  let finish!: (ok: boolean) => void
  const promise = new Promise<boolean>((resolve) => { finish = resolve })
  return { promise, finish }
}

describe('leaveState', () => {
  test('clean, dirty and failed drafts', async () => {
    expect(await leaveState(() => [])).toBe('clean')
    expect(await leaveState(() => [false, true])).toBe('dirty')
    const failed = [Promise.resolve(false)]
    expect(await leaveState(() => failed)).toBe('failed')
  })

  test('a save that lands clean lets the person leave', async () => {
    const key = {}
    const save = held()
    const drafts = new Map<object, DraftState>([[key, save.promise]])
    const leaving = leaveState(() => drafts.values())
    drafts.set(key, false)
    save.finish(true)
    expect(await leaving).toBe('clean')
  })

  test('an edit made while the save ran is still unsaved after it lands', async () => {
    const key = {}
    const save = held()
    const drafts = new Map<object, DraftState>([[key, save.promise]])
    const leaving = leaveState(() => drafts.values())
    drafts.set(key, true)
    save.finish(true)
    expect(await leaving).toBe('dirty')
  })

  test('a save that keeps restarting does not hang the check', async () => {
    expect(await leaveState(() => [Promise.resolve(true)])).toBe('dirty')
  })
})
