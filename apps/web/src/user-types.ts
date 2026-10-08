// Mirror of the server's users domain (packages/core/src/users/types.ts). The tRPC router reflects
// nested DTO arrays as `unknown[]`, so useUsersData casts the wire shape to this type - same pattern
// as planning.

import type { AvatarUser } from '@silkweave/box-ui'

/** `extends AvatarUser` is documentation: it is what lets a `User` be passed straight to the
 *  library's avatars, pickers and directory provider with no mapping. */
export interface User extends AvatarUser {
  id: string
  first_name: string
  last_name: string
  nickname: string
  /** Reference-only contact - no mail is ever sent. */
  email: string | null
  image: string | null
  /** Swatch name from @silkweave/box-ui/lib ('indigo', 'cyan', …); null = deterministic fallback. */
  color: string | null
  /** Access lifecycle: active | invited | revoked (internal users are simply 'active'). */
  status: string
  /** channel → handle map - the source of truth for per-person presence. */
  channels: Record<string, string>
  /** Default agent profile (`<person>:<engine>`); null = Claude first. The agent runs on it only. */
  agent_profile: string | null
  /** Whether an access token has been issued (the token itself is never sent to the client). */
  has_token: boolean
  sort: number
  created_at: string
  updated_at: string
}

// The one implementation lives with the shape it reads (@silkweave/box-ui users/types.ts); this
// re-export keeps `userName` importable from here, where 30-odd call sites already ask for it.
export { userName } from '@silkweave/box-ui'

/** How a user's lifecycle status renders: label + text tone. */
export const USER_STATUS_META: Record<User['status'], { label: string; tone: string }> = {
  invited: { label: 'Invited', tone: 'text-warning' },
  active: { label: 'Active', tone: 'text-success' },
  revoked: { label: 'Revoked', tone: 'text-danger' },
}
