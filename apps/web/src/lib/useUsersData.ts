import { registerStoreReloads } from './changeFeed.ts'
import { createDataStore } from './dataStore.ts'
import { trpc } from './trpc.ts'
import type { User, WorkAccess } from '../user-types.ts'

// One shared store (see dataStore.ts) so every Settings/picker consumer shares ONE fetch and
// re-renders on mutation (mirrors usePlanningData). Users are small + rarely change, so a plain cache
// with a force-reload after each write is plenty.
//
// The cache holds every principal. `data` and `all` are the same list since roles were removed on
// 2026-09-10; both are kept so the many call sites did not all have to change at once.

function fromWire(d: unknown): User[] {
  return ((d as { users?: unknown[] }).users ?? []) as User[]
}

const store = createDataStore<User[]>(() => trpc.usersList.query({}).then(fromWire))
registerStoreReloads(['table:users'], store)

/** Force a refetch (after a mutation made elsewhere). */
export const reloadUsers = (): Promise<User[]> => store.reload()

/** Fields editable from the dashboard (subset of the server's user-upsert input). */
export interface UserUpsert {
  id: string
  first_name?: string
  last_name?: string
  nickname?: string
  /** Reference-only contact email; '' clears. */
  email?: string
  /** Avatar image URL or data: URI; '' clears. */
  image?: string
  /** Swatch name ('indigo', 'cyan', …); '' clears back to the deterministic fallback. */
  color?: string
  /** channel → handle map - the source of truth for per-person presence ('' handles are dropped). */
  channels?: Record<string, string>
  sort?: number
  /** Default agent profile, one of the user's agentProfiles; '' clears. */
  agent_profile?: string
  /** Admin-only: Work capabilities, merged over the stored value. */
  work?: Partial<WorkAccess>
}

/** Create or update a user of any role (partial), then reload. Never flips an existing row's role
 */
export async function upsertUser({ channels, work, ...input }: UserUpsert): Promise<void> {
  await trpc.usersUpsert.mutate({
    ...input,
    channels: channels ? JSON.stringify(channels) : undefined,
    work: work ? JSON.stringify(work) : undefined,
  })
  await store.reload()
}

/** Create an agent (its file and principal, live), then reload. An admin at a browser session only. */
export async function createAgent(input: { id: string; name: string; role: 'admin' | 'member'; instructions?: string }): Promise<User> {
  const user = (await trpc.usersAgentCreate.mutate(input)) as unknown as User
  await store.reload()
  return user
}

/** Move a person between admin and member (admin only; never yourself, never an agent), then reload. */
export async function setUserRole(id: string, role: 'admin' | 'member'): Promise<void> {
  await trpc.usersSetRole.mutate({ id, role })
  await store.reload()
}

/** Delete a user (the server also unassigns it everywhere), then reload. */
export async function deleteUser(id: string): Promise<void> {
  await trpc.usersDelete.mutate({ id })
  await store.reload()
}

/** The invite payload for ANY user (admin-only endpoints): the plaintext token (shown once, or ''
 *  when none is issued), this Box's URL, and a ready-to-send message.
 *
 *  `url` is the Box's front door, NOT a credential - it used to embed the token in a magic-link path,
 *  which is what sign-in links replaced (2026-09-15). To get someone SIGNED IN, use `signinLink`. */
export interface UserInvite {
  token: string
  url: string
  message: string
  user: User
}

/** A short-lived, single-use sign-in link. Safe to send: it expires in minutes, works once, and
 *  carries no permanent credential. */
export interface UserSigninLink {
  url: string
  expiresAt: string
  message: string
  user: User
}

/** Mint (or ROTATE - the old token dies) a user's access token + a sign-in link. Also the "enable"
 *  path: issuing reactivates a disabled user. Admin-only. */
export async function inviteUser(id: string): Promise<UserInvite> {
  const invite = (await trpc.usersInvite.mutate({ id })) as unknown as UserInvite
  await store.reload()
  return invite
}

/**
 * Mint a SHORT-LIVED, single-use sign-in link. This is what to send someone who needs to get in -
 * prefer it over `inviteUser`, which mints the permanent credential and rotates whatever they had.
 * Admin-only.
 */
export async function signinLink(id: string, ttlMinutes?: number): Promise<UserSigninLink> {
  return (await trpc.usersLink.mutate({
    id,
    ...(ttlMinutes !== undefined && { ttlMinutes }),
  })) as unknown as UserSigninLink
}

/** Re-copy the current invite WITHOUT rotating. Empty token = none issued. Admin-only. */
export async function revealUserInvite(id: string): Promise<UserInvite> {
  return (await trpc.usersInviteReveal.mutate({ id })) as unknown as UserInvite
}

/** Disable a user (revoke token + status 'revoked'; sessions die on their next request). Re-enable
 *  via inviteUser. Admin-only; the server refuses self, `nova`, and the last admin. */
export async function revokeUserAccess(id: string): Promise<void> {
  await trpc.usersAccessRevoke.mutate({ id })
  await store.reload()
}

export function useUsersData(enabled = true): { data: User[] | null; all: User[] | null; error: string | null } {
  const { data, error } = store.useData(enabled)
  return { data: data ?? null, all: data, error }
}

/** What the Work folder picker offers for a partial path (admin-only; see docs/AUTH.md § Work sessions). */
export interface WorkFolderSuggestions {
  parent: string | null
  directories: string[]
  /** The typed path when it could be created as a Work folder, else null. */
  create: string | null
}

/** Grantable host directories completing `query`, as the admin types. Does not touch the user cache. */
export const workFolderSuggestions = (query: string): Promise<WorkFolderSuggestions> =>
  trpc.usersWorkFolders.mutate({ query })

/** Make one new directory for a Work grant (its parent must exist). Returns the created path. */
export const createWorkFolder = async (path: string): Promise<string> => (await trpc.usersWorkFolderCreate.mutate({ path })).path
