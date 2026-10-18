// The principal layer: authenticate a user by their access token, resolve a principal by id for the
// per-request session re-check, and mint/revoke tokens. Sits on the shared `users` table + the
// access-token crypto in token.ts. This is the auth layer's data path, and since 2026-09-10 it is
// the WHOLE of it: a principal says who is calling, and nothing anywhere says who may do what. See
// docs/AUTH.md.

import { agentIdentity } from '../box-config.js'
import { timingSafeEqual } from 'node:crypto'
import { withRead, withWrite } from '../warehouse/db.js'
import { assertKnownActor, kindOf, systemUserId } from '../users/state.js'
import type { UserKind, UserRole } from '../users/types.js'
import { activeAgentConfig, agentRowProblem } from '../agents.js'
import { decryptToken, encryptToken, generateAccessToken } from './token.js'
import { mintSigninGrant, verifySigninGrant, type SigninGrantClaims } from './link.js'
import { SESSION_COOKIE, parseCookies, verifySession } from './session.js'

/** The authenticated identity attached to every request. */
export interface Principal {
  id: string
  display: string
  /**
   * The trust tier, re-read from the row on EVERY request (it is not in the cookie, so a demotion
   * takes effect on the demoted user's next call rather than at their next sign-in). The guard
   * compares it against `@Admin()`; see docs/core/AUTH.md § 3.
   */
  role: UserRole
  /**
   * Human or agent, from the row. An agent is a principal only while it is eligible (agents.ts
   * `agentRowProblem`): its name and role then come from config, never from the row.
   */
  kind: UserKind
}

/**
 * How a principal proved itself on THIS request. `session` is the signed cookie the dashboard
 * carries - a browser with a person sitting at it. `bearer` is an access token - an API client: MCP,
 * the `cli` proxy, a script, the chat agent's own calls.
 *
 * The same split the CSRF rule already keys on, surfaced because one class of route needs it for a
 * different reason: a destructive chat operation lets a `session` principal act directly and holds a
 * `bearer` one for an in-channel approval (`chatOpNeedsApproval`). A model driving an MCP client
 * cannot choose how its client authenticates, which is what makes this a boundary rather than a hint.
 */
export type PrincipalCredential = 'session' | 'bearer'

/** A stored role string, defensively narrowed - an unknown value is the least privilege, not a throw. */
const roleOf = (v: string | null | undefined): UserRole => (v === 'admin' ? 'admin' : 'member')

interface PrincipalRow { id: string; nickname: string; first_name: string; role: string; status: string; kind: string | null; token_revoked_at?: string | null }

/**
 * The principal a row stands for, or null when it may not act. A human row is judged by its
 * status; an agent row by the eligibility predicate (row AND file, read now), and its display name
 * and role come from config: a missing or invalid file never falls back to the stored role.
 */
function principalOf(r: PrincipalRow): Principal | null {
  if (r.status === 'revoked') return null
  if (kindOf(r.kind) === 'agent') {
    const config = activeAgentConfig(r)
    if (!config) return null
    return { id: r.id, display: config.name, role: config.role, kind: 'agent' }
  }
  // A row core:007 has not marked yet is still the system principal (bootstrap marks it).
  if (r.id === systemUserId()) {
    const agent = agentIdentity()
    return { id: r.id, display: agent.name, role: agent.role, kind: 'agent' }
  }
  return { id: r.id, display: r.nickname || r.first_name || r.id, role: roleOf(r.role), kind: 'human' }
}

/**
 * Resolve a row, and persist a retirement the predicate observed. An active agent row whose file is
 * gone or invalid is retired the moment any check sees it, not only at the next boot: otherwise
 * deleting a file and putting it back between two boots would revive the old token. Re-adding the
 * file then restores at the next boot, which drops that token (auth/bootstrap.ts).
 */
async function judge(r: PrincipalRow): Promise<Principal | null> {
  const principal = principalOf(r)
  if (!principal && kindOf(r.kind) === 'agent' && r.status !== 'revoked' && !r.token_revoked_at) await retireObserved(r.id)
  return principal
}

