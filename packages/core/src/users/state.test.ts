import { describe, expect, it } from 'vitest'
import { hasHumanUser } from './state.js'

describe('human owner detection', () => {
  it('treats an empty directory and a machine-only directory as needing an owner', () => {
    expect(hasHumanUser([], 'nova')).toBe(false)
    expect(hasHumanUser([{ id: 'nova' }], 'nova')).toBe(false)
  })

  it('recognizes a human alongside the configured machine principal', () => {
    expect(hasHumanUser([{ id: 'nova' }, { id: 'alice' }], 'nova')).toBe(true)
  })
})
