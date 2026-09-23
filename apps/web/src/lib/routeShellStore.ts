/** One active publisher per application. Ownership makes delayed cleanup harmless. */
export function createRouteShellStore<T>() {
  type Snapshot = { owner: symbol; section: string; location: string; value: T }
  let snapshot: Snapshot | null = null
  const listeners = new Set<() => void>()
  const emit = () => { for (const listener of listeners) listener() }
  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => snapshot,
    publish(owner: symbol, section: string, location: string, value: T) {
      snapshot = { owner, section, location, value }
      emit()
    },
    remove(owner: symbol) {
      if (snapshot?.owner !== owner) return
      snapshot = null
      emit()
    },
  }
}

export function selectRouteChrome<T>(snapshot: { section: string; location: string; value: T } | null, section: string, location: string): T | undefined {
  return snapshot?.section === section && snapshot.location === location ? snapshot.value : undefined
}
