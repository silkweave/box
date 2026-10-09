// Read/write the `users` table in the warehouse. Row↔domain plumbing (column lists, JSON/timestamp
// handling, partial upsert, enum validation) comes from the record layer (warehouse/model.ts) driven
// by the USERS spec in warehouse/models.ts; this module keeps the domain semantics: the lifecycle
// status, the has_token derivation (the public User shape never exposes token columns), and the
// cascade-delete / reorder paths as raw SQL.

import { ensureSchema, withRead, withWrite } from '../warehouse/db.js'
import { readRecord, readRecords, upsertRecord } from '../warehouse/model.js'
import { USERS } from '../warehouse/core-models.js'
import { type User, type UserInput, type UserRole, type UserStatus } from './types.js'
import { systemUserId, agentIdentity } from '../box-config.js'
import { runUserCleanups } from './cleanup.js'
import { agentProfileMapFor } from '../agent-profiles.js'
import { rememberAgentDefault, forgetAgentDefault } from '../agent-defaults.js'

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
  channels: Record<string, string> | null
  token_ciphertext: string | null
  token_issued_at: string | null
  token_last_used_at: string | null
  token_revoked_at: string | null
  /** Sign-in link single-use watermark: epoch MILLISECONDS, not a timestamp (see core-models.ts).
   *  Never surfaced to a caller - toUser() drops it, like the token columns. */
  link_watermark: number | null
  agent_profile: string | null
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

function toUser(r: UserRecord): User {
  return {
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    nickname: r.nickname,
    email: r.email,
    image: r.image,
    color: r.color,
    status: (r.status || 'active') as UserStatus,
    role: r.id === systemUserId() ? agentIdentity().role : (r.role || 'member') as UserRole,
    tailscale_login: r.tailscale_login,
    channels: r.channels ?? {}, // malformed JSON degrades to no handles (the layer parses to null)
    agent_profile: r.agent_profile ?? null,
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

// --- reads ---------------------------------------------------------------------------------------

/** Every user, ordered for display. Took a role filter until 2026-09-10, whose only real job was to
 *  keep external collaborators out of the internal lists (signal owners, the engagement matrix,
 *  karma labels); with collaborators gone every row IS internal and there is nothing to filter. */
export async function readUsers(): Promise<User[]> {
  const rows = await readRecords<UserRecord>(USERS, { orderBy: 'sort, created_at' })
  const users = rows.map(toUser)
  for (const user of users) rememberAgentDefault(user.id, user.agent_profile)
  return users
}

/** One user by id (primitive lookup). */
export async function readUser(id: string): Promise<User | null> {
  const rec = await readRecord<UserRecord>(USERS, { id })
  return rec ? toUser(rec) : null
}

/** Whether the directory contains a person rather than only the configured machine principal. */
export function hasHumanUser(users: readonly Pick<User, 'id'>[], machineId = systemUserId()): boolean {
  return users.some(user => user.id !== machineId)
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
  const rows = await withRead<{ id: string }>(`SELECT id FROM users WHERE lower(trim(email)) = ? LIMIT 1`, [value])
  return rows[0] ? readUser(rows[0].id) : null
}

export async function upsertUser(input: UserInput): Promise<User> {
  if (!SLUG_SEG.test(input.id)) throw new Error(`invalid user id "${input.id}" (use a-z, 0-9, -)`)
  // Read prev as the FULL record (not the User shape) so the {prev} merge keeps the token columns
  // intact - the public User only carries has_token.
  const prev = await readRecord<UserRecord>(USERS, { id: input.id })
  const prevUser = prev ? toUser(prev) : null
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
  // Uniqueness by a read before the write, like the slug check: DuckDB cannot ALTER a UNIQUE
  // constraint in, and two users mapped to one tailscale login would make the exchange ambiguous.
  if (tailscaleLogin && tailscaleLogin !== prevUser?.tailscale_login) {
    const clash = await withRead<{ id: string }>(`SELECT id FROM users WHERE tailscale_login = ? AND id <> ? LIMIT 1`, [
      tailscaleLogin,
      input.id,
    ])
    if (clash[0]) throw new Error(`tailscale login "${tailscaleLogin}" already belongs to user "${clash[0].id}"`)
  }
  const email = input.email !== undefined ? input.email?.trim() || null : (prevUser?.email ?? null)
  // The email is an identity (SSO signs people in by it), so two users may not share one, compared
  // case-insensitively. Checked on change only, so a Box that already holds a duplicate still saves
  // unrelated profile edits.
  if (email && !sameEmail(email, prevUser?.email)) {
    const clash = await withRead<{ id: string }>(`SELECT id FROM users WHERE lower(trim(email)) = ? AND id <> ? LIMIT 1`, [
      normalizeEmail(email),
      input.id,
    ])
    if (clash[0]) throw new Error(`email "${email}" already belongs to user "${clash[0].id}"`)
  }
  const rec = await upsertRecord<UserRecord>(
    USERS,
    {
      id: input.id,
      first_name: input.first_name ?? prevUser?.first_name ?? '',
      last_name: input.last_name ?? prevUser?.last_name ?? '',
      nickname: input.nickname ?? prevUser?.nickname ?? input.id,
      email,
      image: input.image !== undefined ? input.image : (prevUser?.image ?? null),
      color: input.color !== undefined ? input.color : (prevUser?.color ?? null),
      channels,
      status: prevUser?.status ?? 'active',
      role: input.role ?? prevUser?.role ?? 'member',
      tailscale_login: tailscaleLogin,
      agent_profile: agentProfile,
      sort: input.sort ?? prevUser?.sort ?? 0,
    },
    { prev },
  )
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
  await ensureSchema()
  await runUserCleanups(id)
  await withWrite(async (conn) => {
    await conn.run(`DELETE FROM users WHERE id = ?`, [id])
  })
  forgetAgentDefault(id)
}

/** Assign sequential `sort` to users in the given id order (drag reorder). */
export async function reorderUsers(ids: string[]): Promise<void> {
  await ensureSchema()
  await withWrite(async (conn) => {
    for (let i = 0; i < ids.length; i++) {
      await conn.run(`UPDATE users SET sort = ?, updated_at = now() WHERE id = ?`, [i, ids[i]])
    }
  })
}

/** Guard a write that names a user (owner, assignee): the id must be an existing users.id. */
export async function assertKnownUser(owner: string): Promise<void> {
  const users = await readUsers()
  if (!users.some((u) => u.id === owner)) {
    throw new Error(`unknown user "${owner}" - add them under Settings → Users first`)
  }
}
