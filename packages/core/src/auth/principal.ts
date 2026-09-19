// The principal layer: authenticate a user by their access token, resolve a principal by id for the
// per-request session re-check, and mint/revoke tokens. Sits on the shared `users` table + the
// access-token crypto in token.ts. This is the auth layer's data path, and since 2026-09-10 it is
// the WHOLE of it: a principal says who is calling, and nothing anywhere says who may do what. See
// docs/AUTH.md.

import { agentIdentity } from '../box-config.js'
import { timingSafeEqual } from 'node:crypto'
import { withRead, withWrite } from '../warehouse/db.js'
import { assertKnownActor, systemUserId } from '../users/state.js'
import type { UserRole } from '../users/types.js'
import { decryptToken, encryptToken, generateAccessToken } from './token.js'
import { mintSigninGrant, verifySigninGrant, type SigninGrantClaims } from './link.js'

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

const display = (r: { nickname: string; first_name: string; id: string }): string =>
  r.id === systemUserId() ? agentIdentity().name : r.nickname || r.first_name || r.id

/** A stored role string, defensively narrowed - an unknown value is the least privilege, not a throw. */
const roleOf = (v: string | null | undefined): UserRole => (v === 'admin' ? 'admin' : 'member')

/**
 * Resolve a presented access token to an ACTIVE principal. Decrypts each non-revoked user's token
 * and constant-time compares. Stamps token_last_used_at + flips an invited user to active on first use. Returns null on no match / revoked / disabled.
 */
export async function authenticatePrincipal(presented: string): Promise<Principal | null> {
  if (!presented) return null
  const rows = await withRead<{ id: string; nickname: string; first_name: string; role: string; token_ciphertext: string | null }>(
    `SELECT id, nickname, first_name, role, token_ciphertext
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
      await withWrite(async (conn) => {
        await conn.run(
          `UPDATE users SET token_last_used_at = now(),
             status = CASE WHEN status = 'invited' THEN 'active' ELSE status END WHERE id = ?`,
          [r.id],
        )
      })
      return { id: r.id, display: display(r), role: r.id === systemUserId() ? agentIdentity().role : roleOf(r.role) }
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
  const rows = await withRead<{ id: string; nickname: string; first_name: string; status: string; role: string }>(
    `SELECT id, nickname, first_name, status, role FROM users WHERE id = ?`,
    [id],
  )
  const r = rows[0]
  if (!r || r.status === 'revoked') return null
  return { id: r.id, display: display(r), role: r.id === systemUserId() ? agentIdentity().role : roleOf(r.role) }
}

/**
 * Mint (or rotate) an access token for ANY user (internal or collaborator). Returns the PLAINTEXT
 * token once (stored encrypted at rest). Clears any prior revocation + reactivates a revoked user.
 */
export async function issuePrincipalToken(id: string, actor?: string): Promise<string> {
  // A plain existence check, NOT resolvePrincipalById - that one rejects status='revoked', which
  // would make reactivating a disabled user impossible (the whole point of re-issuing).
  const rows = await withRead<{ id: string }>(`SELECT id FROM users WHERE id = ?`, [id])
  if (!rows[0]) throw new Error(`no user "${id}"`)
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
  const rows = await withRead<{ id: string; status: string }>(`SELECT id, status FROM users WHERE id = ?`, [id])
  const row = rows[0]
  if (!row) throw new Error(`no user "${id}"`)
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
       WHERE id = ? AND status <> 'revoked'
         AND (link_watermark IS NULL OR link_watermark < ?)`,
      [iat, sub, iat],
    )
    return res.rowsChanged
  })

  if (changed === 1) {
    const principal = await resolvePrincipalById(sub)
    // Resolvable in every normal case - the UPDATE just proved the row exists and is not revoked.
    // A null here means the row changed underneath us between the two statements; refuse rather
    // than invent a principal.
    if (!principal) return { ok: false, reason: 'revoked' }
    console.info(`auth: sign-in link consumed for "${sub}"`)
    return { ok: true, principal }
  }

  // The UPDATE matched nothing. Find out which of the two reasons it was, so the screen can differ.
  const rows = await withRead<{ status: string }>(`SELECT status FROM users WHERE id = ?`, [sub])
  const row = rows[0]
  if (!row || row.status === 'revoked') return { ok: false, reason: 'revoked' }
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
 * Count active human admins. The machine cannot replace a person's recovery access.
 * "Active" excludes revoked users, because a revoked admin cannot sign in and
 * so cannot be the one who restores the others (docs/core/AUTH.md § 3.2, invariant 5).
 */
export async function activeAdminCount(): Promise<number> {
  const rows = await withRead<{ n: number }>(
    `SELECT count(*) AS n FROM users WHERE role = 'admin' AND status <> 'revoked' AND id <> ?`,
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
  if (id !== systemUserId() && target.role === 'admin' && role !== 'admin' && (await activeAdminCount()) <= 1) {
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
  if (target?.role !== 'admin') return
  if ((await activeAdminCount()) <= 1) throw new Error(`"${id}" is the last admin - ${what} would lock the Box out`)
}
