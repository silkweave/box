// Core commands (BOX-Review W8 findings 7 and ca251a1 2): a fixed write that must reach rows in
// areas the caller cannot (a rename re-pointing other areas' formulas, a delete pruning their
// edges). The request authorizes the resource, then one box_system transaction runs the fixed SQL.
//
// Authorization is bound to the access generation it checked: the access object is captured before
// `authorize` runs, and when it changed by the end (a read inside `authorize` re-resolved the frame
// after a policy commit) `authorize` runs again. The system transaction carries that generation as
// the requester's; admission refuses it when the committed policy revision is newer, re-resolves
// the requester and `authorize` runs again before any privileged statement. Like every admission,
// the probe proves the policy at the transaction's first statement; a change committed while the
// command runs is not promised to stop it (the short-transaction boundary).

import { contextStore, currentScope, type CommandRequester } from '../context-store.js'
import { withWrite, type Tx } from './db.js'
import { db } from './core-db.js'
import { executor, ExecutorError } from './executor.js'

const CORE = { reach: 'core' } as const
const ATTEMPTS = 3

/**
 * Run `fn` as the system scope `reason`, for the current requester, after `authorize` passed in the
 * request. `authorize` throws to refuse; it runs again (on re-resolved access) when the policy moved
 * during or after it. Callable from a request frame (the requester) or from system code (no
 * requester); refused inside another core command, whose system frame must not authorize for its
 * requester.
 */
export function coreCommand<T>(reason: string, authorize: () => void | Promise<void>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return authorizedSystemWork(reason, authorize, () => withWrite(fn, CORE))
}

/**
 * `coreCommand` for a read: one read-only box_system transaction on core reach, bound to the
 * requester's authorized generation the same way (BOX-Review R5 finding 1). For a read that must see
 * rows the caller's frame cannot (another feature's table, every area's rows) and filter them by the
 * caller's access: `authorize` captures what the filter needs from the freshly admitted frame.
 */
export function coreRead<T>(reason: string, authorize: () => void | Promise<void>, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return authorizedSystemWork(reason, authorize, () => executor().transaction(fn, { ...CORE, readOnly: true }))
}

async function authorizedSystemWork<T>(reason: string, authorize: () => void | Promise<void>, work: () => Promise<T>): Promise<T> {
  if (!reason) throw new Error('coreCommand needs a reason')
  const store = contextStore()
  const frame = store.getStore()
  const scope = currentScope()
  if (scope.kind === 'system' && scope.requester) throw new ExecutorError('NESTED_LOGIN', `${reason}: a core command cannot run inside another core command`)
  if (scope.kind !== 'principal' && scope.kind !== 'system') throw new ExecutorError('NO_CONTEXT', `${reason}: no principal or system context`)
  const holder = frame?.kind === 'request' ? frame.holder : undefined
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const checked = holder?.access
    await authorize()
    let requester: CommandRequester | undefined
    if (holder) {
      // Re-resolved during authorize: the check may have run on the older access.
      if (!checked || holder.access !== checked) continue
      requester = { holder, authorizedRevision: checked.revision }
    }
    try {
      return await store.run({ kind: 'system', reason, ...(requester ? { requester } : {}) }, work)
    } catch (e) {
      if (!(e instanceof ExecutorError && e.code === 'REAUTHORIZE')) throw e
    }
  }
  throw new ExecutorError('POLICY_STALE', `${reason}: the access policy changed while this command was admitted; try again`)
}

/**
 * Admit the current frame against the committed policy with no other work: one core read whose
 * admission refreshes the published snapshot and re-resolves a stale request frame (or empties it
 * and throws NO_PRINCIPAL). For checks that must hold at a delivery or a start, not only at the
 * request (a stream handing out a line, a queued run starting). System and other scopes pass.
 */
export async function admitFrame(): Promise<void> {
  if (currentScope().kind !== 'principal') return
  // The admission probe: a bare read-only statement on core reach.
  await db.selectNoFrom((eb) => eb.lit(1).as('one')).execute()
}
