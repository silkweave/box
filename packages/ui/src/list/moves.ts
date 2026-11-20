// Moves the host is still writing, drawn as done.
//
// A move shows the moment it is made. The host gets moves ONE AT A TIME: the next is handed over
// only when the previous one has settled, and it is resolved then, against the rows as they are by
// that time. So quick moves in succession never race (two writes in flight, each carrying an order
// computed from a stale snapshot, the older landing last) and the host never writes an order that
// undoes a move it has just stored.
//
// Until a move settles it is applied on top of whatever `rows` currently is, by intent (row, new
// parent, the sibling it follows) rather than by a stored order, so it rebases on fresh data: a
// refetch, another user's change, an earlier move landing. The preview and the write resolve an
// intent the same way (`resolveIntent`): a move whose row or parent went away, that would put a row
// under itself, or that the rules no longer allow is dropped from the preview and never written; the
// host hears about it through its error callback as a `MoveConflict`.

import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { childrenByParent, orderAfterMove, type TreeAccess } from './tree.ts'

export interface MoveIntent {
  id: string
  parentId: string | null
  /** The sibling it follows; null = first among its siblings. */
  afterId: string | null
}

export interface Move extends MoveIntent {
  /** Every row id in depth-first order after the move, for a host that stores one order. */
  order: string[]
}

/** A queued move that no longer fits the rows by the time it was due. */
export class MoveConflict extends Error {
  constructor(readonly intent: MoveIntent) {
    super('The move no longer fits the rows')
    this.name = 'MoveConflict'
  }
}

/** Whether a resolved intent is allowed (depth limits, nesting rules); checked on every resolve. */
export type MoveCheck<T> = (intent: MoveIntent, rows: readonly T[], at: TreeAccess<T>) => boolean

/**
 * `intent` as it applies to `rows` now, or null when it no longer can: the row or its new parent is
 * gone, the parent is the row itself or under it, or `check` refuses it. A sibling to follow that is
 * gone or no longer a sibling reads as "first among its siblings".
 */
export function resolveIntent<T>(rows: readonly T[], at: TreeAccess<T>, intent: MoveIntent, check?: MoveCheck<T>): MoveIntent | null {
  const byId = new Map(rows.map((r) => [at.id(r), r]))
  if (!byId.has(intent.id)) return null
  if (intent.parentId !== null) {
    if (!byId.has(intent.parentId)) return null
    // Walk up from the new parent: meeting the row means it would sit under itself.
    const seen = new Set<string>()
    for (let p: string | null = intent.parentId; p !== null && !seen.has(p); ) {
      if (p === intent.id) return null
      seen.add(p)
      const row = byId.get(p)
      p = row === undefined ? null : at.parentId(row)
    }
  }
  const siblings = childrenByParent(rows, at).get(intent.parentId ?? '') ?? []
  const afterId = intent.afterId !== null && intent.afterId !== intent.id && siblings.some((r) => at.id(r) === intent.afterId) ? intent.afterId : null
  const resolved = { id: intent.id, parentId: intent.parentId, afterId }
  return !check || check(resolved, rows, at) ? resolved : null
}

/** `rows` with `intent` applied (resolve it first), and the tree access that reads the new parent. */
export function applyIntent<T>(rows: readonly T[], at: TreeAccess<T>, intent: MoveIntent): { rows: readonly T[]; at: TreeAccess<T> } {
  const byId = new Map(rows.map((r) => [at.id(r), r]))
  const order = orderAfterMove(rows, at, intent.id, intent.parentId, intent.afterId)
  return {
    rows: order.flatMap((id) => byId.get(id) ?? []),
    at: { id: at.id, parentId: (r) => (at.id(r) === intent.id ? intent.parentId : at.parentId(r)) },
  }
}

/** `rows` with every intent that still resolves applied in turn. */
export function applyIntents<T>(rows: readonly T[], at: TreeAccess<T>, intents: readonly MoveIntent[], check?: MoveCheck<T>): { rows: readonly T[]; at: TreeAccess<T> } {
  let out = { rows, at }
  for (const intent of intents) {
    const resolved = resolveIntent(out.rows, out.at, intent, check)
    if (resolved) out = applyIntent(out.rows, out.at, resolved)
  }
  return out
}

/** Hands one intent to the host; returns what the host returned, or throws. */
export type MoveDispatch = (intent: MoveIntent) => unknown

/**
 * The queue itself, framework-free: intents in arrival order, at most one dispatched at a time.
 * `dispatch` is read when a move is due, so it always sees the host's latest rows. A dispatch that
 * throws, rejects or refuses (`MoveConflict`) settles like any other, and the queue moves on.
 */
export class MoveQueue {
  private items: readonly MoveIntent[] = []
  private busy = false
  private listeners = new Set<() => void>()
  dispatch: MoveDispatch = () => undefined
  onError: (intent: MoveIntent, error: unknown) => void = () => undefined

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly snapshot = (): readonly MoveIntent[] => this.items

  enqueue(intent: MoveIntent): void {
    this.set([...this.items, intent])
    this.pump()
  }

  private set(items: readonly MoveIntent[]): void {
    this.items = items
    for (const listener of this.listeners) listener()
  }

  private pump(): void {
    const head = this.items[0]
    if (this.busy || !head) return
    this.busy = true
    const settle = (): void => {
      this.busy = false
      this.set(this.items.filter((i) => i !== head))
      this.pump()
    }
    new Promise((resolve) => resolve(this.dispatch(head))).then(settle, (error: unknown) => {
      this.onError(head, error)
      settle()
    })
  }
}

export interface MoveQueueOptions<T> {
  rows: readonly T[]
  at: TreeAccess<T>
  check?: MoveCheck<T>
  /** Writes a move; settles (resolves, or rejects) once `rows` reflects it or the write failed. */
  write?: (move: Move) => void | Promise<unknown>
  onError?: (intent: MoveIntent, error: unknown) => void
}

/** The move queue for one grid: the rows with every unsettled move applied, and `enqueue`. */
export function useMoveQueue<T>({ rows, at, check, write, onError }: MoveQueueOptions<T>) {
  const [queue] = useState(() => new MoveQueue())
  const intents = useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot)

  // The queue reads these when a move is due, so they are always the latest render's.
  useLayoutEffect(() => {
    queue.dispatch = (intent) => {
      const resolved = resolveIntent(rows, at, intent, check)
      if (!resolved) throw new MoveConflict(intent)
      return write?.({ ...resolved, order: orderAfterMove(rows, at, resolved.id, resolved.parentId, resolved.afterId) })
    }
    queue.onError = (intent, error) => onError?.(intent, error)
  })

  const applied = applyIntents(rows, at, intents, check)
  return {
    /** The rows with every unsettled move applied. */
    rows: applied.rows,
    /** Tree access that reads the applied parents. */
    at: applied.at,
    /** Moves made and not yet settled. */
    pending: intents.length,
    enqueue: (intent: MoveIntent): void => queue.enqueue(intent),
  }
}