async function retireObserved(id: string): Promise<void> {
  if (id === systemUserId()) return
  await withWrite(async (conn) => {
    await conn.run(
      `UPDATE users SET token_revoked_at = now(), status = 'revoked', link_watermark = ?, updated_at = now()
        WHERE id = ? AND kind = 'agent' AND status <> 'revoked'`,
      [Date.now(), id],
    )
  })
  console.info(`agents: retired "${id}" (its file in data/config/agents/ is missing or invalid)`)
}

const PRINCIPAL_COLUMNS = `id, nickname, first_name, role, status, kind, CAST(token_revoked_at AS VARCHAR) AS token_revoked_at`

/**
 * Resolve a presented access token to an ACTIVE principal. Decrypts each non-revoked user's token
 * and constant-time compares. Stamps token_last_used_at + flips an invited user to active on first use. Returns null on no match / revoked / disabled.
 */
export async function authenticatePrincipal(presented: string): Promise<Principal | null> {
  if (!presented) return null
  const rows = await withRead<PrincipalRow & { token_ciphertext: string | null }>(
    `SELECT ${PRINCIPAL_COLUMNS}, token_ciphertext
       FROM users
      WHERE token_ciphertext IS NOT NULL AND token_revoked_at IS NULL AND status <> 'revoked'`,
  )
  for (const r of rows) {
    let actual: string
    try {
      actual = decryptToken(r.token_ciphertext!)
    } catch {
      continue
    }
    const a = Buffer.from(presented)
    const b = Buffer.from(actual)
    if (a.length === b.length && timingSafeEqual(a, b)) {
      // The token is right, but an agent whose file is gone or invalid is retired NOW, not at the
      // next boot: no use stamp, no principal.
      const principal = await judge(r)
      if (!principal) return null
      await withWrite(async (conn) => {
        await conn.run(
          `UPDATE users SET token_last_used_at = now(),
             status = CASE WHEN status = 'invited' THEN 'active' ELSE status END WHERE id = ?`,
          [r.id],
        )
      })
      return principal
    }
  }
  return null
}

/**
 * Resolve a principal by id for the per-request session re-check (immediate revocation): returns null
 * if the user is gone or their status is revoked, so a live session dies on its next request.
 */
export async function resolvePrincipalById(id: string): Promise<Principal | null> {
  if (!id) return null
  const rows = await withRead<PrincipalRow>(`SELECT ${PRINCIPAL_COLUMNS} FROM users WHERE id = ?`, [id])
  return rows[0] ? judge(rows[0]) : null
}

/** Every agent that may act right now (the eligibility predicate), the system principal first. */
export async function activeAgentPrincipals(): Promise<Principal[]> {
  const rows = await withRead<PrincipalRow>(
    `SELECT ${PRINCIPAL_COLUMNS} FROM users WHERE kind = 'agent' OR id = ? ORDER BY id`,
    [systemUserId()],
  )
  const system = systemUserId()
  return rows
    .map(principalOf)
    .filter((p): p is Principal => p !== null && p.kind === 'agent')
    .sort((a, b) => Number(b.id === system) - Number(a.id === system))
}

/**
 * The person a session cookie names, or null. The one cookie resolver every transport uses (the
 * Nest guard, the /agent mount, path mounts, the dev proxy): a session is a person at a browser,
 * so a cookie naming an agent is refused here, whenever and however it was issued.
 */
export async function resolveSessionPrincipal(cookieHeader: string | undefined): Promise<Principal | null> {
  const claims = verifySession(parseCookies(cookieHeader)[SESSION_COOKIE])
  if (!claims) return null
  const principal = await resolvePrincipalById(claims.sub)
  return principal?.kind === 'human' ? principal : null
}

/**
 * Mint (or rotate) an access token for ANY user (internal or collaborator). Returns the PLAINTEXT
 * token once (stored encrypted at rest). Clears any prior revocation + reactivates a revoked user.
 */
