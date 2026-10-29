// The ONE module-level cache + subscription store, replacing the seven hand-rolled copies that
// each domain hook (`useContentData`, `usePlanningData`, …) used to carry. Semantics preserved
// exactly: one shared fetch per store (deduped while inflight), components subscribe and re-render
// on every emit, mutations patch optimistically via `set()` and reconcile with `reload()`.

import { useEffect, useState } from 'react'

export interface DataStore<T> {
  /** Cached value when present, else fetch (deduped). `force` refetches. */
  load(force?: boolean): Promise<T>
  /** Force a refetch after a mutation. */
  reload(): Promise<T>
  /** Current cached value without fetching (null before the first load). */
  peek(): T | null
  /** Optimistically patch the cache and notify subscribers (no-op before the first load). */
  set(updater: (current: T) => T): void
  /** React hook: subscribe to the store; triggers the initial load. Pass `enabled: false` to skip
   *  both the subscription and the fetch (for consumers whose session may not read this route). */
  useData(enabled?: boolean): { data: T | null; error: string | null }
}

export function createDataStore<T>(fetcher: () => Promise<T>): DataStore<T> {
  let cache: T | null = null
  let inflight: Promise<T> | null = null
  const listeners = new Set<() => void>()
  const emit = (): void => listeners.forEach((l) => l())

  function load(force = false): Promise<T> {
    if (cache !== null && !force) return Promise.resolve(cache)
    if (!inflight) {
      inflight = fetcher()
        .then((d) => {
          cache = d
          emit()
          return d
        })
        .finally(() => {
          inflight = null
        })
    }
    return inflight
  }

  // A fresh top-level reference per emit so React re-renders (arrays stay arrays - `{...}` on an
  // array would mangle it into a plain object). Primitives pass through: spreading a string would
  // turn it into an object of its characters.
  const clone = (v: T | null): T | null =>
    v === null || typeof v !== 'object' ? v : Array.isArray(v) ? ([...v] as T) : ({ ...(v as object) } as T)

  function useData(enabled = true): { data: T | null; error: string | null } {
    const [data, setData] = useState<T | null>(cache)
    const [error, setError] = useState<string | null>(null)
    useEffect(() => {
      if (!enabled) return
      const sync = (): void => setData(clone(cache))
      listeners.add(sync)
      load()
        .then(sync)
        .catch((e) => setError(String(e)))
      return () => {
        listeners.delete(sync)
      }
    }, [enabled])
    return { data, error }
  }

  return {
    load,
    reload: () => load(true),
    peek: () => cache,
    set: (updater) => {
      if (cache === null) return
      cache = updater(cache)
      emit()
    },
    useData,
  }
}
