import { describe, expect, it, vi } from 'vitest'
import { revokeAgentControl, trackAgentControl } from './agent-control.js'

describe('agent control revocation', () => {
  it('revokes all of one user’s controls without affecting another user', () => {
    const first = vi.fn()
    const second = vi.fn()
    const other = vi.fn()
    trackAgentControl('alice', first)
    trackAgentControl('alice', second)
    const detach = trackAgentControl('bob', other)
    revokeAgentControl('alice')
    revokeAgentControl('alice')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
    detach()
  })

  it('detaches closed controls and continues after an individual failure', () => {
    const closed = vi.fn()
    trackAgentControl('alice', closed)()
    trackAgentControl('alice', () => { throw new Error('already closed') })
    const active = vi.fn()
    trackAgentControl('alice', active)
    revokeAgentControl('alice')
    expect(closed).not.toHaveBeenCalled()
    expect(active).toHaveBeenCalledTimes(1)
  })
})
