// Read/write the `users` table in the warehouse. Row↔domain plumbing (column lists, JSON/timestamp
// handling, partial upsert, enum validation) comes from the record layer (warehouse/model.ts) driven
// by the USERS spec in warehouse/models.ts; this module keeps the domain semantics: the lifecycle
// status, the has_token derivation (the public User shape never exposes token columns), and the
// cascade-delete / reorder paths as raw SQL.

import { emitChange } from '../changes.js'
import { withWrite } from '../warehouse/db.js'
import { db } from '../warehouse/core-db.js'
import { sql } from '../warehouse/kysely.js'
import { readRecord, upsertRecord } from '../warehouse/model.js'
import { USERS } from '../warehouse/core-models.js'
import { type User, type UserInput, type UserKind, type UserRole, type UserStatus } from './types.js'
import { systemUserId, agentIdentity } from '../box-config.js'
import { agentConfig, isConfiguredAgent } from '../agents.js'
import { runUserCleanups } from './cleanup.js'
import { agentProfileMapFor } from '../agent-profiles.js'
import { rememberAgentDefault, forgetAgentDefault } from '../agent-defaults.js'
import { normalizeWorkAccess } from '../work-access.js'
import { roleExists } from '../auth/roles.js'

// Re-export the lazy identity lookup for existing user-directory consumers.
export { systemUserId } from '../box-config.js'

/** The full users row as the record layer maps it - includes the token columns the public User
 *  shape must never leak; toUser() derives has_token and drops them. */
