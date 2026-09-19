/**
 * The shape the library draws a person as.
 *
 * Declared here rather than imported from an app's user type on purpose: the library must not know
 * what else a Box calls a person, only the five fields an avatar or a chip actually renders.
 * apps/web's `User` (src/user-types.ts) is structurally assignable to this, so call sites pass it
 * unchanged. Kept free of React so both the Avatar primitive and the directory context can use it
 * without either importing the other.
 */
export interface AvatarUser {
  id: string
  first_name: string
  last_name: string
  nickname: string
  image: string | null
}

/** Full display name, falling back to the nickname, then the id. The one implementation. */
export function userName(u: AvatarUser): string {
  const full = `${u.first_name} ${u.last_name}`.trim()
  return full || u.nickname || u.id
}
