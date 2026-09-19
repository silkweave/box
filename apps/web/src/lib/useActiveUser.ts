import { useEffect, useState } from 'react'
import { readStored, writeStored } from './usePersistedState.ts'
import { useUsersData } from './useUsersData.ts'
import type { User } from '../user-types.ts'
import { appKey } from './storage.ts'

// The active-user scope - WHO is operating the dashboard right now (no auth; a small team picking
// themselves from the top-right menu). Persisted per browser. Module-level store (mirrors
// useUsersData) so non-React data-layer helpers can read it synchronously via getActiveUserId()
// when attaching the `actor` audit field to mutations.

const USER_KEY = appKey('activeUser')
const FILTER_KEY = appKey('filterMine')

let activeUserId = readStored<string | null>(USER_KEY, null, (v) => v === null || typeof v === 'string')
let filterMine = readStored<boolean>(FILTER_KEY, false, (v) => typeof v === 'boolean')

const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())

/** The active users.id (or null) - for data-layer helpers stamping `actor` on mutations. */
export const getActiveUserId = (): string | null => activeUserId

export function setActiveUser(id: string | null): void {
  activeUserId = id
  writeStored(USER_KEY, id)
  emit()
}

export function setFilterMine(on: boolean): void {
  filterMine = on
  writeStored(FILTER_KEY, on)
  emit()
}

export interface ActiveUserState {
  /** The persisted users.id, or null when nobody is selected (or the id no longer exists). */
  userId: string | null
  /** The joined User row, or null. */
  user: User | null
  /** The global "Only my items" toggle. Views filter by this only when a user is active. */
  filterMine: boolean
  setActiveUser: (id: string | null) => void
  setFilterMine: (on: boolean) => void
}

export function useActiveUser(): ActiveUserState {
  const { data: users } = useUsersData()
  const [, setTick] = useState(0)

  useEffect(() => {
    const sync = (): void => setTick((t) => t + 1)
    listeners.add(sync)
    return () => {
      listeners.delete(sync)
    }
  }, [])

  // A stored id that no longer exists in the directory (deleted user) degrades to "no active user".
  const user = users?.find((u) => u.id === activeUserId) ?? null
  const userId = users && !user ? null : activeUserId
  return { userId, user, filterMine, setActiveUser, setFilterMine }
}
