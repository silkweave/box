// Active controls are revoked along with Box authorization, not only at the next page load.
const controls = new Map<string, Set<() => void>>()

export function trackBuilderControl(user: string, revoke: () => void): () => void {
  const owned = controls.get(user) ?? new Set<() => void>()
  owned.add(revoke)
  controls.set(user, owned)
  return () => {
    owned.delete(revoke)
    if (owned.size === 0 && controls.get(user) === owned) controls.delete(user)
  }
}

export function revokeBuilderControl(user: string): void {
  const owned = controls.get(user)
  if (!owned) return
  controls.delete(user)
  for (const revoke of owned) {
    try { revoke() } catch { /* Continue revoking other connections and runners. */ }
  }
}
