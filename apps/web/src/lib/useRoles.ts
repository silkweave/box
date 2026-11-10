// Roles (Settings > Roles, docs/AUTH.md "Roles and areas"): admin and member are built in; custom
// roles grant a level per area. Every change previews its coverage first (PERMISSIONS 7.2): with no
// violations it applies, with violations it is refused with the list or, where the readers can be
// removed from their rooms, confirmed with the preview's revision.

import { registerStoreReloads } from './changeFeed.ts'
import { createDataStore } from './dataStore.ts'
import { trpc } from './trpc.ts'
import { reloadUsers, type PolicyPreview } from './useUsersData.ts'

export type AccessLevel = 'none' | 'read' | 'write'
export const ACCESS_LEVELS: readonly AccessLevel[] = ['none', 'read', 'write']

export interface Role {
  id: string
  label: string
  description: string
  default: AccessLevel
  areas: Record<string, AccessLevel>
  builtin: boolean
  /** People on this role. */
  users: string[]
  /** Agents whose config names this role. */
  agents: string[]
}

export interface RolesData {
  /** Every area of this Box: each installed feature, plus signals and ops. */
  areas: string[]
  roles: Role[]
}

const store = createDataStore<RolesData>(() => trpc.rolesList.query({}).then((d) => d as unknown as RolesData))
registerStoreReloads(['table:roles', 'table:users'], store)

export function useRoles(enabled = true): { data: RolesData | null; error: string | null } {
  return store.useData(enabled)
}

export interface RoleInput {
  id: string
  label: string
  description: string
  default: AccessLevel
  areas: Record<string, AccessLevel>
}

/** The coverage preview of creating or editing a role. */
export async function previewRole(role: RoleInput): Promise<PolicyPreview> {
  return (await trpc.rolesPreview.mutate({ kind: 'role', id: role.id, label: role.label, default: role.default, areas: JSON.stringify(role.areas) })) as PolicyPreview
}

/** Save a role; `confirm` repeats the preview's revision to also remove the members it listed. */
export async function saveRole(role: RoleInput, opts: { revision?: number; confirm?: 'remove-members' } = {}): Promise<void> {
  await trpc.rolesUpsert.mutate({ ...role, areas: JSON.stringify(role.areas), ...opts })
  await Promise.all([store.reload(), reloadUsers()])
}

/** Delete a custom role nobody holds. */
export async function deleteRole(id: string): Promise<void> {
  await trpc.rolesRemove.mutate({ id })
  await store.reload()
}

/** Change an agent's role (its config file, through the policy journal), after its preview. */
export async function setAgentRole(id: string, role: string, opts: { revision?: number; confirm?: 'remove-members' } = {}): Promise<void> {
  await trpc.rolesAgentSetRole.mutate({ id, role, ...opts })
  await Promise.all([store.reload(), reloadUsers()])
}

/** A role's grant in words: "crm write, chat read; everything else none". */
export function roleSummary(role: Role): string {
  if (role.id === 'admin') return 'Every area at write, and administration'
  if (role.id === 'member') return 'Every area at write'
  const named = Object.entries(role.areas).map(([area, level]) => `${area} ${level}`)
  return `${named.length ? `${named.join(', ')}; ` : ''}everything else ${role.default}`
}
