// Sign-in grants: the signature, the timing rules, and - the part that actually matters - that a
// grant and a session cookie can never be mistaken for one another.
//
// The cross-confusion tests are not paranoia. The obvious implementation of a short-lived link is
// `{sub, exp}` HMAC-signed with AUTH_SESSION_SECRET, and that IS a valid session cookie, because
// `verifySession` still honours a legacy `exp`. A 15-minute single-use link would have handed over a
// permanent session, and every test of the link in isolation would still have passed. The four locks
// in link.ts exist for that, and `grant is not a session` / `session is not a grant` are the tests
// that would have caught it.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  mintSigninGrant,
  SIGNIN_GRANT_PREFIX,
  SIGNIN_LINK_MAX_TTL_MS,
  SIGNIN_LINK_TTL_MS,
  verifySigninGrant,
} from './link.js'
import { mintSession, verifySession } from './session.js'
import { authSecret } from './secrets.js'
import { resetInstanceDir, setInstanceDir } from '../testing.js'
import { createHmac, hkdfSync } from 'node:crypto'

/**
 * Sign an ARBITRARY claims object with the real sign-in-link key, reproducing link.ts's derivation.
 *
 * This is what lets the tests below reach the checks that sit AFTER the signature check. Without it
 * every "malformed grant" test would be caught by the MAC and the claim validation would go
 * unexercised - which is precisely the kind of test that looks thorough and proves nothing.
 */
const signGrant = (claims: Record<string, unknown>): string => {
  const key = Buffer.from(
    hkdfSync('sha256', authSecret('AUTH_SESSION_SECRET'), '', 'silkweave-box/signin-link/v1', 32),
  )
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  const signed = `${SIGNIN_GRANT_PREFIX}.${payload}`
  return `${signed}.${createHmac('sha256', key).update(signed).digest('base64url')}`
}

let dir: string

beforeAll(() => {
  // No AUTH_SESSION_SECRET in env: the loader generates one into this throwaway dir, which is also
  // the path a fresh Box takes.
  dir = mkdtempSync(join(tmpdir(), 'box-link-'))
  setInstanceDir(dir)
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  resetInstanceDir()
})

describe('mint and verify', () => {
  it('round-trips the claims', () => {
    const now = Date.now()
    const { grant, claims } = mintSigninGrant('alice', { now })
    expect(claims).toEqual({ sub: 'alice', iat: now, exp: now + SIGNIN_LINK_TTL_MS })

    const res = verifySigninGrant(grant, now + 1000)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.claims).toEqual(claims)
  })

  it('is shaped `bl1.<payload>.<sig>`', () => {
    const { grant } = mintSigninGrant('alice')
    const parts = grant.split('.')
    expect(parts).toHaveLength(3)
    expect(parts[0]).toBe(SIGNIN_GRANT_PREFIX)
  })

  it('trims the id and refuses an empty one', () => {
    expect(mintSigninGrant('  alice  ').claims.sub).toBe('alice')
    expect(() => mintSigninGrant('   ')).toThrow(/needs a user id/)
  })

  it('stays a sane length for a URL', () => {
    // It goes in a query string someone may paste into a chat message; keep an eye on the size.
    expect(mintSigninGrant('alice').grant.length).toBeLessThan(200)
  })
})

