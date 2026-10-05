import { describe, expect, it } from 'vitest'
import { findPathMount, pathMountSigninUrl, registerPathMount } from './path-mounts.js'

describe('path mounts', () => {
  it('owns everything below its prefix and nothing else', () => {
    const off = registerPathMount({ id: 't1', prefix: '/things/', handle: () => {} })
    try {
      expect(findPathMount('/things/a/b.js')?.id).toBe('t1')
      expect(findPathMount('/things/')?.id).toBe('t1')
      expect(findPathMount('/things')).toBeUndefined()
      expect(findPathMount('/thingsx/a')).toBeUndefined()
    } finally {
      off()
    }
    expect(findPathMount('/things/a')).toBeUndefined()
  })

  it('refuses malformed, reserved and duplicate prefixes', () => {
    expect(() => registerPathMount({ id: 'a', prefix: '/things', handle: () => {} })).toThrow(/prefix/)
    expect(() => registerPathMount({ id: 'a', prefix: '/api/', handle: () => {} })).toThrow(/reserved/)
    const off = registerPathMount({ id: 'a', prefix: '/things/', handle: () => {} })
    try {
      expect(() => registerPathMount({ id: 'b', prefix: '/things/', handle: () => {} })).toThrow(/already mounted/)
    } finally {
      off()
    }
  })

  it('builds a same-origin sign-in return only', () => {
    expect(pathMountSigninUrl('/things/a/?x=1')).toBe('/?next=%2Fthings%2Fa%2F%3Fx%3D1')
    expect(pathMountSigninUrl('//evil.example/')).toBe('/?next=%2F')
  })
})
