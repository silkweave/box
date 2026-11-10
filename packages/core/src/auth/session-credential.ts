// Session credentials (docs/AUTH.md "Session credentials"): the only Box credential a serving
// session (room agent, delegate and upkeep jobs, automation agent triggers) or a member's Work
// session holds. `bx-session-<jws>`, an HMAC-SHA256 compact JWS over
// `{ sub, sid, kind, scope, toolset, iat, exp }`.
//
// Fail-closed by construction, unlike a token with a denylist:
//
// - the signing key is generated at boot and lives only in this process, so a restart
//   invalidates every credential, however unexpired;
// - the session id must be live in the registry below on every request and every renewal, and the
//   claims must match what the registry holds; closing a session removes it;
// - the credential resolves to its `sub` with that principal's own access (re-read per request),
//   narrowed by the toolset; it never carries more, and admin authority only if `sub` is an admin;
// - renewal re-runs the session's own check (liveness, coverage, engine, toolset); the model
//   never supplies claims.

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { policyGateHold } from './policy-gate.js'

export const SESSION_CREDENTIAL_PREFIX = 'bx-session-'

export type SessionKind = 'serving' | 'work'

export interface SessionCredentialClaims {
  sub: string
  sid: string
  kind: SessionKind
  /** What the session serves: `room:<id>`, `job:<id>`, `work:<user>`. Session controls check it. */
  scope: string
  /** The toolset that narrows it, or null for the principal's full Box surface. */
  toolset: string | null
  iat: number
  exp: number
}

/** What a request authenticated with a session credential carries on its principal. */
export interface SessionGrant {
  sid: string
  kind: SessionKind
  scope: string
  toolset: string | null
}

interface SessionEntry extends SessionGrant {
  sub: string
  /** Re-run on every renewal; a refusal (a string) ends the session. */
  recheck?: () => Promise<string | null> | string | null
  /** Run on every authentication with this session's credential; a refusal ends the session. */
  admit?: () => Promise<string | null> | string | null
  ttlMs: number
  /** When the newest credential stops working; the entry is dropped then, used or not. */
  expiresAt: number
}

/** Drop sessions whose newest credential has expired (an opened session that never ran included). */
function pruneExpired(now: number): void {
  for (const entry of registry.values()) if (entry.expiresAt <= now) registry.delete(entry.sid)
}

const KEY = randomBytes(32)
const registry = new Map<string, SessionEntry>()
const DEFAULT_TTL_MS = 15 * 60_000

const b64 = (buf: Buffer | string): string => Buffer.from(buf).toString('base64url')
const HEADER = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))

function sign(claims: SessionCredentialClaims): string {
  const body = `${HEADER}.${b64(JSON.stringify(claims))}`
  const sig = createHmac('sha256', KEY).update(body).digest('base64url')
  return `${SESSION_CREDENTIAL_PREFIX}${body}.${sig}`
}

function decode(token: string): SessionCredentialClaims | null {
  if (!token.startsWith(SESSION_CREDENTIAL_PREFIX)) return null
  const parts = token.slice(SESSION_CREDENTIAL_PREFIX.length).split('.')
  if (parts.length !== 3 || parts[0] !== HEADER) return null
  const expected = createHmac('sha256', KEY).update(`${parts[0]}.${parts[1]}`).digest()
  const given = Buffer.from(parts[2]!, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')) as SessionCredentialClaims
    if (typeof claims.sub !== 'string' || typeof claims.sid !== 'string' || typeof claims.exp !== 'number') return null
    return claims
  } catch {
    return null
  }
}

export interface OpenSessionInput {
  sub: string
  kind: SessionKind
  scope: string
  toolset?: string | null
  ttlMs?: number
  recheck?: SessionEntry['recheck']
  admit?: SessionEntry['admit']
}

/** Register a live session and mint its first credential. Server code only; never a handler's input. */
export function openSessionCredential(input: OpenSessionInput, now: number = Date.now()): { sid: string; credential: string; exp: number } {
  if (!input.sub || !input.scope) throw new Error('a session credential needs a principal and a scope')
  // An unresolved file-backed policy change (policy-gate.ts): no session starts against it.
  const held = policyGateHold()
  if (held) throw new Error(`no new sessions: ${held}`)
  pruneExpired(now)
  const sid = randomUUID()
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS
  const exp = now + ttlMs
  const entry: SessionEntry = {
    sid,
    sub: input.sub,
    kind: input.kind,
    scope: input.scope,
    toolset: input.toolset ?? null,
    ttlMs,
    expiresAt: exp,
    ...(input.recheck ? { recheck: input.recheck } : {}),
    ...(input.admit ? { admit: input.admit } : {}),
  }
  registry.set(sid, entry)
  return { sid, credential: sign({ sub: entry.sub, sid, kind: entry.kind, scope: entry.scope, toolset: entry.toolset, iat: now, exp }), exp }
}

