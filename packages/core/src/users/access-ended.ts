// The access-ended port: a person's access was revoked or their row deleted, and a feature holding
// credentials delegated by that person (the `mcp` recipe's sign-in grants) records it in its own
// tables. Core says so after the change has committed; the authoritative check stays the feature's
// own (a grant's `auth_epoch` against the user's, auth/principal.ts `resolveDelegatedPrincipal`),
// so a listener that fails is logged and does not undo or fail the revoke.

export type UserAccessEndedReason = 'revoked' | 'deleted'

/** Called with the user whose access ended. Awaited; a throw is logged. */
export type UserAccessEnded = (id: string, reason: UserAccessEndedReason) => Promise<void> | void

const listeners = new Map<string, UserAccessEnded>()

/** Register a feature's listener under a stable id (the feature's). Returns the unregister. */
export function registerUserAccessEnded(id: string, listener: UserAccessEnded): () => void {
  if (listeners.has(id)) throw new Error(`user access-ended listener "${id}" registered twice`)
  listeners.set(id, listener)
  return () => {
    if (listeners.get(id) === listener) listeners.delete(id)
  }
}

/** Tell every listener, in registration order. Called by core after a revoke or delete commits. */
export async function notifyUserAccessEnded(id: string, reason: UserAccessEndedReason): Promise<void> {
  for (const [owner, listener] of listeners) {
    try {
      await listener(id, reason)
    } catch (e) {
      console.error(`users: access-ended listener "${owner}" failed for "${id}" (${reason}):`, e)
    }
  }
}
