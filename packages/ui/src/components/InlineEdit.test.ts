import { describe, expect, it } from 'bun:test'
import { commitEdit } from './InlineEdit.tsx'

// A write the test settles by hand.
function deferred() {
  let reject!: (e: Error) => void
  let resolve!: () => void
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('InlineEdit commit', () => {
  it('restores the stored value when the write fails', async () => {
    const el = { value: 'Leeds 2' }
    const w = deferred()
    commitEdit(el, 'Leeds', () => w.promise, { current: 0 }, () => false)
    w.reject(new Error('refused'))
    await settle()
    expect(el.value).toBe('Leeds')
  })

  it('keeps the text when the write lands', async () => {
    const el = { value: 'Leeds 2' }
    const w = deferred()
    commitEdit(el, 'Leeds', () => w.promise, { current: 0 }, () => false)
    w.resolve()
    await settle()
    expect(el.value).toBe('Leeds 2')
  })

  it('lets an older failure leave a newer commit alone, even with the same text', async () => {
    const el = { value: 'B' }
    const gen = { current: 0 }
    const a = deferred()
    const b = deferred()
    commitEdit(el, 'A', () => a.promise, gen, () => false)
    commitEdit(el, 'A', () => b.promise, gen, () => false)
    a.reject(new Error('refused'))
    await settle()
    expect(el.value).toBe('B')
    b.reject(new Error('refused'))
    await settle()
    expect(el.value).toBe('A')
  })

  it('leaves text the person is typing or typed since', async () => {
    const el = { value: 'B' }
    const w = deferred()
    commitEdit(el, 'A', () => w.promise, { current: 0 }, () => false)
    el.value = 'C'
    w.reject(new Error('refused'))
    await settle()
    expect(el.value).toBe('C')
    const focused = { value: 'D' }
    const v = deferred()
    commitEdit(focused, 'A', () => v.promise, { current: 0 }, () => true)
    v.reject(new Error('refused'))
    await settle()
    expect(focused.value).toBe('D')
  })

  it('does not call onCommit when nothing changed', () => {
    let calls = 0
    commitEdit({ value: 'A' }, 'A', () => { calls++ }, { current: 0 }, () => false)
    expect(calls).toBe(0)
  })
})
