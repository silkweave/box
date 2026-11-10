// The policy revision, in a leaf module: config writers (agent-tools.ts) bump it, and access.ts sits
// in an import cycle with the warehouse through roles.ts.
//
// The revision is the committed policy generation (core.policy_state.revision) this process has
// published (warehouse/policy-snapshot.ts): the only tag access and caches carry. It moves with
// every change that can alter what someone may reach: role rows and user roles (policy commands),
// and changes that live in files (agent config, toolsets, connection marks), which commit a bump
// through the policy service before they report. Streams hold the revision they authorized at and
// re-read access when it moves.
import { onPolicySnapshot, policyGeneration } from '../warehouse/policy-snapshot.js'

export function policyRevision(): number {
  return policyGeneration()
}

let persist: ((reason: string) => Promise<number>) | null = null

/** The booted database's policy command (pg/boot.ts): commits a bump and publishes it. */
export function setPolicyRevisionPersister(fn: ((reason: string) => Promise<number>) | null): void {
  persist = fn
}

/**
 * Commit a policy revision for a change that lives in files and tell live streams: resolves once
 * the bump is committed and published in this process (other processes see it at their next
 * admission). Refuses without a policy service. Role rows never come here (policyCommand).
 * Cross-process revocation of file policy waits for permissions step 6's journal: another process
 * re-reads access at the new revision but reads the files it has.
 */
export async function bumpPolicyRevision(reason = 'policy files changed'): Promise<number> {
  if (!persist) throw new Error('the policy service is not configured (openDatabase has not run in this process)')
  return persist(reason)
}

/** Subscribe to published policy revisions; returns the unsubscribe. */
export function onPolicyRevision(listener: (revision: number) => void): () => void {
  return onPolicySnapshot((next) => listener(next.generation))
}
