// Short-lived, single-use SIGN-IN LINKS (docs/core/AUTH.md § 1.7, 2026-09-15).
//
// What this replaces. Until now the magic link carried the user's PERMANENT access token in the URL
// path: `/api/auth/magic/<token>`. That token is the same credential their MCP client uses, it never
// expires, and a URL is the worst possible envelope for it - it lands in browser history, shell
// history, proxy logs, chat unfurl caches and AI transcripts, and every copy stays valid forever.
// Anyone who scrolled back far enough in any of those had a permanent full-account credential.
//
// What a grant is instead: a signed assertion that says "the bearer may become <sub>, once, before
// <exp>". It carries no secret of the user's, it cannot be turned into an API token, and it is worth
// nothing fifteen minutes later. That makes it safe for an agent to paste into a transcript, which
// is the entire point - the human never has to be shown a permanent credential just to sign in.
//
// It is deliberately NOT a row in a table. A grant is verifiable from its signature alone, so
// minting needs no write and costs nothing; the only state single-use requires is one watermark
// column on the user (see `consumeSigninGrant` in principal.ts).
//
// ## Why this is not just the session cookie with an `exp`
//
// It nearly was, and that would have been a vulnerability. `verifySession` still honours a legacy
// `exp` on cookies minted before 2026-07-29, and both credentials are an HMAC over b64url JSON
// carrying a `sub`. A grant of the obvious shape `{sub, exp}` signed with AUTH_SESSION_SECRET would
// therefore BE a valid session cookie - a single-use 15-minute link would hand over a permanent
// session, silently, and every test of the link itself would still pass.
//
// So domain separation is load-bearing here, not hygiene, and it is enforced four times over:
//
//   1. A different key. HKDF from the session secret with a purpose-specific `info` string, so the
//      two MACs are computed under keys that cannot be derived from each other.
//   2. The literal format prefix is INSIDE the signed string. Even if someone later "simplifies"
//      (1) away, a grant's MAC still cannot equal a session's MAC over the same payload.
//   3. A strict parse: exactly three dot-separated parts with a recognized format prefix. A session token
//      has two parts, so it cannot be read as a grant.
//   4. `verifySession` rejects any payload carrying `iat`, which only a grant has. So a grant
//      cannot be read as a session either - the exclusion runs in both directions.
//
// Anyone touching either file should assume (1) through (4) are each holding a real edge case up,
// because they are.

import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import { authSecret } from './secrets.js'

/** Version + type tag. Inside the MAC, so it is a domain separator and not merely a label. */
export const SIGNIN_GRANT_PREFIX = 'bl2'
const LEGACY_SIGNIN_GRANT_PREFIX = 'bl1'
// 160 bits is deliberately shorter on the wire than SHA-256's full output while retaining a vast
// online-forgery margin for a short-lived credential. bl1 remains readable during its lifetime.
const SIGNATURE_BYTES = 20

/** Default lifetime. Long enough to read a message, walk to a laptop and click; short enough that a
 *  grant left in a transcript is worthless by the time anyone scrolls back to it. */
export const SIGNIN_LINK_TTL_MS = 15 * 60_000

/** The hard ceiling a caller may ask for, enforced at BOTH mint and verify. Checking it again at
 *  verify means a forged-but-unsigned-able long TTL is still refused, and that a future caller who
 *  bypasses `mintSigninGrant` cannot mint an eternal link. */
export const SIGNIN_LINK_MAX_TTL_MS = 24 * 60 * 60 * 1000

/** Tolerance for a grant minted by a host whose clock runs slightly ahead of the one verifying. */
const CLOCK_SKEW_MS = 60_000

export interface SigninGrantClaims {
  /** The user id this grant signs in. */
  sub: string
  /** Minted at, epoch ms. Doubles as the single-use watermark (principal.ts). */
  iat: number
  /** Expires at, epoch ms. */
  exp: number
}

export type SigninGrantFailure = 'invalid' | 'expired'

export type SigninGrantResult = { ok: true; claims: SigninGrantClaims } | { ok: false; reason: SigninGrantFailure }

// Purpose-bound key derivation keeps sign-in grants separate from sessions. Rotating the
// session secret invalidates both sessions and outstanding grants.
const linkKey = (): Buffer =>
  Buffer.from(hkdfSync('sha256', authSecret('AUTH_SESSION_SECRET'), '', 'silkweave-box/signin-link/v1', 32))

const mac = (signed: string): Buffer => createHmac('sha256', linkKey()).update(signed).digest()
const sign = (signed: string, bytes = 32): string => mac(signed).subarray(0, bytes).toString('base64url')

