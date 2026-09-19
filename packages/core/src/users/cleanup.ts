// The user-deletion port. A deleted user must leave no row pointing at a ghost id, but the rows
// that point at one belong to FEATURES - planning's `initiatives.owner` and `tasks.assignee` were
// named in core's own `deleteUser` SQL until 2026-09-13, so a Box without planning compiled fine
// and failed at runtime on the first delete, which is the worse of the two failures.
//
// The standard inversion (SEAM: dependents register into dependencies). Core knows that a user is
// going away and says so; each feature that references a user id registers what to do about its
// OWN tables, from its server module. A Box with no features has nothing to clean up.

/** Called with the id of the user about to be deleted. Awaited. */
export type UserCleanup = (id: string) => Promise<void> | void

const cleanups = new Map<string, UserCleanup>()

/** Register a feature's cleanup under a stable id (the feature's). Returns the unregister. */
export function registerUserCleanup(id: string, cleanup: UserCleanup): () => void {
  if (cleanups.has(id)) throw new Error(`user cleanup "${id}" registered twice`)
  cleanups.set(id, cleanup)
  return () => {
    if (cleanups.get(id) === cleanup) cleanups.delete(id)
  }
}

/**
 * Run every registered cleanup for `id`, in registration order, awaiting each.
 *
 * A cleanup that throws PROPAGATES and so aborts the delete: a user row that still exists with its
 * references intact is recoverable, a deleted row with dangling references is not. Runs before the
 * row is removed, so a cleanup may still read the user.
 */
export async function runUserCleanups(id: string): Promise<void> {
  for (const cleanup of cleanups.values()) await cleanup(id)
}
