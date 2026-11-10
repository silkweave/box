// The principal layer: authenticate a user by their access token, resolve a principal by id for the
// per-request session re-check, and mint/revoke tokens. Sits on the shared `users` table + the
// access-token crypto in token.ts. This is the auth layer's data path, and since 2026-09-10 it is
// the WHOLE of it: a principal says who is calling, and nothing anywhere says who may do what. See
// docs/AUTH.md.

import { agentIdentity } from '../box-config.js'
import { timingSafeEqual } from 'node:crypto'
import { db } from './db.js'
import { now as dbNow } from '../warehouse/kysely.js'
import { withWrite } from '../warehouse/db.js'
import { assertKnownActor, kindOf, systemUserId } from '../users/state.js'
import type { UserKind, UserRole } from '../users/types.js'
import { activeAgentConfig, agentRowProblem } from '../agents.js'
import { decryptToken, encryptToken, generateAccessToken } from './token.js'
import { mintSigninGrant, verifySigninGrant, type SigninGrantClaims } from './link.js'
import { SESSION_COOKIE, parseCookies, verifySession } from './session.js'
import { asBootstrap } from '../request-context.js'
import { passPolicyGate } from './policy-gate.js'
import { admitSessionCredential, isSessionCredential, verifySessionCredential, type SessionGrant } from './session-credential.js'
import { policyCommand, type PolicyTx } from '../warehouse/pg/boot.js'
import { policyRevision } from './policy-revision.js'
import { isBuiltinRole } from './roles.js'

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
  /**
   * Present when the request carried a session credential (session-credential.ts): the session it
   * serves and the toolset that narrows it. Such a principal reaches only Box MCP tools, and only
   * those of its toolset, on every transport.
   */
  session?: SessionGrant
  /**
   * The committed policy generation published in this process before this principal's row was
   * read (resolution stamps it). Access computed for it is tagged no newer (access.ts), so the
   * executor's admission re-resolves the principal after any later policy commit.
   */
  resolvedAt?: number
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

/**
 * A stored role reference. NULL (an upgraded row core:001 left without one) is `member`, as it
 * always was; any other value is kept as written, and an id that names no role grants nothing
 * (auth/access.ts), rather than being narrowed to a role that does.
 */
const roleOf = (v: string | null | undefined): UserRole => (v ? v : 'member')

interface PrincipalRow { id: string; nickname: string; first_name: string; role: string; status: string; kind: string | null; token_revoked_at?: string | null }

/**
 * The principal a row stands for, or null when it may not act. A human row is judged by its
 * status; an agent row by the eligibility predicate (row AND file, read now), and its display name
 * and role come from config: a missing or invalid file never falls back to the stored role.
 */
function principalOf(r: PrincipalRow, resolvedAt: number): Principal | null {
  // Fail closed: only an active or invited row may act (`revoked`, and `pending` while a new row
  // waits for its role, users/state.ts, may not; so may no status this code does not know).
  if (r.status !== 'active' && r.status !== 'invited') return null
  if (kindOf(r.kind) === 'agent') {
    const config = activeAgentConfig(r)
    if (!config) return null
    return { id: r.id, display: config.name, role: config.role, kind: 'agent', resolvedAt }
  }
  // A row core:007 has not marked yet is still the system principal (bootstrap marks it).
  if (r.id === systemUserId()) {
    const agent = agentIdentity()
    return { id: r.id, display: agent.name, role: agent.role, kind: 'agent', resolvedAt }
  }
  return { id: r.id, display: r.nickname || r.first_name || r.id, role: roleOf(r.role), kind: 'human', resolvedAt }
}

/**
 * Resolve a row, and persist a retirement the predicate observed. An active agent row whose file is
 * gone or invalid is retired the moment any check sees it, not only at the next boot: otherwise
 * deleting a file and putting it back between two boots would revive the old token. Re-adding the
 * file then restores at the next boot, which drops that token (auth/bootstrap.ts).
 */
async function judge(r: PrincipalRow, resolvedAt: number): Promise<Principal | null> {
  const principal = principalOf(r, resolvedAt)
  if (!principal && kindOf(r.kind) === 'agent' && (r.status === 'active' || r.status === 'invited') && !r.token_revoked_at) await retireObserved(r.id)
  return principal
}