function compactPayload(claims: SigninGrantClaims): string {
  const subject = Buffer.from(claims.sub, 'utf8')
  const payload = Buffer.allocUnsafe(10 + subject.length)
  payload.writeUIntBE(claims.iat, 0, 6)
  payload.writeUInt32BE(claims.exp - claims.iat, 6)
  subject.copy(payload, 10)
  return payload.toString('base64url')
}

/**
 * Mint a grant for `sub`. Pure crypto and no I/O - the caller decides whether the user may have one
 * (`issueSigninLink` in principal.ts does that, and is what callers should use).
 *
 * @throws if `ttlMs` is not a positive number within `SIGNIN_LINK_MAX_TTL_MS`.
 */
export function mintSigninGrant(
  sub: string,
  opts: { ttlMs?: number; now?: number } = {},
): { grant: string; claims: SigninGrantClaims } {
  const id = sub.trim()
  if (!id) throw new Error('a sign-in grant needs a user id')
  const ttlMs = opts.ttlMs ?? SIGNIN_LINK_TTL_MS
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('sign-in link ttl must be a positive number of ms')
  if (ttlMs > SIGNIN_LINK_MAX_TTL_MS) {
    throw new Error(`sign-in link ttl may not exceed ${SIGNIN_LINK_MAX_TTL_MS}ms (24h)`)
  }
  const iat = Math.floor(opts.now ?? Date.now())
  const claims: SigninGrantClaims = { sub: id, iat, exp: iat + Math.floor(ttlMs) }
  const payload = compactPayload(claims)
  const signed = `${SIGNIN_GRANT_PREFIX}.${payload}`
  return { grant: `${signed}.${sign(signed, SIGNATURE_BYTES)}`, claims }
}

function readCompactClaims(payload: string): SigninGrantClaims | null {
  const bytes = Buffer.from(payload, 'base64url')
  if (bytes.length < 11 || bytes.toString('base64url') !== payload) return null
  const iat = bytes.readUIntBE(0, 6)
  const exp = iat + bytes.readUInt32BE(6)
  const subject = bytes.subarray(10)
  const sub = subject.toString('utf8')
  if (!sub || !Buffer.from(sub, 'utf8').equals(subject)) return null
  return { sub, iat, exp }
}

function readLegacyClaims(payload: string): SigninGrantClaims | null {
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SigninGrantClaims
  } catch {
    return null
  }
}

/**
 * Verify a grant's signature and timing. Says nothing about whether it has already been used, or
 * whether the user still exists - that is `consumeSigninGrant`, which needs the warehouse.
 *
 * `invalid` and `expired` are distinguished only so the sign-in screen can tell someone WHY their
 * link did not work. Neither leaks anything: a grant's claims are not secret.
 */
export function verifySigninGrant(grant: string, now: number = Date.now()): SigninGrantResult {
  const parts = (grant ?? '').trim().split('.')
  // Lock 3: a session token has two parts, so it can never be parsed as a grant.
  if (parts.length !== 3) return { ok: false, reason: 'invalid' }
  const [prefix, payload, sig] = parts
  if (![SIGNIN_GRANT_PREFIX, LEGACY_SIGNIN_GRANT_PREFIX].includes(prefix) || !payload || !sig) {
    return { ok: false, reason: 'invalid' }
  }

  // Lock 2: the prefix is part of the signed string, not merely a label in front of it.
  const expected = sign(`${prefix}.${payload}`, prefix === SIGNIN_GRANT_PREFIX ? SIGNATURE_BYTES : 32)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'invalid' }

  const claims = prefix === SIGNIN_GRANT_PREFIX ? readCompactClaims(payload) : readLegacyClaims(payload)
  if (!claims) return { ok: false, reason: 'invalid' }

  const { sub, iat, exp } = claims ?? {}
  if (typeof sub !== 'string' || !sub.trim()) return { ok: false, reason: 'invalid' }
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return { ok: false, reason: 'invalid' }
  if (exp <= iat) return { ok: false, reason: 'invalid' }
  // Re-check the ceiling at verify, not just at mint: see SIGNIN_LINK_MAX_TTL_MS.
  if (exp - iat > SIGNIN_LINK_MAX_TTL_MS) return { ok: false, reason: 'invalid' }
  // A grant from the future is a broken clock or a forged payload, not a usable credential. It also
  // must not be honoured because `iat` is what the single-use watermark is compared against - one
  // dated far ahead would dead-on-arrival every later link for that user.
  if (iat > now + CLOCK_SKEW_MS) return { ok: false, reason: 'invalid' }
  if (now >= exp) return { ok: false, reason: 'expired' }

  return { ok: true, claims: { sub: sub.trim(), iat, exp } }
}
