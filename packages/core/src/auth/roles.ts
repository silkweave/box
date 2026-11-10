// Roles (docs/AUTH.md "Roles and areas"). Two built-ins that are never stored: `admin` (every area
// at write, plus admin authority) and `member` (every area at write). Custom roles live in the core
// `roles` table: a level per named area and a default for every other area, present or future.
// Users reference a role by id in `users.role`; agents in their config (box.json `agent.role`,
// data/config/agents/<id>.md). A reference that resolves to nothing grants nothing.

import { FEATURE_LIST } from '../generated/features.js'
import { db } from './db.js'
import { policySnapshot, type PolicySnapshot, type StoredRoleRow } from '../warehouse/policy-snapshot.js'
import { policyCommand, type PolicyTx } from '../warehouse/pg/boot.js'
import { CORE_AREAS, levelOf, type Access } from './access.js'
import { ACCESS_LEVELS, type AccessLevel } from './levels.js'
import { configuredAgents } from '../agents.js'
export const BUILTIN_ROLE_IDS = ['admin', 'member'] as const
export type BuiltinRoleId = (typeof BUILTIN_ROLE_IDS)[number]

export interface RoleDefinition {
  id: string
  label: string
  description: string
  /** The level of every area `areas` does not name, including areas installed later. */
  default: AccessLevel
  areas: Record<string, AccessLevel>
  builtin: boolean
}

const BUILTINS: Record<BuiltinRoleId, RoleDefinition> = {
  admin: { id: 'admin', label: 'Admin', description: 'Every area, plus administration: users, roles, credentials and the service.', default: 'write', areas: {}, builtin: true },
  member: { id: 'member', label: 'Member', description: 'Every area, no administration.', default: 'write', areas: {}, builtin: true },
}

/** The built-in roles, for the database policy (warehouse/pg/boot.ts). */
export const BUILTIN_ROLES: readonly RoleDefinition[] = Object.values(BUILTINS)

export { ROLE_REF as ROLE_ID } from './levels.js'
import { ROLE_REF as ROLE_ID } from './levels.js'

export function isBuiltinRole(id: string): id is BuiltinRoleId {
  return (BUILTIN_ROLE_IDS as readonly string[]).includes(id)
}

/** Every area a role can name: each installed feature, plus `signals` and `ops`. */
export function knownAreas(): string[] {
  return [...FEATURE_LIST.map((f) => f.id), ...CORE_AREAS].sort()
}

const isLevel = (v: unknown): v is AccessLevel => typeof v === 'string' && (ACCESS_LEVELS as readonly string[]).includes(v)

type RoleRow = StoredRoleRow

/** A stored role row as a definition (the policy service reads rows inside its own transaction). */
export function roleDefinitionFromRow(r: RoleRow): RoleDefinition {
  const raw = (typeof r.areas === 'string' ? JSON.parse(r.areas) : r.areas) as Record<string, unknown> | null
  const areas: Record<string, AccessLevel> = {}
  // A stored level that is not a level grants nothing for that area.
  for (const [area, level] of Object.entries(raw ?? {})) areas[area] = isLevel(level) ? level : 'none'
  return { id: r.id, label: r.label, description: r.description ?? '', default: isLevel(r.default_level) ? r.default_level : 'none', areas, builtin: false }
}

// The stored roles are part of the published policy snapshot (warehouse/policy-snapshot.ts): read
// in the same database snapshot as the generation and the routing, and replaced with them. There is
// no separate cache fill that could put old definitions back after a newer generation.
const definitions = new WeakMap<PolicySnapshot, Map<string, RoleDefinition>>()

function rolesOf(snap: PolicySnapshot): Map<string, RoleDefinition> {
  let roles = definitions.get(snap)
  if (!roles) {
    roles = new Map([...snap.roles.values()].sort((a, b) => a.id.localeCompare(b.id)).map((r) => [r.id, roleDefinitionFromRow(r)]))
    definitions.set(snap, roles)
  }
  return roles
}