/** Verify a credential: signature, expiry, a live session whose registry entry matches every claim. */
export function verifySessionCredential(token: string, now: number = Date.now()): (SessionGrant & { sub: string }) | null {
  const claims = decode(token)
  if (!claims) return null
  const entry = registry.get(claims.sid)
  if (entry && entry.expiresAt <= now) registry.delete(entry.sid)
  if (!entry || claims.exp <= now || entry.expiresAt <= now) return null
  if (entry.sub !== claims.sub || entry.kind !== claims.kind || entry.scope !== claims.scope || entry.toolset !== claims.toolset) return null
  return { sub: entry.sub, sid: entry.sid, kind: entry.kind, scope: entry.scope, toolset: entry.toolset }
}

/**
 * A fresh credential for a live session, after its own recheck passes. The current credential must
 * verify (an expired one cannot be renewed). A refused recheck closes the session.
 */
export async function renewSessionCredential(token: string, now: number = Date.now()): Promise<{ credential: string; exp: number }> {
  const grant = verifySessionCredential(token, now)
  if (!grant) throw new Error('session credential is not live')
  const entry = registry.get(grant.sid)!
  let refusal: string | null
  try {
    refusal = entry.recheck ? await entry.recheck() : null
  } catch (error) {
    refusal = `its check failed (${error instanceof Error ? error.message || error.name : String(error)})`
  }
  if (refusal != null) {
    registry.delete(grant.sid)
    throw new Error(`session ended: ${refusal || 'refused'}`)
  }
  if (!registry.has(grant.sid)) throw new Error('session credential is not live')
  const exp = now + entry.ttlMs
  entry.expiresAt = exp
  return { credential: sign({ sub: entry.sub, sid: entry.sid, kind: entry.kind, scope: entry.scope, toolset: entry.toolset, iat: now, exp }), exp }
}

/**
 * Re-run every live session's own check now (a policy revision: roles, toolsets, membership).
 * A refusal closes that session; a check that throws counts as a refusal. Returns the closed ids.
 */
export async function recheckLiveSessions(now: number = Date.now()): Promise<string[]> {
  pruneExpired(now)
  const closed: string[] = []
  // Deleting the current entry while iterating a Map is safe.
  for (const entry of registry.values()) {
    if (!entry.recheck) continue
    // Fail closed: a throw (whatever its message) or any string, empty included, is a refusal.
    let refused: boolean
    try {
      refused = (await entry.recheck()) != null
    } catch {
      refused = true
    }
    if (refused && registry.delete(entry.sid)) closed.push(entry.sid)
  }
  return closed
}

/**
 * Admit one request carrying a verified credential of session `sid`: runs the session's own `admit`
 * check (a Work session: the person may still use Work with its data). A refusal, or a check that
 * throws, closes the session. A session without a check is admitted.
 */
export async function admitSessionCredential(sid: string): Promise<boolean> {
  const entry = registry.get(sid)
  if (!entry) return false
  if (!entry.admit) return true
  // Fail closed: a throw (whatever its message) or any string, empty included, is a refusal.
  let refused: boolean
  try {
    refused = (await entry.admit()) != null
  } catch {
    refused = true
  }
  if (refused) {
    registry.delete(sid)
    return false
  }
  return registry.has(sid)
}

/** End a session: every credential it was given stops working on its next request. */
export function closeSessionCredential(sid: string): boolean {
  return registry.delete(sid)
}

/** End every live session matching `predicate` (a policy change that breaks their coverage). */
export function closeSessionsWhere(predicate: (grant: SessionGrant & { sub: string }) => boolean): string[] {
  const closed: string[] = []
  for (const entry of registry.values()) {
    if (predicate({ sub: entry.sub, sid: entry.sid, kind: entry.kind, scope: entry.scope, toolset: entry.toolset })) {
      registry.delete(entry.sid)
      closed.push(entry.sid)
    }
  }
  return closed
}

/** The live sessions (for "explain access" and tests). */
export function liveSessions(): (SessionGrant & { sub: string })[] {
  return [...registry.values()].map(({ sid, sub, kind, scope, toolset }) => ({ sid, sub, kind, scope, toolset }))
}

/** Whether a presented credential is a session credential (rather than an access token). */
export function isSessionCredential(token: string): boolean {
  return token.startsWith(SESSION_CREDENTIAL_PREFIX)
}

/**
 * Whether a caller may act for `scope` (a room or job control: report a job's result, file under a
 * job, draft for a delegate run). A caller without a session credential passes: its own rules
 * apply (the handler's runAs or ownership check). A session credential passes only when it serves
 * exactly `scope`, so one job's session cannot report or file for another job of the same agent.
 */
export function sessionServes(session: Pick<SessionGrant, 'scope'> | null | undefined, scope: string): boolean {
  return !session || session.scope === scope
}
