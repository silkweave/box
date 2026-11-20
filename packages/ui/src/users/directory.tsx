import { createContext, useContext, type ReactNode } from 'react'
import { userName, type AvatarUser } from './types.ts'

/**
 * The users directory seam.
 *
 * A Box has people in it, and the library draws them - avatars, owner chips, assignee pickers - but
 * it must not know how a given Box FETCHES them. So the list crosses as data on a context that the
 * app fills once at its root, not as a hook the library imports: twenty-odd feature call sites
 * render a picker without passing users today, and threading a `users` prop through all of them to
 * reach a leaf is the case a context exists for.
 *
 * The value is `AvatarUser[]`, the narrow shape the components actually draw (see ./types.ts).
 * apps/web's richer `User` is structurally assignable to it, so its adapter passes the store's list
 * through unchanged.
 */

/**
 * null = the directory is not loaded yet, or there is no provider at all. The distinction matters:
 * pickers show their empty-state hint only for `[]` (a Box with genuinely no users), never while a
 * fetch is still in flight.
 */
const UsersContext = createContext<readonly AvatarUser[] | null>(null)

/**
 * The users directory seam: the app fills it once at its root, and `UserChip`, `UserPicker`,
 * `AccountMenu` and the person filter read it.
 * Not for passing users to one component you render yourself (a prop is plainer).
 * Rule: pass `null` while loading and `[]` only for a Box with no users; pickers show their empty
 * hint for `[]` alone.
 */
export function UsersProvider({
  users,
  children,
}: {
  users: readonly AvatarUser[] | null
  children: ReactNode
}) {
  return <UsersContext.Provider value={users}>{children}</UsersContext.Provider>
}

export function useUsers(): readonly AvatarUser[] | null {
  return useContext(UsersContext)
}

/** The directory entry for an id, or null when the id is null, unknown, or the list is not loaded. */
export function useUser(id: string | null | undefined): AvatarUser | null {
  const users = useUsers()
  if (!id) return null
  return users?.find((u) => u.id === id) ?? null
}

/**
 * A resolver from a user id to the text a person is shown as: the full name, or the raw id when the
 * id is not in the directory (a deleted person, an outside actor).
 *
 * Use it for: a list's `searchText` and filter labels, so search matches the name the row shows,
 * and for plain-text places (a confirm message, an aria-label).
 * Not for drawing a person in a cell (use `UserChip` with `showName`, which uses the same text).
 */
export function usePersonName(): (id: string | null | undefined) => string {
  const users = useUsers()
  return (id) => {
    if (!id) return ''
    const u = users?.find((x) => x.id === id)
    return u ? userName(u) : id
  }
}