function currentSnapshot(): PolicySnapshot {
  const snap = policySnapshot()
  if (!snap) throw new Error('no policy snapshot: the database is not open in this process')
  return snap
}

/** The role `id` names in `snap`, or null. */
function roleIn(snap: PolicySnapshot, id: string): RoleDefinition | null {
  if (isBuiltinRole(id)) return BUILTINS[id]
  return rolesOf(snap).get(id) ?? null
}

/** Every role: the built-ins first, then the custom roles by id. */
export async function listRoles(): Promise<RoleDefinition[]> {
  return [BUILTINS.admin, BUILTINS.member, ...rolesOf(currentSnapshot()).values()]
}

/** The role `id` names, or null when it names nothing. */
export async function getRole(id: string): Promise<RoleDefinition | null> {
  if (isBuiltinRole(id)) return BUILTINS[id]
  return roleIn(currentSnapshot(), id)
}

/** Whether `id` names a role (built-in or stored). */
export async function roleExists(id: string): Promise<boolean> {
  return (await getRole(id)) !== null
}

/**
 * The access a role grants in the published policy snapshot, tagged with the generation it was
 * computed at: at most `notAfter` (the generation known before the principal's identity was read,
 * access.ts), so access is never labelled newer than the identity it was computed for. One
 * synchronous read of one snapshot: definitions and tag cannot come from different generations.
 * An unknown role grants nothing.
 */
export function accessForRole(id: string, notAfter = Number.POSITIVE_INFINITY): Access {
  const snap = currentSnapshot()
  const revision = Math.min(snap.generation, notAfter)
  const role = roleIn(snap, id)
  if (!role) return { role: id, areas: new Map(), fallback: 'none', admin: false, revision }
  return { role: id, areas: new Map(Object.entries(role.areas)), fallback: role.default, admin: id === 'admin', revision }
}

/**
 * The access role `id` grants at exactly generation `generation`, or null when the published
 * snapshot is at another generation or does not define the role. For judgements that must not
 * read a missing definition as "no areas" (coverage, auth/covers.ts): the caller retries or fails
 * closed.
 */
export function accessForRoleAt(id: string, generation: number): Access | null {
  const snap = currentSnapshot()
  if (snap.generation !== generation) return null
  const role = roleIn(snap, id)
  if (!role) return null
  return { role: id, areas: new Map(Object.entries(role.areas)), fallback: role.default, admin: id === 'admin', revision: generation }
}

export interface RoleInput {
  id: string
  label: string
  description?: string
  default: AccessLevel
  areas: Record<string, AccessLevel>
}

/** Refuse a malformed role. Area keys must name installed areas; levels must be levels. */
export function validateRole(input: RoleInput): RoleInput {
  if (typeof input.id !== 'string' || !ROLE_ID.test(input.id)) throw new Error('a role id is a lowercase slug (a-z, 0-9, -), 2 to 41 characters, starting with a letter')
  if (isBuiltinRole(input.id)) throw new Error(`"${input.id}" is a built-in role and cannot be changed`)
  const label = typeof input.label === 'string' ? input.label.trim() : ''
  if (!label) throw new Error('a role needs a label')
  if (!isLevel(input.default)) throw new Error('default must be none, read or write')
  const known = new Set(knownAreas())
  const areas: Record<string, AccessLevel> = {}
  for (const [area, level] of Object.entries(input.areas ?? {})) {
    if (!known.has(area)) throw new Error(`"${area}" is not an area of this Box (areas: ${[...known].join(', ')})`)
    if (!isLevel(level)) throw new Error(`the level for ${area} must be none, read or write`)
    areas[area] = level
  }
  return { id: input.id, label, description: (input.description ?? '').trim(), default: input.default, areas }
}

/**
 * Create or replace a custom role through the policy service: the coverage preview runs first
 * (PERMISSIONS 7.2), so a role that would let an agent outgrow the readers of its destinations is
 * refused with the list (CoverageRefusedError) unless confirmed with `confirm: 'remove-members'`
 * and the preview's revision. Bumps the policy revision.
 */
