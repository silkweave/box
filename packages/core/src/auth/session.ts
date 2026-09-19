// Signed, NON-EXPIRING, STATELESS session cookie for the Box. Payload is `{ sub }`
// HMAC-SHA256-signed with AUTH_SESSION_SECRET - no server-side session store. The cookie is HttpOnly
// + SameSite=Lax + (in prod) Secure. Revocation is still immediate: the auth guard re-checks the
// principal's status (users.status) on every request, so a revoked token's live session is rejected
// on its next call. See docs/AUTH.md.
//
// The server-side expiry was REMOVED 2026-07-29 (a product decision). The 7-day TTL signed everyone out
// weekly, which sent them looking for an access token they had not kept, which is how working MCP
// configs kept getting revoked by a fresh mint (docs/AUTH.md § Access tokens). Sessions now live as
// long as the browser keeps the cookie. Two things this does NOT change: sign-out is still exact
// (logout clears the cookie) and revoking a user still kills their live session on its next request.
// The trade-off accepted here is that a stolen cookie stays valid until the user is revoked.
//
// Cookies minted before the change carry an `exp` and are still honored until it passes - nobody was
// signed out by this, and no access token was touched.

import { authSecret } from './secrets.js'
import { isLoopbackPeer } from './security.js'
import { createHmac, timingSafeEqual } from 'node:crypto'

// How long the BROWSER is asked to keep the cookie. Not a server-side expiry - the server no longer
// has one - but a cookie needs a Max-Age or it dies when the browser closes. 400 days is the ceiling
// Chrome clamps to (and the practical max elsewhere), so this is "as long as browsers allow".
const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000
export const SESSION_COOKIE = 'box_session'

/** The verified session identity: a principal id (users.id) and nothing else. The tier the guard
 *  checks is deliberately NOT in here - it is read from the row on every request, so a demotion
 *  lands on the demoted user's next call rather than at their next sign-in (docs/core/AUTH.md § 3).
 *  Roles were removed from the cookie on 2026-09-10 with
 *  the rest of the access-control layer - a session says WHO, and nothing says who may do what. */
export interface SessionClaims {
  sub: string
}

// Env, else the per-Box generated file; placeholders and short values throw (auth/secrets.ts).
// The legacy PODS_SESSION_SECRET fallback went on 2026-09-13: no Box ever had one, and a fallback
// that silently changes which secret signs cookies is not a feature.
const secret = (): string => authSecret('AUTH_SESSION_SECRET')

const b64url = (s: string): string => Buffer.from(s, 'utf8').toString('base64url')
const unb64url = (s: string): string => Buffer.from(s, 'base64url').toString('utf8')
const sign = (data: string): string => createHmac('sha256', secret()).update(data).digest('base64url')

/** Mint a session token for a principal id. No `exp` is written - sessions do not expire. */
export function mintSession(sub: string): string {
  const payload = b64url(JSON.stringify({ sub }))
  return `${payload}.${sign(payload)}`
}

/** Verify a session token -> the claims, or null if invalid/tampered (or carrying a legacy `exp`
 *  that has already passed - cookies minted before the TTL was removed still age out as issued). */
export function verifySession(token: string | undefined): SessionClaims | null {
  if (!token) return null
  const [payload, sig] = token.split('.')
  if (!payload || !sig) return null
  const expected = sign(payload)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    // Extra keys are IGNORED, not rejected: every cookie minted before 2026-09-10 carries a `role`,
    // and reading only `sub` is what lets those keep working instead of signing everybody out.
    const { sub, exp, iat } = JSON.parse(unb64url(payload)) as { sub: string; exp?: number; iat?: number }
    if (!sub) return null
    // Lock 4 of the session/sign-in-link domain separation (auth/link.ts). Only a sign-in grant
    // carries `iat`, so refusing it here means a grant can never be read as a session - the
    // exclusion runs in both directions rather than relying on the key derivation alone. Three
    // other locks already make this unreachable; it is one line, and the failure it guards against
    // is a 15-minute link silently becoming a permanent session.
    if (iat !== undefined) return null
    if (typeof exp === 'number' && Date.now() > exp) return null
    return { sub }
  } catch {
    return null
  }
}

/** Parse a Cookie header into a name->value map. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

/**
 * Build a Set-Cookie value. `maxAgeMs<=0` clears the cookie.
 *
 * `secure` is DERIVED FROM THE REQUEST by the caller (`requestIsSecure`), not from an env var
 * (docs/core/AUTH.md § 1.6, implemented 2026-09-14). It used to be `Secure` unless
 * `AUTH_COOKIE_INSECURE=1`, which is backwards: a cookie that can only ever be set over `http://`
 * gains nothing from `Secure` and loses everything, because the browser drops it and the sign-in
 * silently fails back to the login screen with no error anywhere.
 *
 * That cost is not hypothetical. Chromium treats `localhost` as a secure context and stores the
 * cookie anyway, so `box dev` worked for everyone who tested in Chrome; Safari does not, so
 * Safari could not sign in to a local Box at all. The flag defaulted the wrong way for the one
 * case a first-time user is guaranteed to hit.
 */
export function sessionCookie(value: string, maxAgeMs = COOKIE_MAX_AGE_MS, secure = false): string {
  const maxAge = Math.max(0, Math.floor(maxAgeMs / 1000))
  const flag = secure ? '; Secure' : ''
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax${flag}; Max-Age=${maxAge}`
}

/**
 * Did this request arrive over TLS? The input to `sessionCookie`'s `Secure` flag.
 *
 * Two ways to be sure: the socket is a TLS socket, or a loopback proxy said so with
 * `x-forwarded-proto: https` (`tailscale serve` sets it). The peer check matters - anyone can send
 * that header, and honouring it from an arbitrary peer would let a caller mark its own cookie
 * `Secure` over plain http, which is a way to make a cookie the browser then refuses to send back.
 *
 * If a proxy in front of this Box does not set the header, the cookie is simply not marked
 * `Secure` - which is exactly the protection a plain-http deployment can honestly have.
 */
export function requestIsSecure(req: {
  socket?: { encrypted?: boolean; remoteAddress?: string | null }
  headers?: Record<string, unknown>
}): boolean {
  if (req.socket?.encrypted) return true
  if (!isLoopbackPeer(req.socket?.remoteAddress)) return false
  const proto = req.headers?.['x-forwarded-proto']
  const first = (Array.isArray(proto) ? proto[0] : proto) as string | undefined
  return (first ?? '').split(',')[0]?.trim().toLowerCase() === 'https'
}