async function retireObserved(id: string): Promise<void> {
  if (id === systemUserId()) return
  // A principal stops being able to act: a policy change (one generation, PERMISSIONS 11.10).
  await policyCommand(`agent retired ${id}`, async (tx) => {
    await tx.run(
      `update core.users set token_revoked_at = now(), status = 'revoked', link_watermark = $1, updated_at = now()
        where id = $2 and kind = 'agent' and status <> 'revoked'`,
      [Date.now(), id],
    )
  })
  console.info(`agents: retired "${id}" (its file in data/config/agents/ is missing or invalid)`)
}

/** The same columns of the joined `u` alias (a left join makes them nullable). */
const USER_PRINCIPAL_COLUMNS = ['u.id', 'u.nickname', 'u.first_name', 'u.role', 'u.status', 'u.kind', 'u.token_revoked_at'] as const

const PRINCIPAL_COLUMNS = ['id', 'nickname', 'first_name', 'role', 'status', 'kind', 'token_revoked_at'] as const

/**
 * Resolve a presented access token to an ACTIVE principal. Decrypts each non-revoked user's token
 * and constant-time compares. Stamps token_last_used_at + flips an invited user to active on first use. Returns null on no match / revoked / disabled.
 */
export function authenticatePrincipal(presented: string): Promise<Principal | null> {
  // Identity is resolved before anything is authorized, so it runs in the bootstrap scope (the
  // auth tables only), never in the caller's request or system frame.
  return asBootstrap(() => authenticate(presented))
}

async function authenticate(presented: string): Promise<Principal | null> {
  if (!presented) return null
  if (isSessionCredential(presented)) {
    const grant = verifySessionCredential(presented)
    if (!grant) return null
    const principal = await resolvePrincipalById(grant.sub)
    if (!principal) return null
    // The session's own admission (a Work session: Work and its data still on), on every request.
    // A file-backed policy change being applied (policy-gate.ts): wait for it, or refuse.
    if (!(await passPolicyGate())) return null
    if (!(await admitSessionCredential(grant.sid))) return null
    const { sub: _sub, ...session } = grant
    return { ...principal, session }
  }
  const resolvedAt = policyRevision()
  const rows = await db
    .selectFrom('users')
    .select([...PRINCIPAL_COLUMNS, 'token_ciphertext'])
    .where('token_ciphertext', 'is not', null)
    .where('token_revoked_at', 'is', null)
    .where('status', 'in', ['active', 'invited'])
    .execute()
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
      const principal = await judge(r, resolvedAt)
      if (!principal) return null
      await db
        .updateTable('users')
        .set((eb) => ({
          token_last_used_at: dbNow(),
          status: eb.case().when('status', '=', 'invited').then('active' as const).else(eb.ref('status')).end()
        }))
        .where('id', '=', r.id)
        .execute()
      return principal
    }
  }
  return null
}

/**
 * Resolve a principal by id for the per-request session re-check (immediate revocation): returns null
 * if the user is gone or their status is revoked, so a live session dies on its next request.
 */
export function resolvePrincipalById(id: string): Promise<Principal | null> {
  return asBootstrap(async () => {
    if (!id) return null
    // Captured before the read: the row is at least as new as this generation (access.ts).
    const resolvedAt = policyRevision()
    const row = await db.selectFrom('users').select(PRINCIPAL_COLUMNS).where('id', '=', id).executeTakeFirst()
    return row ? judge(row, resolvedAt) : null
  })
}

/**
 * Resolve a principal by id together with the committed policy revision its row was read at: one
 * statement, so one snapshot holds both (a missing row included). For judgements that must know the
 * generation an identity belongs to (coverage, auth/covers.ts; BOX-Review e9844b7): `resolvedAt`
 * is only a lower bound, since a commit can land between the admission probe and the row's read.
 * An agent's role still comes from its config file, read now (file policy waits for permissions
 * step 6's journal).
 */
