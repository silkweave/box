// Recipients judged at delivery time (PERMISSIONS 8.3): the people a delivery reaches (a room's
// readers, a DM's peer, a push's device owner) and the access each holds, all at one committed
// policy generation (BOX-Review R5 finding 3). The identities come with the revision they were read
// at (one statement: `resolvePrincipalWithRevision`, `activePrincipalsWithRevision`); every role is
// then read at exactly that revision (`accessForRoleAt`). When the published policy is at another
// generation (a commit landed between the read's admission and its SELECT, or after), the read runs
// again: its admission publishes the committed policy first. Never cached across deliveries: each
// delivery judges its recipients right before it dispatches.
//
// Like every admission, this proves the policy at the read; a change committed between the
// judgement and the post (the caller's dispatch may still await its own preparation, such as
// resolving the sender) is the accepted point-in-time boundary, and an already dispatched message is
// not recalled.

import type { Access } from './access.js'
import { activePrincipalsWithRevision, resolvePrincipalWithRevision, type Principal } from './principal.js'
import { policyRevision } from './policy-revision.js'
import { accessForRoleAt } from './roles.js'
import { ExecutorError } from '../warehouse/executor.js'

const ATTEMPTS = 3

export interface Recipient {
  principal: Principal
  /** Access at the judged generation; null when that generation does not define the role (fail closed: reaches nothing). */
  access: Access | null
  revision: number
}

/** Judge `load`'s principals at the revision it read them at, retrying while the published policy is elsewhere. */
export async function recipientsAt(load: () => Promise<{ principals: readonly Principal[]; revision: number }>): Promise<Recipient[]> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const { principals, revision } = await load()
    // Synchronous from here: definitions and the generation check come from one published snapshot.
    if (policyRevision() !== revision) continue
    return principals.map((principal) => ({ principal, access: accessForRoleAt(principal.role, revision), revision }))
  }
  throw new ExecutorError('POLICY_STALE', 'the access policy changed while recipients were judged; try again')
}

/** Every principal that may act right now, judged at one generation. */
export function activeRecipients(): Promise<Recipient[]> {
  return recipientsAt(activePrincipalsWithRevision)
}

/** One principal by id judged at the generation its row was read at, or null when it does not resolve. */
export async function recipientById(id: string): Promise<Recipient | null> {
  const [r] = await recipientsAt(async () => {
    const { principal, revision } = await resolvePrincipalWithRevision(id)
    return { principals: principal ? [principal] : [], revision }
  })
  return r ?? null
}
