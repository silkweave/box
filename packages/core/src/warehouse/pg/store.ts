// The warehouse API on the executor (PHASE1.md choice 5).
//
//   withRead(sql, params)  one statement in a read-only transaction
//   withReadOnly(fn)       several statements in one read-only transaction (one admission, read
//                          committed): fn(tx) reads with tx.query
//   withSnapshot(fn)       the same with one snapshot for every statement (repeatable read)
//   withWrite(fn)          a real transaction: fn(tx) with tx.query / tx.run; nesting on the same
//                          login reuses it, nesting on another login is refused (executor.ts)
//
// The login is the current context's (executor.ts contextFor); `reach: 'core'` is for core
// accessors on shared tables. Placeholders are `$n`. A real transaction is necessary but not
// sufficient: read-then-insert paths use a unique constraint with a conflict-aware write, or lock
// a stable parent row, or run serializable with a bounded retry; existing rows use FOR UPDATE.

import { executor, type Reach, type Statement, type TransactionOptions, type Tx } from '../executor.js'

export type { Tx } from '../executor.js'

export interface ReadOptions { reach?: Reach; timeoutMs?: number; efSearch?: number }

/** Rows of one statement, in a read-only transaction (or the open transaction when nested). */
export function withRead<T = Record<string, unknown>>(sql: Statement, params?: readonly unknown[], opts: ReadOptions = {}): Promise<T[]> {
  return executor().transaction((tx) => tx.query<T>(sql, params), { ...opts, readOnly: true })
}

/**
 * Run `fn` in one read-only transaction: several reads, one admission round trip. Read committed:
 * each statement sees what was committed when it started. Use `withSnapshot` when the reads must
 * agree with each other.
 */
export function withReadOnly<T>(fn: (tx: Tx) => Promise<T>, opts: ReadOptions = {}): Promise<T> {
  return executor().transaction(fn, { ...opts, readOnly: true })
}

/**
 * Run `fn` in one read-only repeatable read transaction: every read sees the same snapshot, taken
 * at its first statement. Nested inside a read committed transaction it refuses (ISOLATION).
 */
export function withSnapshot<T>(fn: (tx: Tx) => Promise<T>, opts: ReadOptions = {}): Promise<T> {
  return executor().transaction(fn, { ...opts, readOnly: true, isolation: 'repeatable read' })
}

/** Run `fn` in one transaction; it commits when `fn` resolves and rolls back when it throws. */
export function withWrite<T>(fn: (tx: Tx) => Promise<T>, opts: Omit<TransactionOptions, 'readOnly'> = {}): Promise<T> {
  return executor().transaction(fn, opts)
}

/** Serializable read-modify-write with a bounded retry on serialization failures and deadlocks.
 *  `fn` must have no side effects outside the database: it may run more than once. */
export async function withSerializable<T>(fn: (tx: Tx) => Promise<T>, opts: Omit<TransactionOptions, 'readOnly'> & { attempts?: number } = {}): Promise<T> {
  const attempts = opts.attempts ?? 3
  for (let i = 1; ; i++) {
    try {
      return await executor().transaction(fn, { ...opts, isolation: 'serializable' })
    } catch (e) {
      const code = (e as { code?: string }).code
      if (i >= attempts || (code !== '40001' && code !== '40P01')) throw e
      await new Promise((r) => setTimeout(r, 10 * i + Math.random() * 20))
    }
  }
}