export async function issuePrincipalToken(id: string, actor?: string): Promise<string> {
  // A plain existence check, NOT resolvePrincipalById - that one rejects status='revoked', which
  // would make reactivating a disabled user impossible (the whole point of re-issuing).
  const rows = await withRead<{ id: string; kind: string | null; status: string; token_revoked_at: string | null }>(
    `SELECT id, kind, status, CAST(token_revoked_at AS VARCHAR) AS token_revoked_at FROM users WHERE id = ?`,
    [id],
  )
  if (!rows[0]) throw new Error(`no user "${id}"`)
  // An agent is restored through its file (boot reconciliation), never by issuing it a token: this
  // rotates an ACTIVE agent's token on the host and refuses a retired one.
  if (kindOf(rows[0].kind) === 'agent') {
    const problem = agentRowProblem(rows[0])
    if (problem) throw new Error(`${problem}; an agent is restored by restoring its file and restarting, not by issuing a token`)
  }
  if (actor) await assertKnownActor(actor)
  const token = generateAccessToken()
  const ciphertext = encryptToken(token)
  await withWrite(async (conn) => {
    await conn.run(
      `UPDATE users SET token_ciphertext = ?, token_issued_at = now(), token_revoked_at = NULL,
         status = CASE WHEN status = 'revoked' THEN 'active' ELSE status END,
         updated_at = now(), updated_by = ? WHERE id = ?`,
      [ciphertext, actor ?? null, id],
    )
  })
  return token
}

/**
 * The access token a server-owned session (chat agent, trigger job, wiki job) carries for `id`:
 * the principal's existing token, or a first one when none exists. One read-check-write under the
 * warehouse write lock, so two sessions starting at once share one token instead of rotating each
 * other's. Refuses a missing or revoked principal: unlike `issuePrincipalToken`, which is the
 * operator's explicit restore, this never reactivates anyone and never rotates a working token.
 */
export async function sessionPrincipalToken(id: string): Promise<string> {
  return withWrite(async (conn) => {
    const reader = await conn.runAndReadAll(
      `SELECT id, kind, status, token_ciphertext, CAST(token_revoked_at AS VARCHAR) AS token_revoked_at FROM users WHERE id = ?`,
      [id],
    )
    const r = reader.getRowObjectsJson()[0] as { id: string; kind: string | null; status: string; token_ciphertext: string | null; token_revoked_at: string | null } | undefined
    if (!r) throw new Error(`no user "${id}"`)
    // The eligibility predicate: a retired agent (file gone or invalid) gets no session token.
    const problem = agentRowProblem(r)
    if (problem) {
      if (kindOf(r.kind) === 'agent' && r.status !== 'revoked' && !r.token_revoked_at && id !== systemUserId()) {
        await conn.run(
          `UPDATE users SET token_revoked_at = now(), status = 'revoked', link_watermark = ?, updated_at = now() WHERE id = ?`,
          [Date.now(), id],
        )
        console.info(`agents: retired "${id}" (its file in data/config/agents/ is missing or invalid)`)
      }
      throw new Error(`${problem}; a session cannot act as it`)
    }
    if (r.status === 'revoked' || r.token_revoked_at) throw new Error(`"${id}" has been revoked; a session cannot act as them until an admin restores their access`)
    if (r.token_ciphertext) {
      try {
        return decryptToken(r.token_ciphertext)
      } catch {
        // Undecryptable (the token secret changed): no holder can use it, so a fresh one costs nothing.
      }
    }
    const token = generateAccessToken()
    await conn.run(`UPDATE users SET token_ciphertext = ?, token_issued_at = now(), updated_at = now() WHERE id = ?`, [encryptToken(token), id])
    return token
  })
}

/** Return ANY user's current plaintext access token (re-copying an invite without rotating), or
 *  null when none was issued, it was revoked, or it does not decrypt. Callers gate access - the
 *  users controller exposes this admin-only. */
export async function revealPrincipalToken(id: string): Promise<string | null> {
  const rows = await withRead<{ token_ciphertext: string | null; token_revoked_at: string | null }>(
    `SELECT token_ciphertext, CAST(token_revoked_at AS VARCHAR) AS token_revoked_at FROM users WHERE id = ?`,
    [id],
  )
  const r = rows[0]
  if (!r?.token_ciphertext || r.token_revoked_at) return null
  try {
    return decryptToken(r.token_ciphertext)
  } catch {
    return null
  }
}

/**
 * Mint a short-lived, single-use SIGN-IN LINK grant for `id` (auth/link.ts).
 *
 * This is the credential a human should be handed to get into a Box. It is not their access token,
 * it cannot be exchanged for one, and it is worth nothing after ~15 minutes - which is what makes it
 * safe for an agent to print into a transcript on someone's behalf.
 *
 * Minting writes NOTHING. A grant is self-verifying, so an unused one costs nothing and needs no
 * cleanup; the only state involved is the watermark that `consumeSigninGrant` moves.
 */