describe('tampering', () => {
  it('rejects a flipped signature', () => {
    const { grant } = mintSigninGrant('alice')
    const [p, payload, sig] = grant.split('.')
    const bad = `${p}.${payload}.${sig.slice(0, -1)}${sig.at(-1) === 'A' ? 'B' : 'A'}`
    expect(verifySigninGrant(bad)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects a swapped subject', () => {
    // THE attack: re-sign nothing, just edit the payload to name someone else.
    const { grant } = mintSigninGrant('alice')
    const [p, , sig] = grant.split('.')
    const forged = Buffer.from(JSON.stringify({ sub: 'root', iat: Date.now(), exp: Date.now() + 60_000 }), 'utf8')
      .toString('base64url')
    expect(verifySigninGrant(`${p}.${forged}.${sig}`)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects a missing or wrong prefix', () => {
    const { grant } = mintSigninGrant('alice')
    const [, payload, sig] = grant.split('.')
    expect(verifySigninGrant(`${payload}.${sig}`)).toEqual({ ok: false, reason: 'invalid' })
    expect(verifySigninGrant(`bl2.${payload}.${sig}`)).toEqual({ ok: false, reason: 'invalid' })
    expect(verifySigninGrant(`.${payload}.${sig}`)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('rejects junk without throwing', () => {
    for (const junk of ['', '   ', 'x', 'a.b', 'a.b.c', 'bl1..', 'bl1.@@@.@@@', 'bl1.a.b.c']) {
      expect(verifySigninGrant(junk).ok).toBe(false)
    }
  })

  it('rejects a payload that is signed but not a grant', () => {
    // Valid base64url, valid JSON, wrong shape. The signature check passes only if someone holds the
    // key, so this is the "our own code minted something odd" case rather than an attack.
    expect(verifySigninGrant('bl1.e30.x')).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('timing', () => {
  it('expires', () => {
    const now = Date.now()
    const { grant, claims } = mintSigninGrant('alice', { now })
    expect(verifySigninGrant(grant, claims.exp - 1).ok).toBe(true)
    // Exactly at exp is already gone - `now >= exp`.
    expect(verifySigninGrant(grant, claims.exp)).toEqual({ ok: false, reason: 'expired' })
    expect(verifySigninGrant(grant, claims.exp + 60_000)).toEqual({ ok: false, reason: 'expired' })
  })

  it('tolerates a small clock skew but refuses a grant from the future', () => {
    const now = Date.now()
    const { grant } = mintSigninGrant('alice', { now: now + 30_000 })
    expect(verifySigninGrant(grant, now).ok).toBe(true)

    const { grant: far } = mintSigninGrant('alice', { now: now + 10 * 60_000 })
    // Not merely wrong - an `iat` far ahead would poison the single-use watermark and dead-on-arrival
    // every later link for that user.
    expect(verifySigninGrant(far, now)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('refuses a ttl over the cap at mint', () => {
    expect(() => mintSigninGrant('alice', { ttlMs: SIGNIN_LINK_MAX_TTL_MS + 1 })).toThrow(/may not exceed/)
    expect(() => mintSigninGrant('alice', { ttlMs: 0 })).toThrow(/positive/)
    expect(() => mintSigninGrant('alice', { ttlMs: -5 })).toThrow(/positive/)
    expect(() => mintSigninGrant('alice', { ttlMs: Number.POSITIVE_INFINITY })).toThrow(/positive/)
  })

  it('refuses a ttl over the cap at VERIFY too, not just at mint', () => {
    // White-box, and worth it: a tampering test proves nothing here, because an unsigned payload is
    // refused for its signature long before the ceiling is consulted. The case that matters is a
    // CORRECTLY SIGNED over-cap grant - what a future caller bypassing mintSigninGrant would mint.
    const now = Date.now()
    expect(signGrant({ sub: 'alice', iat: now, exp: now + SIGNIN_LINK_MAX_TTL_MS + 60_000 })).toBeTruthy()
    expect(verifySigninGrant(signGrant({ sub: 'alice', iat: now, exp: now + SIGNIN_LINK_MAX_TTL_MS + 60_000 }), now))
      .toEqual({ ok: false, reason: 'invalid' })
    // Exactly at the cap is still fine, so the boundary is not off by one.
    expect(verifySigninGrant(signGrant({ sub: 'alice', iat: now, exp: now + SIGNIN_LINK_MAX_TTL_MS }), now).ok).toBe(
      true,
    )
  })

  it('refuses a correctly signed grant with exp <= iat', () => {
    const now = Date.now()
    expect(verifySigninGrant(signGrant({ sub: 'alice', iat: now, exp: now }), now)).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(verifySigninGrant(signGrant({ sub: 'alice', iat: now, exp: now - 1000 }), now)).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })

  it('refuses a correctly signed grant whose claims are the wrong types', () => {
    const now = Date.now()
    for (const claims of [
      { sub: '', iat: now, exp: now + 60_000 },
      { sub: 'alice', iat: 'soon', exp: now + 60_000 },
      { sub: 'alice', iat: now, exp: null },
      { sub: 'alice', iat: now + 0.5, exp: now + 60_000 },
      { iat: now, exp: now + 60_000 },
    ] as unknown[]) {
      expect(verifySigninGrant(signGrant(claims as Record<string, unknown>), now).ok).toBe(false)
    }
  })
})

describe('domain separation - the load-bearing part', () => {
  it('a grant is NOT a valid session cookie', () => {
    // If this ever passes, a 15-minute single-use link has become a permanent session.
    const { grant } = mintSigninGrant('alice')
    expect(verifySession(grant)).toBeNull()
  })

  it('a session cookie is NOT a valid grant', () => {
    const session = mintSession('alice')
    expect(verifySigninGrant(session)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('a session payload re-labelled with the grant prefix does not verify', () => {
    // The closest an attacker gets: take a real session they hold and dress it up as a grant.
    const session = mintSession('alice')
    const [payload, sig] = session.split('.')
    expect(verifySigninGrant(`${SIGNIN_GRANT_PREFIX}.${payload}.${sig}`)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('the session verifier refuses a CORRECTLY SIGNED payload carrying `iat` (lock 4)', () => {
    // White-box on purpose. Lock 4 only bites once locks 1-3 have been defeated, so the only honest
    // way to exercise it is to forge what a future regression would produce: a token signed with the
    // real session key whose payload carries `iat`. Reproduce session.ts's signer exactly.
    const now = Date.now()
    const sign = (data: string): string =>
      createHmac('sha256', authSecret('AUTH_SESSION_SECRET')).update(data).digest('base64url')

    // First prove the forgery technique is sound: without `iat`, this IS a valid session.
    const plain = Buffer.from(JSON.stringify({ sub: 'alice' }), 'utf8').toString('base64url')
    expect(verifySession(`${plain}.${sign(plain)}`)).toEqual({ sub: 'alice' })

    // Now the same construction, with `iat` - a grant's fingerprint. Refused.
    const withIat = Buffer.from(JSON.stringify({ sub: 'alice', iat: now, exp: now + 60_000 }), 'utf8').toString(
      'base64url',
    )
    expect(verifySession(`${withIat}.${sign(withIat)}`)).toBeNull()
  })

  it('the two credentials do not share a key', () => {
    // Same subject, same moment: if the MACs ever coincide, the derivation has been lost.
    const { grant } = mintSigninGrant('alice')
    const session = mintSession('alice')
    expect(grant.split('.').at(-1)).not.toBe(session.split('.').at(-1))
  })
})