interface UserRecord {
  id: string
  first_name: string
  last_name: string
  nickname: string
  image: string | null
  sort: number
  color: string | null
  status: string
  role: string
  tailscale_login: string | null
  email: string | null
  phone: string | null
  channels: Record<string, string> | null
  token_ciphertext: string | null
  token_issued_at: string | null
  token_last_used_at: string | null
  token_revoked_at: string | null
  /** Sign-in link single-use watermark: epoch MILLISECONDS, not a timestamp (see core-models.ts).
   *  Never surfaced to a caller - toUser() drops it, like the token columns. */
  link_watermark: number | null
  agent_profile: string | null
  /** Work capabilities as stored (JSON); NULL on a row core:009 added the column to. */
  work: Record<string, unknown> | null
  /** 'human' | 'agent'; NULL on a row core:007 added the column to without a default reaching it. */
  kind: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

/** A stored kind, narrowed: anything but exactly 'agent' is a human (core:007's column is nullable). */
export const kindOf = (v: string | null | undefined): UserKind => (v === 'agent' ? 'agent' : 'human')

/** The role config gives an agent row (box.json for the system principal, else its file), or null
 *  when its config is missing or invalid: the stored role is then for display only. */
function configuredRole(id: string): UserRole | null {
  try {
    return agentConfig(id)?.role ?? null
  } catch {
    return null
  }
}

function toUser(r: UserRecord): User {
  const kind = kindOf(r.kind)
  return {
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    nickname: r.nickname,
    email: r.email,
    phone: r.phone ?? null,
    image: r.image,
    color: r.color,
    status: (r.status || 'active') as UserStatus,
    role: r.id === systemUserId() ? agentIdentity().role : (kind === 'agent' && configuredRole(r.id)) || r.role || 'member',
    kind,
    tailscale_login: r.tailscale_login,
    channels: r.channels ?? {}, // malformed JSON degrades to no handles (the layer parses to null)
    agent_profile: r.agent_profile ?? null,
    work: normalizeWorkAccess(r.work),
    has_token: r.token_ciphertext != null,
    sort: r.sort,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

/** One slug segment: lowercase, digits, dashes; must start alphanumeric (mirrors planning's SLUG_SEG). */
const SLUG_SEG = /^[a-z0-9][a-z0-9-]*$/

/** Derive a stable id from a nickname (lowercase, non-alphanumerics → '-', trimmed, clamped). */
export function userSlug(nickname: string): string {
  return nickname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

const CORE = { reach: 'core' } as const

/** The identity columns two users may not share, by the unique index that enforces each. */
export const USER_UNIQUE_INDEXES = {
  users_tailscale_login_key: 'tailscale_login',
  users_email_key: 'email',
  users_phone_key: 'phone',
} as const

/** A unique-index violation on an identity column as the message the pre-check gives. */
function uniqueClash(e: unknown, values: Record<string, string | null>): Error | null {
  const err = e as { code?: string; constraint?: string }
  if (err?.code !== '23505' || !err.constraint) return null
  const column = USER_UNIQUE_INDEXES[err.constraint as keyof typeof USER_UNIQUE_INDEXES]
  if (!column) return null
  const label = column === 'tailscale_login' ? 'tailscale login' : column
  return new Error(`${label} "${values[column] ?? ''}" already belongs to another user`)
}

// --- reads ---------------------------------------------------------------------------------------

/** `lower(trim(email))`: the email as an identity (normalizeEmail), for case-insensitive lookups. */
// A function: built when used, not at module load (core's import cycle through kysely.ts).
const lowerEmail = () => sql<string>`lower(trim(${sql.ref('email')}))`

/** Every user, ordered for display. Every row is internal, so there is nothing to filter. */
export async function readUsers(): Promise<User[]> {
  const rows = (await db.selectFrom('users').selectAll().orderBy('sort').orderBy('created_at').execute()) as UserRecord[]
  const users = rows.map(toUser)
  for (const user of users) rememberAgentDefault(user.id, user.agent_profile)
  return users
}

/** One user by id (primitive lookup). */
export async function readUser(id: string): Promise<User | null> {
  const rec = await readRecord<UserRecord>(USERS, { id })
  return rec ? toUser(rec) : null
}

/** Whether the directory contains a person rather than only agents. */
export function hasHumanUser(users: readonly Pick<User, 'id' | 'kind'>[], machineId = systemUserId()): boolean {
  return users.some(user => user.kind !== 'agent' && user.id !== machineId)
}

/**
 * Guard an audit stamp: `actor` must be an existing principal. Called from the record layer on every audited write, because `actor` IS the
 * audit trail: an unvalidated one leaves `created_by` pointing at a person who does not exist, and
 * nothing in the tool surface can rewrite `created_by` afterwards. (2026-08-11 cost us exactly
 * that - 106 CRM rows stamped through the MCP with a user id the directory did not have.)
 */
export async function assertKnownActor(actor: string): Promise<void> {
  if (!(await readUser(actor))) {
    throw new Error(`unknown actor "${actor}" - pass an existing users.id (Settings → Users)`)
  }
}

// --- writes --------------------------------------------------------------------------------------

/**
 * Create or update a user. Partial: provided fields overwrite; the rest keep their
 * stored value (or a default on first insert). `created_at` is preserved on update. The `id` must
 * be a valid slug. `channels` (channel → handle) lives here too - the users table is the source of
 * truth for per-person presence.
 */
/** A phone number as an identity: E.164 (`+4366012345678`), accepting spaces, dots, dashes,
 *  brackets and a `00` prefix; null when blank. Throws on anything else. */
export function normalizePhone(phone: string | null | undefined): string | null {
  const typed = (phone ?? '').replace(/[\s().-]/g, '')
  if (!typed) return null
  const e164 = typed.startsWith('00') ? `+${typed.slice(2)}` : typed
  if (!/^\+[1-9]\d{6,14}$/.test(e164)) throw new Error(`phone "${phone}" is not a number in international form (+4366012345678)`)
  return e164
}

/** The user whose phone is `phone` (any typed form), or null. */
export async function readUserByPhone(phone: string): Promise<User | null> {
  let value: string | null
  try {
    value = normalizePhone(phone)
  } catch {
    return null
  }
  if (!value) return null
  const rows = await db.selectFrom('users').select('id').where('phone', '=', value).limit(1).execute()
  return rows[0] ? readUser(rows[0].id) : null
}

/** An email as an identity: trimmed and lowercased, `null` when blank. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const value = email?.trim().toLowerCase()
  return value ? value : null
}

/** Whether two emails name the same identity (case-insensitive; blank equals null). */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return normalizeEmail(a) === normalizeEmail(b)
}

/** The user whose email is `email` (case-insensitive), or null. */
export async function readUserByEmail(email: string): Promise<User | null> {
  const value = normalizeEmail(email)
  if (!value) return null
  const rows = await db.selectFrom('users').select('id').where(lowerEmail(), '=', value).limit(1).execute()
  return rows[0] ? readUser(rows[0].id) : null
}

let provisioningHold: ((id: string) => Promise<void>) | null = null
let beforeWriteHold: ((id: string) => Promise<void>) | null = null
/** Test seam: run between a new row's insert and its activation (PHASE1 W8 P finding 4 tests). */
export function setProvisioningHoldForTests(fn: ((id: string) => Promise<void>) | null): void {
  provisioningHold = fn
}
/** Test seam: run after upsertUser read the row (or found it absent) and before its first write. */
export function setBeforeWriteHoldForTests(fn: ((id: string) => Promise<void>) | null): void {
  beforeWriteHold = fn
}

/** The fields that decide who a person is elsewhere (a sign-in identity, a messaging number). */
const IDENTITY_FIELDS = ['email', 'phone', 'tailscale_login'] as const

/**
 * `opts.kind` is boot reconciliation's alone (auth/bootstrap.ts): no request reaches it, so a row's
 * kind is never a field a caller can send. Without it a new row is human and an existing one keeps
 * its kind.
 */
export async function upsertUser(input: UserInput, opts: { kind?: UserKind } = {}): Promise<User> {
  if (!SLUG_SEG.test(input.id)) throw new Error(`invalid user id "${input.id}" (use a-z, 0-9, -)`)
  // Read prev as the FULL record (not the User shape) so the {prev} merge keeps the token columns
  // intact - the public User only carries has_token.
  const prev = await readRecord<UserRecord>(USERS, { id: input.id })
  const prevUser = prev ? toUser(prev) : null
  // The locked system id is an agent however its row comes to exist; anyone else starts human.
  const kind: UserKind = opts.kind ?? (input.id === systemUserId() ? 'agent' : (prevUser?.kind ?? 'human'))
  // An agent's file reserves its id: a person created under it would make the next boot refuse.
  if (!prev && kind === 'human' && isConfiguredAgent(input.id)) {
    throw new Error(`"${input.id}" is an agent id (data/config/agents/${input.id}.md); choose another id`)
  }
  // Config owns an agent's role: box.json for the system principal, its file for the others.
  if (kind === 'agent' && input.role !== undefined && opts.kind === undefined && input.id !== systemUserId()) {
    const configured = configuredRole(input.id)
    if (input.role !== configured) throw new Error(`the role of agent "${input.id}" is controlled by data/config/agents/${input.id}.md`)
  }
  // A person's role must name a role. (Assignment races with a role delete are closed by the
  // policy service, which serializes every policy change.)
  if (kind === 'human' && input.role !== undefined && input.role !== prevUser?.role && !(await roleExists(input.role))) {
    throw new Error(`no role "${input.role}"`)
  }
  const channels =
    input.channels !== undefined
      ? Object.fromEntries(Object.entries(input.channels).filter(([, v]) => v.trim()))
      : (prevUser?.channels ?? {})
  // Host config owns the machine role. Both writes into the role column enforce the same rule.
  if (input.id === systemUserId() && input.role !== undefined && input.role !== agentIdentity().role) {
    throw new Error('the system principal role is controlled by box.json')
  }
  const agentProfile =
    input.agent_profile !== undefined ? input.agent_profile?.trim() || null : (prevUser?.agent_profile ?? null)
  if (input.agent_profile !== undefined && agentProfile && !Object.values(agentProfileMapFor(input.id)).includes(agentProfile)) {
    throw new Error(`"${agentProfile}" is not one of ${input.id}'s agent profiles (box.json agentProfiles)`)
  }
  const tailscaleLogin =
    input.tailscale_login !== undefined ? input.tailscale_login?.trim() || null : (prevUser?.tailscale_login ?? null)
  // Two users mapped to one tailscale login would make the exchange ambiguous. The unique index
  // (CORE_BASELINE) is the guarantee; these reads only name the clash for the common case.
  if (tailscaleLogin && tailscaleLogin !== prevUser?.tailscale_login) {
    const clash = await db.selectFrom('users').select('id').where('tailscale_login', '=', tailscaleLogin).where('id', '<>', input.id).limit(1).execute()
    if (clash[0]) throw new Error(`tailscale login "${tailscaleLogin}" already belongs to user "${clash[0].id}"`)
  }
  const email = input.email !== undefined ? input.email?.trim() || null : (prevUser?.email ?? null)
  // The email is an identity (an identity provider may sign people in by it), so two users may not share one, compared
  // case-insensitively. Checked on change only, so a Box that already holds a duplicate still saves
  // unrelated profile edits.
  if (email && !sameEmail(email, prevUser?.email)) {
    const clash = await db.selectFrom('users').select('id').where(lowerEmail(), '=', normalizeEmail(email)!).where('id', '<>', input.id).limit(1).execute()
    if (clash[0]) throw new Error(`email "${email}" already belongs to user "${clash[0].id}"`)
  }
  const phone = input.phone !== undefined ? normalizePhone(input.phone) : (prevUser?.phone ?? null)
  if (phone && phone !== prevUser?.phone) {
    const clash = await db.selectFrom('users').select('id').where('phone', '=', phone).where('id', '<>', input.id).limit(1).execute()
    if (clash[0]) throw new Error(`phone "${phone}" already belongs to user "${clash[0].id}"`)
  }
  // A partial `work` merges over the stored value and is stored complete, so a later reader never
  // depends on the defaults of its day. The controller keeps it admin-only.
  const work = input.work !== undefined
    ? normalizeWorkAccess({ ...prevUser?.work, ...input.work })
    : (prev?.work ?? null)
  // An existing row's role change is its own policy command, run first: if it is refused, nothing
  // of this edit is applied. A role change and an identity change (email, phone, tailscale login)
  // are never one request: the second could fail after the first committed, leaving an identity
  // with authority the request did not get. They are refused together, before either write. An
  // explicit role is also what activates a row left pending by a failed create.
  const { writePrincipalRole } = await import('../auth/principal.js')
  // The stored row, not the User view (an agent's view carries its config role).
  await beforeWriteHold?.(input.id)
  const roleChange = !!prev && input.role !== undefined && (input.role !== prev.role || prev.status === 'pending')
  if (roleChange) {
    // Categorical, and before the role write: a role request carries no identity value at all, so
    // nothing it writes afterwards can put back an identity changed meanwhile (or clash on one).
    const supplied = IDENTITY_FIELDS.filter((f) => input[f] !== undefined)
    if (supplied.length) throw new Error(`change the role and ${supplied.join(', ')} separately: a role change cannot ride with an identity value`)
    await writePrincipalRole(input.id, input.role!, undefined)
  }
  const record: Record<string, unknown> = {
    id: input.id,
    first_name: input.first_name ?? prevUser?.first_name ?? '',
    last_name: input.last_name ?? prevUser?.last_name ?? '',
    nickname: input.nickname ?? prevUser?.nickname ?? input.id,
    email,
    phone,
    image: input.image !== undefined ? input.image : (prevUser?.image ?? null),
    color: input.color !== undefined ? input.color : (prevUser?.color ?? null),
    channels,
    // A new row starts `pending` (not authenticatable, auth/principal.ts) and is activated with
    // its role in one policy transaction below: never a moment as a default member. An existing
    // row's status is not this write's: it is merged from the row locked in the write's own
    // transaction, so an activation or a revoke committed meanwhile is never undone.
    ...(prev ? {} : { status: 'pending' }),
    tailscale_login: tailscaleLogin,
    agent_profile: agentProfile,
    work,
    kind,
    sort: input.sort ?? prevUser?.sort ?? 0,
  }
  // An existing row gets only what the caller supplied: every other column is merged from the row
  // locked in the write's own transaction, never copied from this call's earlier read (a value
  // changed meanwhile, an identity above all, is never put back).
  if (prev) {
    for (const key of Object.keys(record)) {
      if (key === 'id') continue
      const given = key === 'kind' ? opts.kind !== undefined : (input as unknown as Record<string, unknown>)[key] !== undefined
      if (!given) delete record[key]
    }
  }
  const rec = await upsertRecord<UserRecord>(
    USERS,
    record,
    // A user's role is a policy row: written only by the policy service, never here.
    // A create is insert-only: an id taken meanwhile refuses, never updates the row it found.
    prev ? { mustExist: true } : { prev: null, createOnly: true },
  ).catch((e: unknown) => {
    throw uniqueClash(e, { tailscale_login: tailscaleLogin, email, phone }) ?? e
  })
  if (!prev) {
    // A new row: inserted pending, activated with its role in one policy command.
    const role = input.role ?? 'member'
    await provisioningHold?.(rec.id)
    await writePrincipalRole(rec.id, role, undefined, { create: true })
    rec.role = role
    rec.status = 'active'
  }
  rememberAgentDefault(rec.id, rec.agent_profile ?? null)
  return toUser(rec)
}

/**
 * Delete a user, after every feature that references a user id has cleared its own rows, so none is
 * left pointing at a ghost (planning unassigns `initiatives.owner` and `tasks.assignee`).
 *
 * Core no longer names those tables itself - see ./cleanup.ts. A cleanup that throws aborts the
 * delete rather than leaving dangling references behind.
 */
export async function deleteUser(id: string): Promise<void> {
  if (id === systemUserId()) throw new Error('the configured system principal cannot be deleted')
  // An agent row is never deleted, retired included: it stays as the author of its messages and
  // runs, and keeps its id from being reused by someone else. Retire an agent by deleting its file.
  const row = await readRecord<UserRecord>(USERS, { id })
  if (row && kindOf(row.kind) === 'agent') {
    throw new Error(`"${id}" is an agent; agents are retired by deleting data/config/agents/${id}.md, never deleted`)
  }
  await runUserCleanups(id)
  // The cleanups run first, each on its own feature's login (they are not one transaction with
  // this delete: a role login cannot open inside box_core's). A failing cleanup aborts the delete.
  // The delete itself is a policy command: the last-admin rule is decided under the policy lock
  // and the generation moves, so a frame resolved before it is refused at its next transaction.
  const { lockTargetNotLastAdmin } = await import('../auth/principal.js')
  const { policyCommand } = await import('../warehouse/pg/boot.js')
  await policyCommand(`delete user ${id}`, async (tx) => {
    const target = await lockTargetNotLastAdmin(tx, id, 'deleting them')
    if (!target) return
    if (kindOf(target.kind) === 'agent') throw new Error(`"${id}" is an agent; agents are retired by deleting data/config/agents/${id}.md, never deleted`)
    // On the policy command's own transaction (maintenance client), so it stays a `tx` statement.
    await tx.run(`delete from core.users where id = $1`, [id])
  })
  emitChange('table:users')
  forgetAgentDefault(id)
}

/** Assign sequential `sort` to users in the given id order (drag reorder). */
export async function reorderUsers(ids: string[]): Promise<void> {
  await withWrite(async () => {
    // Raw sql: UPDATE ... FROM unnest(...) WITH ORDINALITY has no builder form.
    await sql`update ${sql.table('users')} u set sort = o.n - 1, updated_at = now()
         from unnest(${ids}::text[]) with ordinality as o(id, n) where u.id = o.id`.execute(db)
    emitChange('table:users')
  }, CORE)
}

/** Guard a write that names a user (owner, assignee): the id must be an existing users.id. */
export async function assertKnownUser(owner: string): Promise<void> {
  const users = await readUsers()
  if (!users.some((u) => u.id === owner)) {
    throw new Error(`unknown user "${owner}" - add them under Settings → Users first`)
  }
}
