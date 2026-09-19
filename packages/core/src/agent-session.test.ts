import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGENT_SESSION_APP, agentSessionAccess, registerAgentSessionRule, type AgentSessionRule } from './agent-session.js'

const cleanups: (() => void)[] = []
const register = (id: string, rule: AgentSessionRule) => {
  const off = registerAgentSessionRule(id, rule)
  cleanups.push(off)
  return off
}

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

/** A sidebar session as `gateCreate` stamps it: scoped and meta'd to the signed-in person. */
const sidebarSession = (user: string) => ({ scope: { user }, meta: { app: AGENT_SESSION_APP, user, display: user } })

describe('agentSessionAccess', () => {
  it('owner: the scope matches, and no rule is consulted', () => {
    const rule = vi.fn(() => null)
    register('spy', rule)
    expect(agentSessionAccess('alice', sidebarSession('alice'))).toEqual({ kind: 'owner' })
    expect(rule).not.toHaveBeenCalled()
  })

  it('none on a blank Box: with no feature registered, a non-owner is nobody', () => {
    // This is the core-only answer, and it is the right one - a Box with no chat has no rooms.
    expect(agentSessionAccess('alice', sidebarSession('bob'))).toEqual({ kind: 'none' })
    expect(agentSessionAccess('alice', {})).toEqual({ kind: 'none' })
  })

  it('a registered rule widens access for a session the caller does not own', () => {
    register('chat', (user, session) => (session.meta?.room === 'r1' && user === 'alice' ? { kind: 'reader', room: 'r1' } : null))
    expect(agentSessionAccess('alice', { meta: { room: 'r1' } })).toEqual({ kind: 'reader', room: 'r1' })
    expect(agentSessionAccess('carol', { meta: { room: 'r1' } })).toEqual({ kind: 'none' })
  })

  it('first non-abstaining rule wins, and an abstention falls through to the next', () => {
    register('a', () => null)
    register('b', () => ({ kind: 'reader', room: 'from-b' }))
    register('c', () => ({ kind: 'reader', room: 'from-c' }))
    expect(agentSessionAccess('alice', {})).toEqual({ kind: 'reader', room: 'from-b' })
  })

  it('a rule that throws is refused, not trusted, and does not stop the others', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    register('boom', () => {
      throw new Error('store closed')
    })
    register('ok', () => ({ kind: 'reader', room: 'r2' }))
    expect(agentSessionAccess('alice', {})).toEqual({ kind: 'reader', room: 'r2' })
    // Alone, it is `none` - "I cannot tell" is never "yes".
    cleanups.pop()?.()
    expect(agentSessionAccess('alice', {})).toEqual({ kind: 'none' })
  })

  it('a `none` verdict does not claim the session either - a later rule may still admit', () => {
    register('abstain-hard', () => ({ kind: 'none' }))
    register('admit', () => ({ kind: 'reader', room: 'r3' }))
    expect(agentSessionAccess('alice', {})).toEqual({ kind: 'reader', room: 'r3' })
  })

  it('refuses a duplicate id, and unregister makes the id free again', () => {
    const off = register('dup', () => null)
    expect(() => registerAgentSessionRule('dup', () => null)).toThrow(/registered twice/)
    off()
    expect(() => register('dup', () => null)).not.toThrow()
  })

  it('unregister is idempotent and never removes a later rule under the same id', () => {
    const off = registerAgentSessionRule('chat', () => ({ kind: 'reader', room: 'old' }))
    off()
    register('chat', () => ({ kind: 'reader', room: 'new' }))
    off()
    expect(agentSessionAccess('alice', {})).toEqual({ kind: 'reader', room: 'new' })
  })
})
