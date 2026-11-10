// The context store under request-context.ts: frame and scope types, the process-wide
// AsyncLocalStorage and `currentScope`. Kept free of runtime imports (types only) so the executor
// and the test seam can load it without loading the role and feature registries.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Access } from './auth/access.js'
import type { Principal, PrincipalCredential } from './auth/principal.js'
import { framelessScope } from './frameless.js'

/** The request holder AuthGuard fills. */
export interface RequestHolder {
  principal?: Principal
  access?: Access
  credential?: PrincipalCredential
  /** The handler being run (`Class.method`, `mount:<id>`), for refusals and audit. */
  handler?: string
  /** Aborts when the caller of a live stream goes away (a closed socket, a stopped subscription).
   *  A stream parked in a wait races it, so it releases its listeners at once. */
  closed?: AbortSignal
}

/**
 * A system frame entered by a core command (warehouse/core-command.ts) for a request: admission
 * also checks the requester's access generation, so a policy change committed after the command
 * authorized it in the request makes the command authorize again.
 */
export type SystemFrame = { kind: 'system'; reason: string; requester?: CommandRequester }

/** A core command's requester: its holder, and the access generation its authorization checked. */
export interface CommandRequester {
  holder: RequestHolder
  /** `Access.revision` of the access object `authorize` ran against (unchanged through it). */
  authorizedRevision: number
}

export type ContextFrame =
  | { kind: 'request'; holder: RequestHolder }
  | SystemFrame
  | { kind: 'bootstrap' }
  | { kind: 'detached' }

/** What the current code may act as. */
export type ContextScope =
  | { kind: 'principal'; principal: Principal; access: Access; credential?: PrincipalCredential; handler?: string }
  | SystemFrame
  | { kind: 'bootstrap' }
  | { kind: 'none' }

// One storage per process even if this module is loaded twice (source and build paths in tests).
const KEY = Symbol.for('silkweave.box.request-context')
const store: AsyncLocalStorage<ContextFrame> =
  ((globalThis as Record<symbol, unknown>)[KEY] as AsyncLocalStorage<ContextFrame> | undefined) ??
  ((globalThis as Record<symbol, unknown>)[KEY] = new AsyncLocalStorage<ContextFrame>())

/** The process-wide context store (request-context.ts runs frames in it). */
export function contextStore(): AsyncLocalStorage<ContextFrame> {
  return store
}

/** The current frame's scope. An unfilled holder is `none`. */
export function currentScope(): ContextScope {
  const frame = store.getStore()
  if (!frame) return framelessScope()
  if (frame.kind === 'detached') return { kind: 'none' }
  if (frame.kind === 'system') return frame
  if (frame.kind === 'bootstrap') return frame
  const { principal, access, credential, handler } = frame.holder
  if (!principal || !access) return { kind: 'none' }
  return { kind: 'principal', principal, access, ...(credential ? { credential } : {}), ...(handler ? { handler } : {}) }
}

