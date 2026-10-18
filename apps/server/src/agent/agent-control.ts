// Live agent channels (every authenticated /agent WebSocket, and Builder runners) per user, so they
// are closed along with Box authorization (revoke, delete, demotion), not only at the next request.
const controls = new Map<string, Set<() => void>>()

export function trackAgentControl(user: string, revoke: () => void): () => void {
  const owned = controls.get(user) ?? new Set<() => void>()
  owned.add(revoke)
  controls.set(user, owned)
  return () => {
    owned.delete(revoke)
    if (owned.size === 0 && controls.get(user) === owned) controls.delete(user)
  }
}

export function revokeAgentControl(user: string): void {
  const owned = controls.get(user)
  if (!owned) return
  controls.delete(user)
  for (const revoke of owned) {
    try { revoke() } catch { /* Continue revoking other connections and runners. */ }
  }
}
