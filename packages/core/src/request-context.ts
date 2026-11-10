// Who the current code runs for (docs/AUTH.md "Request context"). One AsyncLocalStorage carries a
// frame through every await of a request, an action call, a stream or a background job:
//
// - `request`: a holder created EMPTY by the transport (the first Express middleware for REST and
//   raw mounts; one per action call for tRPC HTTP, tRPC WebSocket and MCP) and filled by AuthGuard.
//   A guard cannot create the frame itself: a store entered inside an awaited guard is lost when
//   the guard returns, so the transport opens it and the guard writes into it.
// - `system`: boot, migrations, CLI maintenance, cron, derivations and job runners, entered
//   explicitly with `asSystem(reason, fn)`. Few, named and reviewed: system code reads anything.
// - `bootstrap`: authentication and role lookup, before a request is authorized. The data guard
//   admits only the auth tables in it.
//
// No frame, or an unfilled holder, DENIES access to area-owned data. Nothing here falls back to
// system authority.

import { AreaAccessError, levelCovers, levelOf, type AccessLevel } from './auth/access.js'
import { ADMIN_AREA } from './auth/levels.js'
import type { Principal } from './auth/principal.js'
import { contextStore, currentScope, type ContextFrame, type RequestHolder } from './context-store.js'

export { currentScope, type ContextFrame, type ContextScope, type RequestHolder } from './context-store.js'

const store = contextStore()

/** Run `fn` in a fresh, empty request holder (a transport's job, not a handler's). */
export function runInRequest<T>(fn: () => T): T {
  return store.run({ kind: 'request', holder: {} }, fn)
}

/** A fresh, empty request frame, for a transport that binds it to a stream (`bindStream`). */
export function freshRequestFrame(): ContextFrame {
  return { kind: 'request', holder: {} }
}

/** The innermost request holder, or null outside one. AuthGuard fills it. */
export function requestHolder(): RequestHolder | null {
  const frame = store.getStore()
  return frame?.kind === 'request' ? frame.holder : null
}

/** Fill the current request holder. Returns false when there is none (a transport that opened no frame). */
export function fillRequest(fill: Required<Pick<RequestHolder, 'principal' | 'access'>> & Omit<RequestHolder, 'principal' | 'access'>): boolean {
  const holder = requestHolder()
  if (!holder) return false
  Object.assign(holder, fill)
  return true
}

/** Aborts when the caller of the current live stream is gone; undefined outside a stream or on a
 *  transport that cannot tell. */
export function requestClosed(): AbortSignal | undefined {
  return requestHolder()?.closed
}

/** The principal the current request acts for, or null (system, bootstrap, none). */
export function currentPrincipal(): Principal | null {
  const scope = currentScope()
  return scope.kind === 'principal' ? scope.principal : null
}

/**
 * Run `fn` with system authority. For boot, migrations, CLI maintenance, cron, derivations after
 * an authorized write, and job runners; never around a handler. `reason` names the entry point.
 */
export function asSystem<T>(reason: string, fn: () => T): T {
  if (!reason) throw new Error('asSystem needs a reason')
  return store.run({ kind: 'system', reason }, fn)
}

/** Run `fn` in the bootstrap scope: authentication and role lookup only. */
export function asBootstrap<T>(fn: () => T): T {
  return store.run({ kind: 'bootstrap' }, fn)
}

/** Run `fn` with no frame at all (tests forcing a missing context; detaching from a caller). */
export function withoutContext<T>(fn: () => T): T {
  return store.run({ kind: 'detached' }, fn)
}

/**
 * Whether the current scope may reach `area` at `level`. System may; bootstrap and none may not;
 * a principal by its access.
 */
export function canAccess(area: string, level: AccessLevel): boolean {
  const scope = currentScope()
  if (scope.kind === 'system') return true
  if (scope.kind !== 'principal') return false
  return levelCovers(levelOf(scope.access, area), level)
}

/** Refuse unless the current scope may reach `area` at `level` (403 `area_access`). */
export function requireAccess(area: string, level: AccessLevel): void {
  if (!canAccess(area, level)) throw new AreaAccessError(area, level)
}

/**
 * Whether the current scope may reach a row stored under owning area `area` at `level`
 * (PERMISSIONS 8.3): the pseudo-area `admin` needs admin authority (a role's fallback level never
 * reaches it); every other area as canAccess.
 */
export function canReachArea(area: string, level: AccessLevel): boolean {
  return area === ADMIN_AREA ? hasAdminAuthority() : canAccess(area, level)
}

/** Whether every area in `areas` is reachable at `level` (an event, a formula's closure). */
export function canReachAreas(areas: readonly string[], level: AccessLevel): boolean {
  return areas.length > 0 && areas.every((a) => canReachArea(a, level))
}

/** Refuse unless `area` is reachable at `level` (403 `area_access`). */
export function requireReachArea(area: string, level: AccessLevel): void {
  if (!canReachArea(area, level)) throw new AreaAccessError(area, level)
}

/** Whether the current scope has admin authority (system does; bootstrap and none do not). */
export function hasAdminAuthority(): boolean {
  const scope = currentScope()
  if (scope.kind === 'system') return true
  return scope.kind === 'principal' && scope.access.admin
}

/** The current frame, to carry into code that runs later (a callback, a stream's next()). */
export function captureFrame(): ContextFrame | undefined {
  return store.getStore()
}

/** Run `fn` in a captured frame (or with none when the capture had none). */
export function runInFrame<T>(frame: ContextFrame | undefined, fn: () => T): T {
  return frame ? store.run(frame, fn) : store.exit(fn)
}

/**
 * Drive `source` so every step (create, next, return, throw) runs in `frame`. A generator body
 * runs in the context of whoever calls `next()`, and transports call it from their own context (a
 * WebSocket message, a timer); this rebinds each step to the request it serves. Event callbacks
 * inside the body still run in the emitter's context, so a stream authorizes its frames in the
 * body, never in a callback.
 */
export async function* bindStream<T>(frame: ContextFrame | undefined, source: () => AsyncIterable<T> | AsyncIterator<T>): AsyncGenerator<T, void, undefined> {
  const iterable = runInFrame(frame, source)
  const iterator: AsyncIterator<T> = Symbol.asyncIterator in iterable ? runInFrame(frame, () => (iterable as AsyncIterable<T>)[Symbol.asyncIterator]()) : (iterable as AsyncIterator<T>)
  let finished = false
  try {
    for (;;) {
      const step = await runInFrame(frame, () => iterator.next())
      if (step.done) {
        finished = true
        return
      }
      yield step.value
    }
  } finally {
    if (!finished && iterator.return) await runInFrame(frame, () => iterator.return!())
  }
}