export async function issueSigninLink(
  id: string,
  opts: { actor?: string; ttlMs?: number } = {},
): Promise<{ grant: string; claims: SigninGrantClaims }> {
  if (id === systemUserId()) {
    // The agent is not a person and has no browser. Its credential is a bearer token in a config
    // file; a sign-in link for it would only ever be a way to borrow its seat.
    throw new Error(`"${systemUserId()}" is the agent principal - it signs in with a bearer token, not a link`)
  }
  const rows = await withRead<{ id: string; status: string; kind: string | null }>(`SELECT id, status, kind FROM users WHERE id = ?`, [id])
  const row = rows[0]
  if (!row) throw new Error(`no user "${id}"`)
  if (kindOf(row.kind) === 'agent') throw new Error(`"${id}" is an agent - it signs in with a bearer token, not a link`)
  if (row.status === 'revoked') throw new Error(`"${id}" has been revoked - restore their access first`)
  if (opts.actor) await assertKnownActor(opts.actor)
  const minted = mintSigninGrant(id, { ttlMs: opts.ttlMs })
  console.info(
    `auth: sign-in link issued for "${id}"${opts.actor ? ` by "${opts.actor}"` : ''}, expires ${new Date(minted.claims.exp).toISOString()}`,
  )
  return minted
}

/** Why a sign-in link did not work. Distinguished so the login screen can say something true. */
export type ConsumeFailure = 'invalid' | 'expired' | 'used' | 'revoked'
export type ConsumeResult = { ok: true; principal: Principal } | { ok: false; reason: ConsumeFailure }

/**
 * Verify AND consume a sign-in grant, atomically. Returns the principal it signed in, or why not.
 *
 * ## How single-use works without a table of links
 *
 * Each user carries one `link_watermark`. A grant is consumable only if its own `iat` is strictly
 * newer than that watermark; consuming sets the watermark to that `iat`. So a grant works exactly
 * once, and - a deliberate consequence worth knowing - using a link also kills every OLDER
 * outstanding link for that user. That is the right default: it means the stale links sitting in
 * old messages and transcripts go dead the moment someone signs in.
 *
 * The check and the write are ONE conditional UPDATE, so two simultaneous clicks cannot both win:
 * `rowsChanged` is 1 for exactly the one that moved the watermark.
 *
 * ## Why the column is a BIGINT
 *
 * The watermark is epoch milliseconds in a BIGINT, not a TIMESTAMP. The record layer normalizes
 * every timestamp through `toNaiveUtc` (warehouse/model.ts), which truncates to whole seconds - so
 * an ordinary profile edit would rewrite a watermark of 10:00:00.500 as 10:00:00 and re-arm the
 * link that had just been consumed, for the remainder of its TTL. Do not "tidy" this into a
 * TIMESTAMP.
 *
 * Token rotation deliberately does NOT touch the watermark: the two are independent credentials,
 * and coupling them would kill a link minted in the same moment as a fresh token.
 */
export async function consumeSigninGrant(grant: string, now: number = Date.now()): Promise<ConsumeResult> {
  const verified = verifySigninGrant(grant, now)
  if (!verified.ok) return { ok: false, reason: verified.reason }
  const { sub, iat } = verified.claims

  const changed = await withWrite(async (conn) => {
    const res = await conn.run(
      `UPDATE users SET link_watermark = ?,
         status = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
         updated_at = now()
       WHERE id = ? AND status <> 'revoked' AND coalesce(kind, 'human') <> 'agent' AND id <> ?
         AND (link_watermark IS NULL OR link_watermark < ?)`,
      [iat, sub, systemUserId(), iat],
    )
    return res.rowsChanged
  })

  if (changed === 1) {
    const principal = await resolvePrincipalById(sub)
    if (principal?.kind !== 'human') return { ok: false, reason: 'revoked' }
    // Resolvable in every normal case - the UPDATE just proved the row exists and is not revoked.
    // A null here means the row changed underneath us between the two statements; refuse rather
    // than invent a principal.
    if (!principal) return { ok: false, reason: 'revoked' }
    console.info(`auth: sign-in link consumed for "${sub}"`)
    return { ok: true, principal }
  }

  // The UPDATE matched nothing. Find out which of the two reasons it was, so the screen can differ.
  const rows = await withRead<{ status: string; kind: string | null }>(`SELECT status, kind FROM users WHERE id = ?`, [sub])
  const row = rows[0]
  // An agent never gets a session, even from a grant minted while the account was a person's.
  if (!row || row.status === 'revoked' || kindOf(row.kind) === 'agent' || sub === systemUserId()) return { ok: false, reason: 'revoked' }
  return { ok: false, reason: 'used' }
}

