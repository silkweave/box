import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerUserCleanup, runUserCleanups } from './cleanup.js'

const off: (() => void)[] = []
const register = (id: string, fn: (id: string) => Promise<void> | void) => {
  const un = registerUserCleanup(id, fn)
  off.push(un)
  return un
}
afterEach(() => {
  while (off.length) off.pop()?.()
})

describe('user cleanups', () => {
  it('a blank Box has none, and running them is a no-op', async () => {
    await expect(runUserCleanups('ghost')).resolves.toBeUndefined()
  })

  it('runs every registered cleanup with the id, in registration order', async () => {
    const order: string[] = []
    register('planning', async (id) => {
      await Promise.resolve()
      order.push(`planning:${id}`)
    })
    register('crm', (id) => {
      order.push(`crm:${id}`)
    })
    await runUserCleanups('bob')
    expect(order).toEqual(['planning:bob', 'crm:bob'])
  })

  it('propagates a failure so the caller can abort the delete', async () => {
    const later = vi.fn()
    register('boom', () => {
      throw new Error('table gone')
    })
    register('later', later)
    await expect(runUserCleanups('bob')).rejects.toThrow('table gone')
    // Nothing after it ran either - a partial cleanup must not be mistaken for a done one.
    expect(later).not.toHaveBeenCalled()
  })

  it('refuses a duplicate id, and unregister frees it', async () => {
    const un = register('planning', () => {})
    expect(() => registerUserCleanup('planning', () => {})).toThrow(/registered twice/)
    un()
    expect(() => register('planning', () => {})).not.toThrow()
  })

  it('unregister is idempotent and never removes a later cleanup under the same id', async () => {
    const un = registerUserCleanup('planning', () => {
      throw new Error('the old one ran')
    })
    un()
    const fresh = vi.fn()
    register('planning', fresh)
    un()
    await runUserCleanups('bob')
    expect(fresh).toHaveBeenCalledWith('bob')
  })
})
