// `clientIp` - the address every rate-limit bucket is keyed on, and therefore the thing that decides
// whether the limiters exist at all.
//
// Why this file exists: until 2026-09-15 `clientIp` was duplicated in two places and both took the
// FIRST `x-forwarded-for` hop from ANY peer. Both halves were wrong, and the combination meant a
// caller who varied one header landed in a fresh bucket on every request - so `api:`, `login:` and
// `link:` were all decorative. A limiter that silently does nothing is worse than no limiter,
// because the code reads as though the risk is handled.
//
// The two rules under test:
//   1. Only a LOOPBACK peer's forwarding headers are believed. Anyone can send the header; only our
//      own reverse proxy is on loopback.
//   2. The RIGHTMOST hop wins. A client prepends; a proxy appends. `tailscale serve` is a Go
//      httputil.ReverseProxy, which appends, so the last hop is the one our proxy wrote and the
//      only one the client could not forge.

import { describe, expect, it } from 'vitest'
import { clientIp, isLoopbackPeer } from './security.js'

const req = (peer: string | null | undefined, xff?: string | string[]) => ({
  socket: { remoteAddress: peer },
  headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
})

describe('isLoopbackPeer', () => {
  it('accepts the three shapes node actually reports', () => {
    expect(isLoopbackPeer('127.0.0.1')).toBe(true)
    expect(isLoopbackPeer('::1')).toBe(true)
    // IPv4-mapped IPv6, which is what a dual-stack listener reports for a v4 loopback client.
    expect(isLoopbackPeer('::ffff:127.0.0.1')).toBe(true)
  })

  it('rejects everything else, including the absent case', () => {
    expect(isLoopbackPeer('10.0.0.4')).toBe(false)
    expect(isLoopbackPeer('100.64.0.1')).toBe(false)
    expect(isLoopbackPeer('')).toBe(false)
    expect(isLoopbackPeer(null)).toBe(false)
    expect(isLoopbackPeer(undefined)).toBe(false)
  })

  it('does not accept a loopback-ish prefix', () => {
    // A naive startsWith('127.') would accept these; the whole point is an exact peer identity.
    expect(isLoopbackPeer('127.0.0.1.evil.com')).toBe(false)
    expect(isLoopbackPeer('1127.0.0.1')).toBe(false)
  })
})

describe('clientIp - a remote peer', () => {
  it('ignores x-forwarded-for entirely', () => {
    // THE regression test. A direct client sending a different header per request must not get a
    // different bucket per request.
    expect(clientIp(req('203.0.113.9', '1.1.1.1'))).toBe('203.0.113.9')
    expect(clientIp(req('203.0.113.9', '2.2.2.2'))).toBe('203.0.113.9')
    expect(clientIp(req('203.0.113.9', '3.3.3.3, 4.4.4.4'))).toBe('203.0.113.9')
  })

  it('falls back to a stable string when there is no peer at all', () => {
    // One shared bucket is the safe direction to fail: it over-limits, it never unlimits.
    expect(clientIp(req(undefined))).toBe('unknown')
    expect(clientIp(req(''))).toBe('unknown')
  })
})

describe('clientIp - a loopback peer', () => {
  it('uses the rightmost hop, not the first', () => {
    // The client claimed 1.1.1.1; our proxy appended what it actually saw.
    expect(clientIp(req('127.0.0.1', '1.1.1.1, 100.64.0.7'))).toBe('100.64.0.7')
  })

  it('handles a single hop', () => {
    expect(clientIp(req('::1', '100.64.0.7'))).toBe('100.64.0.7')
  })

  it('handles the header arriving as repeated fields', () => {
    // Node surfaces a repeated header as an array; the rightmost hop is still the trustworthy one.
    expect(clientIp(req('127.0.0.1', ['1.1.1.1', '100.64.0.7']))).toBe('100.64.0.7')
  })

  it('tolerates whitespace and empty hops', () => {
    expect(clientIp(req('127.0.0.1', ' 1.1.1.1 ,  , 100.64.0.7 '))).toBe('100.64.0.7')
  })

  it('falls back to the peer when the header is absent or empty', () => {
    expect(clientIp(req('127.0.0.1'))).toBe('127.0.0.1')
    expect(clientIp(req('127.0.0.1', ''))).toBe('127.0.0.1')
    expect(clientIp(req('127.0.0.1', ' , '))).toBe('127.0.0.1')
  })

  it('does not treat a non-string header as a hop', () => {
    expect(clientIp({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': 42 } })).toBe('127.0.0.1')
  })

  it('keeps a direct loopback caller on its own bucket', () => {
    // `box dev`, the chat agent's loopback client and `verifyLoopback` all land here.
    expect(clientIp(req('::ffff:127.0.0.1'))).toBe('::ffff:127.0.0.1')
  })
})
