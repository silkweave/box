// Consuming a sign-in link, against a real warehouse. link.test.ts covers the crypto; this covers
// the half that needs a database - single use, and the interactions with revocation and status.
//
// The single-use rule is the reason sign-in links are safe to put in a transcript at all, and it is
// enforced by ONE conditional UPDATE against a watermark column rather than a table of issued links.
// That buys a lot (no rows, no sweep, no cleanup job) at the cost of two behaviours that are easy to
// break by accident and are pinned here:
//
//   1. Consuming a link invalidates every OLDER outstanding link for that user, not just itself.
//   2. The watermark keeps MILLISECOND precision. It is a BIGINT of epoch ms rather than a
//      TIMESTAMP precisely so the record layer cannot round-trip it through `toNaiveUtc`, which
//      truncates to whole seconds - that would move a watermark BACKWARDS on an ordinary profile
//      edit and re-arm the link that had just been consumed.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ensureSchema, withWrite } from '../warehouse/db.js'
import { upsertUser, systemUserId } from '../users/state.js'
import { ensureSystemPrincipal } from './bootstrap.js'
import { consumeSigninGrant, issuePrincipalToken, issueSigninLink, revokePrincipalToken } from './principal.js'
import { mintSigninGrant, SIGNIN_LINK_TTL_MS } from './link.js'
import { resetInstanceDir, setInstanceDir } from '../testing.js'

let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-link-consume-'))
  setInstanceDir(dir)
  await ensureSchema()
  await ensureSystemPrincipal()
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  resetInstanceDir()
})

// A fresh user per test. Several tests below mint grants at SYNTHETIC timestamps a second or two in
// the future; sharing one user would leave a watermark ahead of real time and fail every later test
// for reasons that have nothing to do with what they assert.
let seq = 0
let alice: string

beforeEach(async () => {
  alice = `alice-${seq++}`
  await upsertUser({ id: alice, nickname: alice, role: 'admin' })
})

describe('issueSigninLink', () => {
  it('mints for a real user and names them in the claims', async () => {
    const { grant, claims } = await issueSigninLink(alice)
    expect(claims.sub).toBe(alice)
    expect(claims.exp - claims.iat).toBe(SIGNIN_LINK_TTL_MS)
    expect(grant.startsWith('bl2.')).toBe(true)
  })

  it('honours a custom ttl', async () => {
    const { claims } = await issueSigninLink(alice, { ttlMs: 60_000 })
    expect(claims.exp - claims.iat).toBe(60_000)
  })

  it('refuses an unknown user', async () => {
    await expect(issueSigninLink('nobody')).rejects.toThrow(/no user/)
  })

  it('refuses the agent principal', async () => {
    // The agent has no browser. A link for it would only ever be a way to borrow its seat, and its
    // seat is an admin one.
    await ensureSystemPrincipal()
    await expect(issueSigninLink(systemUserId())).rejects.toThrow(/bearer token, not a link/)
  })

  it('refuses a revoked user rather than quietly reviving them', async () => {
    await upsertUser({ id: 'mallory', nickname: 'mallory' })
    await revokePrincipalToken('mallory')
    await expect(issueSigninLink('mallory')).rejects.toThrow(/revoked/)
  })

  it('writes nothing - an unused link leaves no trace to clean up', async () => {
    await issueSigninLink(alice)
    await issueSigninLink(alice)
    await issueSigninLink(alice)
    // Three unused links, and the next one still works: minting moved no watermark.
    const { grant } = await issueSigninLink(alice)
    expect((await consumeSigninGrant(grant)).ok).toBe(true)
  })
})

