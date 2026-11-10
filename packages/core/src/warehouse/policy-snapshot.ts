// The committed access policy this process runs on (PERMISSIONS 11.3, 11.10; BOX-Review W8 P
// findings 1 to 3 and 6): one immutable snapshot of a committed policy generation, read in one
// database snapshot: the generation (core.policy_state.revision), the routing (role id -> login)
// and the stored role definitions. A leaf module (no runtime imports), so the executor, the role
// registry and the revision listeners all read the same object.
//
// Every source publishes through `publishPolicySnapshot`: boot, a policy command after its commit,
// the listener and an admission refresh. Publication is synchronous and generation-aware: an older
// or equal generation is ignored, so a slow publisher can never move routing or definitions back.
// Boot alone replaces whatever is there (a restored database may carry an older generation).

/** A stored role row as the database holds it (auth/roles.ts turns it into a definition). */
export interface StoredRoleRow {
  id: string
  label: string
  description: string | null
  default_level: string
  areas: unknown
}

export interface PolicySnapshot {
  /** The committed policy generation (core.policy_state.revision) these rows were read at. */
  readonly generation: number
  /** Role id -> its database login (retired logins excluded). */
  readonly logins: ReadonlyMap<string, string>
  /** The stored (custom) roles by id. */
  readonly roles: ReadonlyMap<string, StoredRoleRow>
}

const KEY = Symbol.for('silkweave.box.policy-snapshot')
interface State { snapshot: PolicySnapshot | null; listeners: Set<(next: PolicySnapshot, previous: PolicySnapshot | null) => void> }
// One state per process even if this module loads twice (source and build paths in tests).
const state: State = ((globalThis as Record<symbol, unknown>)[KEY] as State | undefined) ??
  ((globalThis as Record<symbol, unknown>)[KEY] = { snapshot: null, listeners: new Set() } satisfies State) as State

/** The published snapshot, or null before a database (or the test policy service) published one. */
export function policySnapshot(): PolicySnapshot | null {
  return state.snapshot
}

/** The published generation; 0 before anything was published. */
export function policyGeneration(): number {
  return state.snapshot?.generation ?? 0
}

/**
 * Publish `next` when it is newer than the published snapshot (`reset`: boot and tests, replace
 * unconditionally). Routing, definitions and generation change together, with no await in between;
 * listeners run after. Returns whether it was published.
 */
export function publishPolicySnapshot(next: PolicySnapshot, opts: { reset?: boolean } = {}): boolean {
  const previous = state.snapshot
  if (!opts.reset && previous && next.generation <= previous.generation) return false
  state.snapshot = next
  for (const listener of state.listeners) {
    try {
      listener(next, previous)
    } catch (error) {
      console.error('[policy] snapshot listener failed:', error)
    }
  }
  return true
}

/** Forget the snapshot (closing the database). */
export function clearPolicySnapshot(): void {
  state.snapshot = null
}

/** Run after every publication; returns the unsubscribe. */
export function onPolicySnapshot(listener: (next: PolicySnapshot, previous: PolicySnapshot | null) => void): () => void {
  state.listeners.add(listener)
  return () => state.listeners.delete(listener)
}