/** Revoke a user's token immediately (keeps the row; the session re-check rejects them next request). */
export async function revokePrincipalToken(id: string, actor?: string): Promise<void> {
  if (actor) await assertKnownActor(actor)
  await withWrite(async (conn) => {
    await conn.run(
      // The watermark bump is not incidental: without it, a link minted BEFORE the revoke would
      // still be consumable if the user is later re-enabled, quietly outliving the revocation.
      `UPDATE users SET token_revoked_at = now(), status = 'revoked', link_watermark = ?,
         updated_at = now(), updated_by = ? WHERE id = ?`,
      [Date.now(), actor ?? null, id],
    )
  })
}

/**
 * Count active human admins. An agent cannot replace a person's recovery access.
 * "Active" excludes revoked users, because a revoked admin cannot sign in and
 * so cannot be the one who restores the others (docs/core/AUTH.md § 3.2, invariant 5).
 */
export async function activeAdminCount(): Promise<number> {
  const rows = await withRead<{ n: number }>(
    `SELECT count(*) AS n FROM users WHERE role = 'admin' AND status <> 'revoked' AND coalesce(kind, 'human') <> 'agent' AND id <> ?`,
    [systemUserId()],
  )
  return Number(rows[0]?.n ?? 0)
}

/**
 * Change a user's tier, with the three refusals that are about the SHAPE of the admin set rather
 * than about one call - so they hold wherever the change comes from (Settings, `bun run cli`, an
 * admin's own agent session):
 *
 *  1. **Host config owns the machine role.** Admin is the default; changing config to member
 *     reduces its privileges on the next request. UI writes cannot override that choice.
 *  2. **Nobody changes their own role.** Demoting yourself is a lockout by accident; promoting
 *     yourself is precisely the thing the tier exists to prevent.
 *  3. **The last active human admin cannot be demoted.** A Box with no admin can only be recovered from
 *     the host (`box auth token <id> --admin`), which is not a state to reach by a UI click.
 *
 * `revokePrincipalToken` and `deleteUser` carry the same last-admin rule at their own call sites -
 * the three doors into "this Box has no admins" are demote, revoke and delete.
 */
export async function setPrincipalRole(id: string, role: UserRole, actor?: string): Promise<void> {
  if (id === systemUserId() && role !== agentIdentity().role) {
    throw new Error('the system principal role is controlled by box.json')
  }
  if (actor && actor === id) throw new Error('you cannot change your own role - ask another admin')
  if (actor) await assertKnownActor(actor)
  const target = await resolvePrincipalById(id)
  if (!target) throw new Error(`no user "${id}"`)
  // Every agent's role is config's: box.json for the system principal, its file for the others.
  if (target.kind === 'agent' && id !== systemUserId()) {
    if (role !== target.role) throw new Error(`the role of agent "${id}" is controlled by data/config/agents/${id}.md`)
    return
  }
  if (target.kind === 'human' && target.role === 'admin' && role !== 'admin' && (await activeAdminCount()) <= 1) {
    throw new Error(`"${id}" is the last admin - promote someone else first`)
  }
  await withWrite(async (conn) => {
    await conn.run(`UPDATE users SET role = ?, updated_at = now(), updated_by = ? WHERE id = ?`, [
      role,
      actor ?? null,
      id,
    ])
  })
}

/**
 * Refuse an operation that would leave the Box with no admin. Called by the revoke and delete
 * paths, which reach "no admins" by a different route than a demotion does.
 */
export async function assertNotLastAdmin(id: string, what: string): Promise<void> {
  const target = await resolvePrincipalById(id)
  if (target?.role !== 'admin' || target.kind === 'agent') return
  if ((await activeAdminCount()) <= 1) throw new Error(`"${id}" is the last admin - ${what} would lock the Box out`)
}
