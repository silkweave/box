import { registerStoreReloads } from './changeFeed.ts'
import { createDataStore } from './dataStore.ts'
import { trpc } from './trpc.ts'
import type { User } from '../user-types.ts'

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
}

/** Create or update a user of any role (partial), then reload. Never flips an existing row's role
 */
export async function upsertUser({ channels, ...input }: UserUpsert): Promise<void> {
  await trpc.usersUpsert.mutate({ ...input, channels: channels ? JSON.stringify(channels) : undefined })
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
