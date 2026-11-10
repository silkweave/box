// What a principal may reach: a level per area plus admin authority (docs/AUTH.md "Roles and
// areas"). An area is an installed feature id or one of the two core areas, `signals` and `ops`.
// The one place access is computed; every transport and accessor asks through the request context
// (request-context.ts), never by reading `principal.role` itself.

import type { Principal } from './principal.js'
import { accessForRole } from './roles.js'

import { ADMIN_AREA, type AccessLevel } from './levels.js'
export { ACCESS_LEVELS, type AccessLevel } from './levels.js'
export { bumpPolicyRevision, onPolicyRevision, policyRevision } from './policy-revision.js'

/** The core areas: signals no feature owns, and actions no feature owns. */
export const CORE_AREAS = ['signals', 'ops'] as const

export interface Access {
  /** The role the levels came from (a built-in or custom role id). */
  role: string
  /** Levels for the areas a role names; every other area gets `fallback`. */
  areas: ReadonlyMap<string, AccessLevel>
  fallback: AccessLevel
  /** Admin authority: `@Admin()` handlers, admin tools. Only the built-in `admin` role has it. */
  admin: boolean
  /** The committed policy generation this access was computed at (policy-revision.ts). */
  revision: number
}

const RANK: Record<AccessLevel, number> = { none: 0, read: 1, write: 2 }

/** Whether `held` satisfies `needed`. */
export function levelCovers(held: AccessLevel, needed: AccessLevel): boolean {
  return RANK[held] >= RANK[needed]
}

/** The level `access` grants on `area`. */
export function levelOf(access: Access, area: string): AccessLevel {
  return access.areas.get(area) ?? access.fallback
}

/**
 * Whether `access` reaches every area in `areas` at `level` (PERMISSIONS 8.3), for a principal other
 * than the current scope's (a delivery's recipient). The pseudo-area `admin` needs admin authority;
 * an empty list reaches nothing. The current scope asks `canReachAreas` instead.
 */
export function accessReaches(access: Access, areas: readonly string[], level: AccessLevel): boolean {
  return areas.length > 0 && areas.every((a) => (a === ADMIN_AREA ? access.admin : levelCovers(levelOf(access, a), level)))
}

/**
 * The access `principal` holds now, from its role (roles.ts). Built-in `admin`: every area at write
 * plus admin authority. Built-in `member`: every area at write. A custom role: its levels. A role
 * id that names nothing: no areas, no admin authority (signed in, core-only).
 *
 * Tagged with the committed policy generation it reflects (`Access.revision`): never newer than the
 * generation known before the principal's row was read (`principal.resolvedAt`), so the executor's
 * admission re-resolves a frame whose identity may predate a policy commit. A principal built by
 * hand (tests, no resolution) takes the published generation.
 */
export async function accessOf(principal: Principal): Promise<Access> {
  return accessForRole(principal.role, principal.resolvedAt)
}

/** The 403 an area refusal answers with: the area and the level needed, no record names. */
export class AreaAccessError extends Error {
  readonly status = 403
  constructor(
    readonly area: string,
    readonly needed: AccessLevel,
  ) {
    super(`no ${needed} access to ${area}`)
    this.name = 'AreaAccessError'
  }

  toJSON(): { error: 'area_access'; area: string; needed: AccessLevel } {
    return { error: 'area_access', area: this.area, needed: this.needed }
  }
}
