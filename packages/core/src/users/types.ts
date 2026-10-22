import type { WorkAccess } from '../work-access.js'

// People domain - the small user directory the dashboard's Settings → Users page manages. Users are
// referenced by initiatives.owner and tasks.assignee (both store a user `id`). The structured state
// lives in the warehouse `users` table. See docs/AUTH.md.

/** Access lifecycle. `invited` = a token was minted and never used; first use flips it to `active`. */
export type UserStatus = 'invited' | 'active' | 'revoked'
export const USER_STATUSES: UserStatus[] = ['invited', 'active', 'revoked']

/**
 * The two trust tiers (docs/core/AUTH.md § 3). The line between them is one sentence, and every feature
 * applies it: **an operation is admin-only when its blast radius is another person's identity or
 * credential, the service itself, or configuration wired to credentials.** Everything else is a
 * member's, which is the whole working surface - signals, boards, tasks, content, chat, records,
 * running an action, reading anything.
 */
export type UserRole = 'admin' | 'member'
export const USER_ROLES: UserRole[] = ['admin', 'member']

/**
 * What a principal is. `agent` rows are the Box's agents (agents.ts): their name and role come from
 * config, they sign in with a bearer token only, and they are never deleted (a retired agent stays as
 * the author of its messages). Everyone else is `human`.
 */
export type UserKind = 'human' | 'agent'
export const USER_KINDS: UserKind[] = ['human', 'agent']

export interface User {
  /** Stable slug id (derived from the nickname on create, then fixed). */
  id: string
  first_name: string
  last_name: string
  nickname: string
  /** The person's identity email: unique (case-insensitive) and admin-only to change, because an
   *  identity provider may sign people in by it. No mail is ever sent to it by core. */
  email: string | null
  /** The person's phone number in E.164 (`+4366012345678`): unique and admin-only to change,
   *  because channels that see numbers (a messaging app) recognise team members by it. */
  phone: string | null
  /** Avatar image URL; null falls back to a nickname-initials chip in the UI. */
  image: string | null
  /** Swatch name from the web's fixed palette ('indigo', 'cyan', …); tints the user's signal
   *  cards. null = the UI picks deterministically from the palette. */
  color: string | null
  status: UserStatus
  role: UserRole
  /** Human or agent; set by boot reconciliation from the agent files, never by a request. */
  kind: UserKind
  /** The tailscale login this user signs in as (`tailscale whois` prints it, e.g. `alice@github`),
   *  when the Box runs behind `tailscale serve` with AUTH_TAILSCALE_SERVE=1. null = token only.
   *  Unique across users; `upsertUser` enforces it (DuckDB cannot ALTER in a UNIQUE constraint). */
  tailscale_login: string | null
  /** channel → handle map, the source of truth for per-person presence (whatever a feature checks
   *  or links per person on a channel). */
  channels: Record<string, string>
  /** Default agent profile (`<person>:<engine>`, one of this user's agentProfiles), or null for the
   *  deployment rule (Claude first). For the agent principal it is the only profile it runs on. */
  agent_profile: string | null
  /** What this person's Work session may touch (work-access.ts). Admin-set; the stored value is
   *  complete after normalization, so a NULL column reads as the defaults. Ignored for admins and
   *  agents, whose sessions are not guarded. */
  work: WorkAccess
  /** Whether an access token has been issued (the token itself is never listed). */
  has_token: boolean
  /** Display ordering in the Users page (lower first). */
  sort: number
  created_at: string
  updated_at: string
}

/** Partial upsert input - `id` identifies the row; any provided field overwrites, the rest persist. */
export interface UserInput {
  id: string
  first_name?: string
  last_name?: string
  nickname?: string
  /** Identity email ('' clears). Admin-only to change; unique across users. */
  email?: string | null
  /** Phone in E.164 or a typed form (`0043 660 ...`, spaces and dashes allowed); '' clears.
   *  Admin-only to change; unique across users. */
  phone?: string | null
  image?: string | null
  color?: string | null
  /** channel → handle map. The users table is the SOURCE OF TRUTH for a person's per-channel
   *  presence (features key per-person views off it); empty-string handles are dropped. */
  channels?: Record<string, string>
  sort?: number
  /** Admin-only; the system principal must match host config. Set it through `setPrincipalRole`
   *  rather than here when the caller is a request - that is where the last-admin rule lives. */
  role?: UserRole
  /** Admin-only ('' clears). */
  tailscale_login?: string | null
  /** Default agent profile; must be one of the user's agentProfiles ('' or null clears). */
  agent_profile?: string | null
  /** Admin-only: Work capabilities; a partial object merges over the stored value. */
  work?: Partial<WorkAccess> | null
}