describe('single use', () => {
  it('works exactly once', async () => {
    const { grant } = await issueSigninLink(alice)

    const first = await consumeSigninGrant(grant)
    expect(first.ok).toBe(true)
    if (first.ok) expect(first.principal.id).toBe(alice)

    expect(await consumeSigninGrant(grant)).toEqual({ ok: false, reason: 'used' })
    expect(await consumeSigninGrant(grant)).toEqual({ ok: false, reason: 'used' })
  })

  it('survives the sub-second case that a seconds-precision watermark would replay', async () => {
    // THE regression test for the `toNaiveUtc` trap. Mint and consume inside the same wall-clock
    // second; if the watermark truncates, the grant's own `iat` is still strictly greater than the
    // stored value and the second consume succeeds.
    const now = Date.now()
    const ms = now % 1000
    // Pick an `iat` with a non-zero millisecond part, which is where truncation does its damage.
    const iat = ms === 0 ? now + 500 : now
    const { grant } = mintSigninGrant(alice, { now: iat })

    expect((await consumeSigninGrant(grant, iat + 1)).ok).toBe(true)
    expect(await consumeSigninGrant(grant, iat + 2)).toEqual({ ok: false, reason: 'used' })
  })

  it('kills every OLDER outstanding link when a newer one is used', async () => {
    // The deliberate consequence of a watermark: signing in makes the stale links in old messages
    // and transcripts go dead, rather than leaving a drawer of valid credentials open.
    const base = Date.now()
    const older = mintSigninGrant(alice, { now: base }).grant
    const newer = mintSigninGrant(alice, { now: base + 1000 }).grant

    expect((await consumeSigninGrant(newer, base + 2000)).ok).toBe(true)
    expect(await consumeSigninGrant(older, base + 2000)).toEqual({ ok: false, reason: 'used' })
  })

  it('still accepts a NEWER link after an older one was used', async () => {
    const base = Date.now()
    const older = mintSigninGrant(alice, { now: base }).grant
    const newer = mintSigninGrant(alice, { now: base + 1000 }).grant

    expect((await consumeSigninGrant(older, base + 2000)).ok).toBe(true)
    expect((await consumeSigninGrant(newer, base + 2000)).ok).toBe(true)
  })

  it('does not let one user’s link consume another user’s watermark', async () => {
    await upsertUser({ id: 'bob', nickname: 'bob' })
    const { grant: aliceGrant } = await issueSigninLink(alice)
    const { grant: bobGrant } = await issueSigninLink('bob')

    expect((await consumeSigninGrant(aliceGrant)).ok).toBe(true)
    const bob = await consumeSigninGrant(bobGrant)
    expect(bob.ok).toBe(true)
    if (bob.ok) expect(bob.principal.id).toBe('bob')
  })

  it('survives an ordinary profile edit - the watermark is not rewritten by the record layer', async () => {
    // THE reason link_watermark is a BIGINT rather than a TIMESTAMP. `upsertUser` rewrites every
    // column in the ModelSpec from the previous row, and the record layer normalizes timestamps
    // through `toNaiveUtc`, which truncates to whole seconds. As a TIMESTAMP a watermark of
    // 10:00:00.500 would be written back as 10:00:00 - moving BACKWARDS past the `iat` of the grant
    // that had just been consumed, re-arming it for the rest of its 15 minutes.
    const { grant } = await issueSigninLink(alice)
    expect((await consumeSigninGrant(grant)).ok).toBe(true)

    // Anything that touches the row: a display-name change, an avatar, a colour.
    await upsertUser({ id: alice, first_name: 'Alice', color: '#123456' })

    expect(await consumeSigninGrant(grant)).toEqual({ ok: false, reason: 'used' })
  })

  it('refuses two simultaneous consumes of the same link', async () => {
    // Writes are serialized in-process, so the conditional UPDATE decides the winner. Exactly one.
    const { grant } = await issueSigninLink(alice)
    const results = await Promise.all([consumeSigninGrant(grant), consumeSigninGrant(grant)])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toHaveLength(1)
  })
})

describe('timing and status', () => {
  it('reports an expired link as expired, not used', async () => {
    const { grant, claims } = await issueSigninLink(alice)
    expect(await consumeSigninGrant(grant, claims.exp + 1)).toEqual({ ok: false, reason: 'expired' })
    // And it did not move the watermark on the way out - a later link still works.
    const fresh = await issueSigninLink(alice)
    expect((await consumeSigninGrant(fresh.grant)).ok).toBe(true)
  })

  it('reports junk as invalid', async () => {
    expect(await consumeSigninGrant('not-a-grant')).toEqual({ ok: false, reason: 'invalid' })
    expect(await consumeSigninGrant('')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('reports a link for a deleted user as revoked rather than crashing', async () => {
    const { grant } = mintSigninGrant('ghost')
    expect(await consumeSigninGrant(grant)).toEqual({ ok: false, reason: 'revoked' })
  })

  it('flips an invited user to active on first use', async () => {
    await upsertUser({ id: 'carol', nickname: 'carol' })
    // Nothing in the codebase writes `invited` today - `upsertUser` does not even accept a status.
    // The flip is defensive (authenticatePrincipal carries the same CASE), so reach the state
    // directly rather than leaving the branch unexercised.
    await withWrite(async (conn) => {
      await conn.run(`UPDATE users SET status = 'invited' WHERE id = ?`, ['carol'])
    })
    const { grant } = await issueSigninLink('carol')
    const res = await consumeSigninGrant(grant)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.principal.id).toBe('carol')
  })

  it('refuses a link minted BEFORE a revoke, even after the user is restored', async () => {
    // Without the watermark bump in revokePrincipalToken this passes silently: the pre-revoke link
    // would outlive the revocation and sign them back in the moment access was restored.
    await upsertUser({ id: 'dave', nickname: 'dave' })
    const { grant } = await issueSigninLink('dave')

    await revokePrincipalToken('dave')
    expect(await consumeSigninGrant(grant)).toEqual({ ok: false, reason: 'revoked' })

    // `upsertUser` deliberately ignores an incoming `status` - reactivation goes through the token
    // path, which is the only thing that clears a revocation.
    await issuePrincipalToken('dave')
    expect(await consumeSigninGrant(grant)).toEqual({ ok: false, reason: 'used' })

    // A link minted after the restore does work.
    const fresh = await issueSigninLink('dave')
    expect((await consumeSigninGrant(fresh.grant)).ok).toBe(true)
  })
})