export function resolvePrincipalWithRevision(id: string): Promise<{ principal: Principal | null; revision: number }> {
  return asBootstrap(async () => {
    const row = await db
      .selectFrom('core.policy_state as p')
      .leftJoin('users as u', (join) => join.on('u.id', '=', id))
      .select(['p.revision as policy_revision', ...USER_PRINCIPAL_COLUMNS])
      .where('p.id', '=', 1)
      .executeTakeFirst()
    if (!row) throw new Error('core.policy_state has no row: the access policy is unknown')
    const revision = Number(row.policy_revision)
    if (!id || !row.id) return { principal: null, revision }
    return { principal: await judge(row as PrincipalRow, revision), revision }
  })
}

/** Every agent that may act right now (the eligibility predicate), the system principal first. */
export async function activeAgentPrincipals(): Promise<Principal[]> {
  const resolvedAt = policyRevision()
  const system = systemUserId()
  const rows = await db
    .selectFrom('users')
    .select(PRINCIPAL_COLUMNS)
    .where((eb) => eb.or([eb('kind', '=', 'agent'), eb('id', '=', system)]))
    .orderBy('id')
    .execute()
  return rows
    .map((r) => principalOf(r, resolvedAt))
    .filter((p): p is Principal => p !== null && p.kind === 'agent')
    .sort((a, b) => Number(b.id === system) - Number(a.id === system))
}

/**
 * Every principal that may act right now, people and agents (the same eligibility predicate as
 * `activeAgentPrincipals`), with the committed policy revision the rows were read at: one statement,
 * so one snapshot holds both, an empty set included (like `resolvePrincipalWithRevision`). For
 * enumerating the readers of a destination everyone can open, such as a named chat room
 * (PERMISSIONS 8.3), judged at that revision (auth/recipients.ts).
 */