export async function upsertRole(input: RoleInput, actor?: string, opts: import('./policy-service.js').PolicyApplyOptions = {}): Promise<RoleDefinition> {
  const role = validateRole(input)
  const { applyPolicyChange } = await import('./policy-service.js')
  await applyPolicyChange({ reason: `role upsert ${role.id}`, actor, roles: { upsert: [role] } }, opts)
  return (await getRole(role.id))!
}

/** The role row write, inside the policy service's transaction. */
export async function writeRoleInTx(tx: PolicyTx, role: RoleInput, actor?: string): Promise<void> {
  await tx.run(
    `insert into core.roles (id, label, description, default_level, areas, created_at, updated_at, created_by, updated_by)
     values ($1, $2, $3, $4, $5::jsonb, now(), now(), $6, $6)
     on conflict (id) do update set label = excluded.label, description = excluded.description,
       default_level = excluded.default_level, areas = excluded.areas, updated_at = now(), updated_by = excluded.updated_by`,
    [role.id, role.label, role.description ?? '', role.default, JSON.stringify(role.areas), actor ?? null],
  )
}

/** Who references a role: user rows and agent config files. */
export interface RoleReferences {
  users: string[]
  agents: string[]
}

/** The configured agents (box.json `agent`, data/config/agents/) whose role is `role`. */
export function agentsWithRole(role: string): string[] {
  return configuredAgents().filter((a) => a.role === role).map((a) => a.id)
}

/** Every reference to `role`: user rows and agent config. */
export async function roleReferences(role: string): Promise<RoleReferences> {
  const users = await db
    .selectFrom('users')
    .select('id')
    .where('role', '=', role)
    .where((eb) => eb(eb.fn.coalesce('kind', eb.val('human')), '<>', 'agent'))
    .orderBy('id')
    .execute()
  return { users: users.map((u) => u.id), agents: agentsWithRole(role) }
}

/**
 * Delete a custom role. Refused while any user or agent config references it; the user check and
 * the delete run in one transaction with the role row locked FOR UPDATE (an assignment holds it FOR
 * SHARE, auth/principal.ts), so an assignment cannot slip between them. Agent references are
 * files, read inside the same transaction.
 */
export async function deleteRole(id: string): Promise<void> {
  if (isBuiltinRole(id)) throw new Error(`"${id}" is a built-in role and cannot be deleted`)
  await policyCommand(`role delete ${id}`, async (tx) => {
    const exists = await tx.query(`select id from core.roles where id = $1 for update`, [id])
    if (!exists.length) throw new Error(`no role "${id}"`)
    const users = (await tx.query<{ id: string }>(`select id from core.users where role = $1 and coalesce(kind, 'human') <> 'agent' order by id`, [id])).map((r) => r.id)
    const agents = agentsWithRole(id)
    if (users.length || agents.length) {
      const who = [...users, ...agents.map((a) => `agent ${a}`)]
      throw new Error(`role "${id}" is still assigned to ${who.join(', ')}; assign them another role first`)
    }
    await tx.run(`delete from core.roles where id = $1`, [id])
  })
}

/** Every area with the level `access` grants on it, for "explain access". */
export function explainLevels(access: Access): { area: string; level: AccessLevel }[] {
  return knownAreas().map((area) => ({ area, level: levelOf(access, area) }))
}

/** What a client is told about its access: every installed area's level, admin authority, revision. */
export interface AccessSummary {
  role: string
  /** The role's label; the id itself when the role names nothing. */
  label: string
  admin: boolean
  revision: number
  areas: Record<string, AccessLevel>
}

export async function describeAccess(access: Access): Promise<AccessSummary> {
  const role = await getRole(access.role)
  return {
    role: access.role,
    label: role?.label ?? access.role,
    admin: access.admin,
    revision: access.revision,
    areas: Object.fromEntries(explainLevels(access).map(({ area, level }) => [area, level])),
  }
}
