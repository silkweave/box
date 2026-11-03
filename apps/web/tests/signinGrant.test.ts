import { describe, expect, test } from 'bun:test'
import { grantSubject, readSigninEntry, signedInGrantAction } from '../src/lib/signinGrant.ts'

/** A bl2-shaped grant for `id`: 10 header bytes, then the UTF-8 id. Unsigned: display only. */
function bl2(id: string): string {
  const bytes = [...new Uint8Array(10), ...new TextEncoder().encode(id)]
  const payload = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `bl2.${payload}.sig`
}

describe('readSigninEntry', () => {
  test('takes the grant out of /login/<grant> and points the address bar at /', () => {
    expect(readSigninEntry(`/login/${bl2('alice')}`, '')).toEqual({ grant: bl2('alice'), notice: null, cleanUrl: '/' })
  })
  test('decodes an encoded grant and keeps unrelated query state', () => {
    expect(readSigninEntry('/login/bl2.a%2Eb', '?next=%2Fartifacts%2Fx%2F')).toEqual({ grant: 'bl2.a.b', notice: null, cleanUrl: '/?next=%2Fartifacts%2Fx%2F' })
  })
  test('reads the e= notice from /login and scrubs it', () => {
    expect(readSigninEntry('/login', '?e=retired')).toEqual({ grant: null, notice: 'retired', cleanUrl: '/' })
  })
  test('leaves every other path alone', () => {
    expect(readSigninEntry('/crm/acme', '?link=x')).toEqual({ grant: null, notice: null, cleanUrl: null })
    expect(readSigninEntry('/loginx', '')).toEqual({ grant: null, notice: null, cleanUrl: null })
  })
})

describe('signed-in grant action', () => {
  test('reads the subject of a bl2 grant', () => {
    expect(grantSubject(bl2('alice'))).toBe('alice')
    expect(grantSubject('junk')).toBeNull()
  })
  test('the same person drops the link; anyone else is asked', () => {
    expect(signedInGrantAction(bl2('alice'), 'alice')).toBe('same')
    expect(signedInGrantAction(bl2('bob'), 'alice')).toBe('switch')
  })
  test('an unreadable grant asks rather than being dropped', () => {
    expect(signedInGrantAction('bl2.@@@.x', 'alice')).toBe('switch')
  })
})