export function activePrincipalsWithRevision(): Promise<{ principals: Principal[]; revision: number }> {
  return asBootstrap(async () => {
    const rows = await db
      .selectFrom('core.policy_state as p')
      .leftJoin('users as u', (join) => join.onTrue())
      .select(['p.revision as policy_revision', ...USER_PRINCIPAL_COLUMNS])
      .where('p.id', '=', 1)
      .orderBy('u.id')
      .execute()
    if (!rows[0]) throw new Error('core.policy_state has no row: the access policy is unknown')
    const revision = Number(rows[0].policy_revision)
    const principals = rows.filter((r) => r.id).map((r) => principalOf(r as PrincipalRow, revision)).filter((p): p is Principal => p !== null)
    return { principals, revision }
  })
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

/** Test seam: runs after issuePrincipalToken's first read, before anything is written. */
let issueHook: (() => Promise<void>) | null = null
export function setIssueTokenHookForTests(hook: (() => Promise<void>) | null): void {
  issueHook = hook
}

/**
 * Mint (or rotate) an access token for ANY user (internal or collaborator). Returns the PLAINTEXT
 * token once (stored encrypted at rest). Clears any prior revocation + reactivates a revoked user.
 *
 * The ciphertext is written first; it authenticates only once the row is active with no token
 * revocation, which a single policy command then decides (policy-service
 * `restorePrincipalCredential`): the row is re-judged under the policy lock. A revocation or an
 * agent's retirement committed after the first read is refused (the new ciphertext stays unusable);
 * a revoked person's role, changed meanwhile, is judged by the coverage rule there.
 */
export async function issuePrincipalToken(id: string, actor?: string): Promise<string> {
  // A plain existence check, NOT resolvePrincipalById - that one rejects status='revoked', which
  // would make reactivating a disabled user impossible (the whole point of re-issuing).
  const row = await db.selectFrom('users').select(['id', 'kind', 'status', 'token_revoked_at']).where('id', '=', id).executeTakeFirst()
  if (!row) throw new Error(`no user "${id}"`)
  const judge = (r: { id: string; kind: string | null; status: string | null; token_revoked_at?: string | null }) => {
    // A pending row is not a provisioned account (users/state.ts): no credential until it has its role.
    if (r.status === 'pending') throw new Error(`"${id}" is not provisioned yet; save them with a role first`)
    // An agent is restored through its file (boot reconciliation), never by issuing it a token: this
    // rotates an ACTIVE agent's token on the host and refuses a retired one.
    if (kindOf(r.kind) === 'agent') {
      const problem = agentRowProblem({ ...r, kind: 'agent', token_revoked_at: r.token_revoked_at ?? null })
      if (problem) throw new Error(`${problem}; an agent is restored by restoring its file and restarting, not by issuing a token`)
    }
  }
  judge(row)
  if (actor) await assertKnownActor(actor)
  await issueHook?.()
  const token = generateAccessToken()
  await db
    .updateTable('users')
    .set({ token_ciphertext: encryptToken(token), token_issued_at: dbNow(), updated_at: dbNow(), updated_by: actor ?? null })
    .where('id', '=', id)
    .execute()
  // A returning person is judged like a new one against the seated agents: seats they do not cover
  // are disabled and reported, not refused.
  const { restorePrincipalCredential } = await import('./policy-service.js')
  await restorePrincipalCredential(id, actor, (now) => {
    // A revocation or retirement since the first read stands: this restore was not asked about it.
    if (now.status !== row.status) throw new Error(`"${id}" changed while the token was issued (${row.status}, now ${now.status}); issue it again`)
    judge(now)
  })
  return token
}

/**
 * The access token a server-owned session (chat agent, trigger job, a feature's agent job) carries for `id`:
 * the principal's existing token, or a first one when none exists. One read-check-write with the
 * row locked (FOR UPDATE), so two sessions starting at once share one token instead of rotating each
 * other's. Refuses a missing or revoked principal: unlike `issuePrincipalToken`, which is the
 * operator's explicit restore, this never reactivates anyone and never rotates a working token.
 */
export async function sessionPrincipalToken(id: string): Promise<string> {
  let retire = false
  return withWrite(async () => {
    const r = await db
      .selectFrom('users')
      .select(['id', 'kind', 'status', 'token_ciphertext', 'token_revoked_at'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst()
    if (!r) throw new Error(`no user "${id}"`)
    // The eligibility predicate: a retired agent (file gone or invalid) gets no session token.
    const problem = agentRowProblem(r)
    if (problem) {
      if (kindOf(r.kind) === 'agent' && r.status !== 'revoked' && !r.token_revoked_at && id !== systemUserId()) {
        // Committed before the refusal: the retirement stands although the call fails.
        retire = true
      }
      throw new Error(`${problem}; a session cannot act as it`)
    }
    if (r.status === 'revoked' || r.token_revoked_at) throw new Error(`"${id}" has been revoked; a session cannot act as them until an admin restores their access`)
    if (r.status !== 'active' && r.status !== 'invited') throw new Error(`"${id}" is not provisioned yet; a session cannot act as them`)
    if (r.token_ciphertext) {
      try {
        return decryptToken(r.token_ciphertext)
      } catch {
        // Undecryptable (the token secret changed): no holder can use it, so a fresh one costs nothing.
      }
    }
    const token = generateAccessToken()
    await db.updateTable('users').set({ token_ciphertext: encryptToken(token), token_issued_at: dbNow(), updated_at: dbNow() }).where('id', '=', id).execute()
    return token
  }, { reach: 'core' }).catch(async (e) => {
    if (retire) await retireObserved(id)
    throw e
  })
}

/** Return ANY user's current plaintext access token (re-copying an invite without rotating), or
 *  null when none was issued, it was revoked, or it does not decrypt. Callers gate access - the
 *  users controller exposes this admin-only. */
export async function revealPrincipalToken(id: string): Promise<string | null> {
  const r = await db.selectFrom('users').select(['token_ciphertext', 'token_revoked_at']).where('id', '=', id).executeTakeFirst()
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
  const row = await db.selectFrom('users').select(['id', 'status', 'kind']).where('id', '=', id).executeTakeFirst()
  if (!row) throw new Error(`no user "${id}"`)
  if (kindOf(row.kind) === 'agent') throw new Error(`"${id}" is an agent - it signs in with a bearer token, not a link`)
  if (row.status === 'revoked') throw new Error(`"${id}" has been revoked - restore their access first`)
  if (row.status !== 'active' && row.status !== 'invited') throw new Error(`"${id}" is not provisioned yet (status ${row.status}); save them with a role first`)
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
 * the affected row count is 1 for exactly the one that moved the watermark.
 *
 * ## Why the column is a BIGINT
 *
 * The watermark is epoch milliseconds in a BIGINT, not a TIMESTAMP. The record layer normalizes
 * Epoch milliseconds compare exactly with the grant's `iat` (also epoch milliseconds) and no
 * timestamp conversion anywhere can move it backwards and re-arm a consumed link. Do not "tidy"
 * this into a timestamp.
 *
 * Token rotation deliberately does NOT touch the watermark: the two are independent credentials,
 * and coupling them would kill a link minted in the same moment as a fresh token.
 */
export async function consumeSigninGrant(grant: string, now: number = Date.now()): Promise<ConsumeResult> {
  const verified = verifySigninGrant(grant, now)
  if (!verified.ok) return { ok: false, reason: verified.reason }
  const { sub, iat } = verified.claims

  const { numUpdatedRows: changed } = await asBootstrap(() =>
    db
      .updateTable('users')
      .set((eb) => ({
        link_watermark: iat,
        status: eb.case().when('status', '=', 'invited').then('active' as const).else(eb.ref('status')).end(),
        updated_at: dbNow()
      }))
      .where('id', '=', sub)
      .where('status', 'in', ['active', 'invited'])
      .where((eb) => eb(eb.fn.coalesce('kind', eb.val('human')), '<>', 'agent'))
      .where('id', '<>', systemUserId())
      .where((eb) => eb.or([eb('link_watermark', 'is', null), eb('link_watermark', '<', iat)]))
      .executeTakeFirst()
  )

  if (changed === 1n) {
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
  const row = await asBootstrap(() => db.selectFrom('users').select(['status', 'kind']).where('id', '=', sub).executeTakeFirst())
  // An agent never gets a session, even from a grant minted while the account was a person's.
  if (!row || (row.status !== 'active' && row.status !== 'invited') || kindOf(row.kind) === 'agent' || sub === systemUserId()) return { ok: false, reason: 'revoked' }
  return { ok: false, reason: 'used' }
}

/**
 * Revoke a user's token immediately (keeps the row; the session re-check rejects them next request).
 * A policy command: the last-admin rule is decided under the policy lock (a revoke, a delete and a
 * demotion serialize), and the generation moves, so a request frame resolved before the revoke is
 * re-resolved, and refused, at its next transaction.
 */
export async function revokePrincipalToken(id: string, actor?: string): Promise<void> {
  if (actor) await assertKnownActor(actor)
  await policyCommand(`revoke ${id}`, async (tx) => {
    await lockTargetNotLastAdmin(tx, id, 'disabling them')
    await tx.run(
      // The watermark bump is not incidental: without it, a link minted BEFORE the revoke would
      // still be consumable if the user is later re-enabled, quietly outliving the revocation.
      `update core.users set token_revoked_at = now(), status = 'revoked', link_watermark = $1,
         updated_at = now(), updated_by = $2 where id = $3`,
      [Date.now(), actor ?? null, id],
    )
  })
}

/**
 * Inside a policy command: lock `id`'s row and refuse when removing its ability to act would leave
 * no active human admin. Null when there is no such row.
 */
export async function lockTargetNotLastAdmin(tx: PolicyTx, id: string, what: string): Promise<{ kind: string | null; role: string | null; status: string } | null> {
  const target = (await tx.query<{ kind: string | null; role: string | null; status: string }>(`select kind, role, status from core.users where id = $1 for update`, [id]))[0]
  if (!target) return null
  if (id !== systemUserId() && kindOf(target.kind) === 'human' && roleOf(target.role) === 'admin' && (target.status === 'active' || target.status === 'invited')) {
    const admins = await tx.query<{ id: string }>(`select id ${ACTIVE_ADMINS} for update`, [systemUserId()])
    if (admins.length <= 1) throw new Error(`"${id}" is the last admin - ${what} would lock the Box out`)
  }
  return target
}

/**
 * Count active human admins. An agent cannot replace a person's recovery access.
 * "Active" excludes revoked users, because a revoked admin cannot sign in and
 * so cannot be the one who restores the others (docs/core/AUTH.md § 3.2, invariant 5).
 */
const ACTIVE_ADMINS = `from core.users where role = 'admin' and status in ('active', 'invited') and coalesce(kind, 'human') <> 'agent' and id <> $1`

export async function activeAdminCount(): Promise<number> {
  // The same predicate as ACTIVE_ADMINS, which the policy transaction (pg) locks with FOR UPDATE.
  const { n } = await db
    .selectFrom('users')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('role', '=', 'admin')
    .where('status', 'in', ['active', 'invited'])
    .where((eb) => eb(eb.fn.coalesce('kind', eb.val('human')), '<>', 'agent'))
    .where('id', '<>', systemUserId())
    .executeTakeFirstOrThrow()
  return Number(n)
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
export async function setPrincipalRole(id: string, role: UserRole, actor?: string, opts: import('./policy-service.js').PolicyApplyOptions = {}): Promise<void> {
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
  await writePrincipalRole(id, role, actor, opts)
}

/**
 * Set a user's role through the policy service (the only writer of roles, PERMISSIONS 11.3). The
 * policy lock serializes every policy writer, so the target's kind and current role, the last-admin
 * rule and the role's existence are all read inside the command, after the lock: two demotions of
 * two admins, or an assignment against a role delete, see each other. Callers apply their rules
 * about who may ask first (setPrincipalRole; agent config through upsertUser).
 *
 * `activate`: a new row created `pending` (users/state.ts) gets its role and its final status in
 * this one transaction, so it is never authenticatable before it holds its role.
 */
export async function writePrincipalRole(
  id: string,
  role: UserRole,
  actor: string | undefined,
  opts: { create?: boolean } & import('./policy-service.js').PolicyApplyOptions = {},
): Promise<import('./policy-service.js').PolicyApplyResult> {
  const { applyPolicyChange } = await import('./policy-service.js')
  const { create, ...apply } = opts
  // A new user is not refused for an open room's agent: those seats are disabled and reported.
  return applyPolicyChange({ reason: `role assignment ${id}`, actor, users: { [id]: role }, create }, create ? { ...apply, onViolation: 'disable' } : apply)
}

/**
 * The role assignment itself, inside the policy service's transaction (policy-service.ts): the
 * target's kind and current role, the last-admin rule and the role's existence are read after the
 * policy lock, so two demotions of two admins, or an assignment against a role delete, see each other.
 */
export async function assignRoleInTx(tx: PolicyTx, id: string, role: UserRole, actor: string | undefined, opts: { create?: boolean } = {}): Promise<void> {
  {
    const target = (await tx.query<{ kind: string | null; role: string | null; status: string }>(`select kind, role, status from core.users where id = $1 for update`, [id]))[0]
    if (!target) throw new Error(`no user "${id}"`)
    if (opts.create && target.status !== 'pending') throw new Error(`"${id}" is not waiting for its first role (it was provisioned meanwhile)`)
    const demotesAdmin = id !== systemUserId() && kindOf(target.kind) === 'human' && roleOf(target.role) === 'admin' && role !== 'admin' && (target.status === 'active' || target.status === 'invited')
    if (demotesAdmin) {
      const admins = await tx.query<{ id: string }>(`select id ${ACTIVE_ADMINS} for update`, [systemUserId()])
      if (admins.length <= 1) throw new Error(`"${id}" is the last admin - promote someone else first`)
    }
    if (!isBuiltinRole(role)) {
      const found = await tx.query(`select id from core.roles where id = $1 for share`, [role])
      if (!found.length) throw new Error(`no role "${role}"`)
    }
    // An explicit role is what a pending row waits for: assigning one activates it, in this commit.
    if (target.status === 'pending') {
      await tx.run(`update core.users set role = $1, status = 'active', updated_at = now(), updated_by = $2 where id = $3`, [role, actor ?? null, id])
    } else {
      await tx.run(`update core.users set role = $1, updated_at = now(), updated_by = $2 where id = $3`, [role, actor ?? null, id])
    }
  }
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
