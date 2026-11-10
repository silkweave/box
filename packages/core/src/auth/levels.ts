// Access levels, in a leaf module: the core table specs read them at module evaluation, and
// access.ts sits in an import cycle with the warehouse through roles.ts.

export type AccessLevel = 'none' | 'read' | 'write'
export const ACCESS_LEVELS: readonly AccessLevel[] = ['none', 'read', 'write']

/** A role reference: a built-in (`admin`, `member`) or a custom role id (auth/roles.ts). */
export const ROLE_REF = /^[a-z][a-z0-9-]{1,40}$/

/** The pseudo-area of rows nothing classifies (PERMISSIONS 8.3): reachable with admin authority only. */
export const ADMIN_AREA = 'admin'
