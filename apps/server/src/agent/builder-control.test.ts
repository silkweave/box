import { describe, expect, it, vi } from 'vitest'
import { revokeBuilderControl, trackBuilderControl } from './builder-control.js'

describe('Builder control revocation', () => {
  it('revokes all of one user’s controls without affecting another user', () => {
    const first = vi.fn()
    const second = vi.fn()
    const other = vi.fn()
    trackBuilderControl('alice', first)
    trackBuilderControl('alice', second)
    const detach = trackBuilderControl('bob', other)
    revokeBuilderControl('alice')
    revokeBuilderControl('alice')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
    detach()
  })

  it('detaches closed controls and continues after an individual failure', () => {
    const closed = vi.fn()
    trackBuilderControl('alice', closed)()
    trackBuilderControl('alice', () => { throw new Error('already closed') })
    const active = vi.fn()
    trackBuilderControl('alice', active)
    revokeBuilderControl('alice')
    expect(closed).not.toHaveBeenCalled()
    expect(active).toHaveBeenCalledTimes(1)
  })
})
