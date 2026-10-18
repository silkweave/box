import { describe, expect, it } from 'vitest'
import { hasHumanUser } from './state.js'

describe('human owner detection', () => {
  it('treats an empty directory and an agents-only directory as needing an owner', () => {
    expect(hasHumanUser([], 'nova')).toBe(false)
    expect(hasHumanUser([{ id: 'nova', kind: 'agent' }], 'nova')).toBe(false)
    expect(hasHumanUser([{ id: 'nova', kind: 'agent' }, { id: 'stella', kind: 'agent' }], 'nova')).toBe(false)
  })

  it('recognizes a human alongside the agents', () => {
    expect(hasHumanUser([{ id: 'nova', kind: 'agent' }, { id: 'alice', kind: 'human' }], 'nova')).toBe(true)
  })

  it('never counts the system principal, even before boot marks its row', () => {
    expect(hasHumanUser([{ id: 'nova', kind: 'human' }], 'nova')).toBe(false)
  })
})
