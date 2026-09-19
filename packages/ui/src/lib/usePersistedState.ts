import * as React from 'react'

/**
 * localStorage-backed React state (ported from claudepad). Safe when storage is
 * unavailable (falls back to the in-memory default). Values are JSON-serialized;
 * an optional `valid` guard rejects malformed/stale stored values.
 *
 * `migrate` is the richer alternative to `valid` (and takes precedence over it): it can REPAIR a
 * stored value that a release has moved on from, returning null to fall back to the default. The
 * migrated value is written back on the next state effect, so a stored shape upgrades in place -
 * which is what lets a saved board view survive a column being split in two.
 */
export function readStored<T>(
  key: string,
  fallback: T,
  valid?: (v: unknown) => boolean,
  migrate?: (v: unknown) => T | null,
): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const parsed: unknown = JSON.parse(raw)
    if (migrate) return migrate(parsed) ?? fallback
    if (valid && !valid(parsed)) return fallback
    return parsed as T
  } catch {
    return fallback
  }
}

export function writeStored<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore persistence failures */
  }
}

/**
 * One value per KEY, shared by every hook reading it, plus the listeners to notify on a write.
 *
 * Until 2026-09-08 each call site held its own `useState`, so two components rendering the SAME
 * setting drifted apart: the initiative task list's column picker wrote `taskColumns` to storage
 * and re-rendered itself while the grid beside it kept showing the old columns until something
 * remounted it. A setting is one value; a hook whose two readers can disagree about it is not
 * modelling a setting at all. The cache outlives unmounts on purpose - settings are few, and the
 * next mount should see what the last write said rather than re-parse storage.
 */
const cache = new Map<string, unknown>()
const listeners = new Map<string, Set<() => void>>()

export function usePersistedState<T>(
  key: string,
  fallback: T,
  valid?: (v: unknown) => boolean,
  migrate?: (v: unknown) => T | null,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  // Lazily seeded from storage by the first hook on this key; later hooks join the value in flight.
  if (!cache.has(key)) cache.set(key, readStored(key, fallback, valid, migrate))

  const value = React.useSyncExternalStore(
    React.useCallback(
      (onChange: () => void) => {
        const set = listeners.get(key) ?? new Set()
        listeners.set(key, set)
        set.add(onChange)
        return () => {
          set.delete(onChange)
          if (set.size === 0) listeners.delete(key)
        }
      },
      [key],
    ),
    () => cache.get(key) as T,
  )

  // The mount write is what persists a MIGRATED value: `readStored` repairs a stale shape in
  // memory, and this puts the repaired one back on disk without waiting for an edit.
  React.useEffect(() => {
    writeStored(key, cache.get(key) as T)
  }, [key])

  const setValue = React.useCallback<React.Dispatch<React.SetStateAction<T>>>(
    (action) => {
      const prev = cache.get(key) as T
      const next = typeof action === 'function' ? (action as (p: T) => T)(prev) : action
      if (Object.is(next, prev)) return
      cache.set(key, next)
      writeStored(key, next)
      for (const listener of listeners.get(key) ?? []) listener()
    },
    [key],
  )

  return [value, setValue]
}
