// The session cookie's `Secure` flag, which is derived from the request rather than configured
// (docs/core/AUTH.md § 1.6, implemented 2026-09-14).
//
// Why this file exists: the old behaviour was `Secure` unless `AUTH_COOKIE_INSECURE=1`, and it was
// wrong in the one direction nobody tests. Chromium treats `localhost` as a secure context and
// stores a `Secure` cookie set over plain http anyway; Safari does not. So `box dev` worked for
// every developer using Chrome while a Safari user could not sign in to a local Box at all, and the
// failure is silent - the browser drops the cookie and the app falls back to the login screen with
// nothing in the console. A default that only misbehaves in a browser the authors do not use is
// exactly the kind of thing that needs a test rather than a comment.
//
// The peer check in `requestIsSecure` is the security-relevant half: `x-forwarded-proto` is a
// CLIENT-SUPPLIED header, so honouring it from an arbitrary peer would let any caller mark its own
// cookie `Secure` over plain http - and a `Secure` cookie the browser then refuses to send back is
// a self-inflicted logout, not a vulnerability, but it is still a way to make a Box look broken.

import { describe, expect, it } from 'vitest'
import { requestIsSecure, sessionCookie } from './session.js'

const req = (over: {
  encrypted?: boolean
  remoteAddress?: string | null
  headers?: Record<string, unknown>
}) => ({
  socket: { encrypted: over.encrypted, remoteAddress: over.remoteAddress ?? null },
  headers: over.headers ?? {},
})

describe('sessionCookie', () => {
  it('omits Secure by default, which is what makes plain http work in every browser', () => {
    expect(sessionCookie('v')).not.toContain('Secure')
  })

  it('sets Secure only when the caller says the request had TLS', () => {
    expect(sessionCookie('v', undefined, true)).toContain('; Secure')
  })

  it('always carries the flags that do not depend on the transport', () => {
    for (const c of [sessionCookie('v'), sessionCookie('v', undefined, true)]) {
      expect(c).toContain('HttpOnly')
      expect(c).toContain('SameSite=Lax')
      expect(c).toContain('Path=/')
    }
  })

  it('clears with Max-Age=0 rather than a negative age', () => {
    expect(sessionCookie('', 0)).toContain('Max-Age=0')
    expect(sessionCookie('', -5000)).toContain('Max-Age=0')
  })
})

describe('requestIsSecure', () => {
  it('trusts a TLS socket', () => {
    expect(requestIsSecure(req({ encrypted: true }))).toBe(true)
  })

  it('is false for plain http with no proxy header - the localhost dev case', () => {
    expect(requestIsSecure(req({ remoteAddress: '127.0.0.1' }))).toBe(false)
  })

  it('trusts x-forwarded-proto from a loopback peer, which is how `tailscale serve` is seen', () => {
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(requestIsSecure(req({ remoteAddress: peer, headers: { 'x-forwarded-proto': 'https' } }))).toBe(true)
    }
  })

  it('REFUSES x-forwarded-proto from a non-loopback peer', () => {
    // The header is client-supplied. A direct caller on the tailnet must not be able to decide
    // that its own cookie is Secure.
    expect(requestIsSecure(req({ remoteAddress: '100.64.0.7', headers: { 'x-forwarded-proto': 'https' } }))).toBe(false)
  })

  it('reads only the first hop of a chained x-forwarded-proto', () => {
    const h = (v: string) => req({ remoteAddress: '127.0.0.1', headers: { 'x-forwarded-proto': v } })
    expect(requestIsSecure(h('https,http'))).toBe(true)
    expect(requestIsSecure(h('http,https'))).toBe(false)
  })

  it('tolerates the header arriving as an array, and is case- and space-insensitive', () => {
    expect(requestIsSecure(req({ remoteAddress: '::1', headers: { 'x-forwarded-proto': ['https'] } }))).toBe(true)
    expect(requestIsSecure(req({ remoteAddress: '::1', headers: { 'x-forwarded-proto': '  HTTPS ' } }))).toBe(true)
  })

  it('is false for a request with no socket at all rather than throwing', () => {
    expect(requestIsSecure({})).toBe(false)
  })
})
