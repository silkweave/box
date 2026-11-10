import { useSyncExternalStore } from 'react'

// The signed-in principal's access as `/api/auth/me` returns it: the level per area (every installed
// feature id plus `signals` and `ops`), admin authority and the policy revision (docs/AUTH.md "Roles
// and areas"). useAuth sets it before the principal, so everything built after the auth gate (nav,
// settings, slots, topbar, onSession starters) reads the right access on first use. An area missing
// from the map is `none`.

export type AreaLevel = 'none' | 'read' | 'write'

export interface ClientAccess {
  role: string
  label: string
  admin: boolean
  revision: number
  areas: Readonly<Record<string, AreaLevel>>
}

let current: ClientAccess | null = null
const listeners = new Set<() => void>()

export function setClientAccess(access: ClientAccess | null): void {
  if (current?.revision === access?.revision && current?.role === access?.role) return
  current = access
  for (const l of listeners) l()
}

export function clientAccess(): ClientAccess | null {
  return current
}

/** The areas `before` reached that `after` no longer does (none, or no access at all). */
export function lostAreas(before: ClientAccess | null, after: ClientAccess | null): string[] {
  if (!before) return []
  return Object.entries(before.areas)
    .filter(([area, level]) => level !== 'none' && (after?.areas[area] ?? 'none') === 'none')
    .map(([area]) => area)
    .sort()
}

/** A key that changes whenever access does, for caches built from it. */
export function accessKey(): string {
  return current ? `${current.role}@${current.revision}` : ''
}

const RANK: Record<AreaLevel, number> = { none: 0, read: 1, write: 2 }

/** Whether the signed-in principal reaches `area` at `level` (default read). */
export function canAccessArea(area: string, level: Exclude<AreaLevel, 'none'> = 'read'): boolean {
  if (!current) return false
  return RANK[current.areas[area] ?? 'none'] >= RANK[level]
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The current access, re-rendering when it changes. */
export function useAccess(): ClientAccess | null {
  return useSyncExternalStore(subscribe, clientAccess, clientAccess)
}
