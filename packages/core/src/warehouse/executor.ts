// The executor: the one way runtime code reaches the database (PERMISSIONS.md 11.6 to 11.8).
//
// - The login comes from the current context (request-context.ts), never from the caller:
//   a principal's work runs on its role's login (`box_role_<n>`), core accessors on `box_core`,
//   system work on `box_system`, bootstrap (authentication) on `box_core` for core accessors only.
//   No context, no connection.
// - Every statement runs in a transaction. Nesting on the same login reuses the open transaction
//   (no second BEGIN, no second client); nesting on another login is refused.
// - Feature SQL is one parameterized statement on the extended protocol, and must start with a
//   data statement (the classifier); transaction control and settings belong to the executor.
// - The executor sets the transaction context with SET LOCAL and driver-escaped literals.
// - Pools: one lazy pool per login inside one global budget, with reserved capacity for core
//   (authentication, core accessors). On release: rollback (unless committed), DISCARD ALL, the driver's statement
//   cache cleared; a connection whose reset fails is destroyed. The budget bounds OPEN connections,
//   idle and closing ones included: at the limit an acquire closes an idle connection of another
//   login and waits until a close has completed.
// - Work queued with `afterCommit` runs after the outermost transaction commits (right after the
//   COMMIT, before the connection is released, so hooks run in commit order); a rollback drops it.

import { ADMIN_AREA } from '../auth/levels.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import pg from 'pg'
import { currentScope, type ContextScope } from '../context-store.js'
import { policyGeneration, policySnapshot, publishPolicySnapshot } from './policy-snapshot.js'

// ---- Classifier ----

// MERGE is not admitted: nothing uses it and its row-security behaviour is not qualified (W8).
const ALLOWED = new Set(['select', 'insert', 'update', 'delete', 'with', 'values', 'table'])

/** Null when `sql` may run as feature SQL; otherwise the reason it may not. */
export function classify(sql: string): string | null {
  let s = sql
  for (;;) {
    const t = s.replace(/^\s+/, '')
    if (t.startsWith('--')) { const i = t.indexOf('\n'); s = i < 0 ? '' : t.slice(i + 1); continue }
    if (t.startsWith('/*')) { const i = t.indexOf('*/'); if (i < 0) return 'unterminated comment'; s = t.slice(i + 2); continue }
    if (t.startsWith('(')) { s = t.slice(1); continue }
    s = t
    break
  }
  const kw = /^[a-z_]+/i.exec(s)?.[0].toLowerCase() ?? ''
  // A WITH can end in MERGE (PostgreSQL 17+): refuse the form wherever it appears.
  if (/\bmerge\s+into\b/i.test(s)) return 'MERGE is not allowed here'
  return ALLOWED.has(kw) ? null : `statement "${kw || s.slice(0, 20)}" is not allowed here: only SELECT, INSERT, UPDATE, DELETE, WITH, VALUES and TABLE`
}

// ---- Errors ----

export type ExecutorErrorCode = 'NO_CONTEXT' | 'NO_LOGIN' | 'NESTED_LOGIN' | 'READ_ONLY' | 'CLASSIFIED' | 'BUDGET' | 'NOT_CONFIGURED' | 'ISOLATION' | 'POLICY_STALE' | 'NO_POLICY' | 'NO_PRINCIPAL' | 'REAUTHORIZE'

export class ExecutorError extends Error {
  constructor(readonly code: ExecutorErrorCode, message: string) { super(message) }
}

// ---- Value shapes ----

/** `2026-11-06 05:00:01.123456+00` (UTC session) -> `2026-11-06T05:00:01.123456Z`, precision kept. */
export function isoFromTimestamptz(text: string): string {
  const m = /^(\d{4,}-\d\d-\d\d) (\d\d:\d\d:\d\d(?:\.\d+)?)\+00(?::00)?$/.exec(text)
  if (!m) throw new Error(`unexpected timestamptz text "${text}" (is the session time zone UTC?)`)
  return `${m[1]}T${m[2]}Z`
}

/** `int8` as a number when it is exactly representable, otherwise an error at the boundary. */
export function safeInt8(text: string): number {
  const n = Number(text)
  if (!Number.isSafeInteger(n)) throw new Error(`bigint ${text} is outside the safe integer range; read it as text`)
  return n
}

const TYPE_OIDS = { int8: 20, timestamptz: 1184, timestamp: 1114, date: 1082, numeric: 1700 } as const

/** Type parsers for every executor client: strings for times and dates, safe numbers for int8. */
export const BOX_TYPES: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: string) => {
    if (format === 'binary') return pg.types.getTypeParser(oid as never, 'binary' as never)
    switch (oid) {
      case TYPE_OIDS.int8: return safeInt8
      case TYPE_OIDS.timestamptz: return isoFromTimestamptz
      // Not instants: their text as stored.
      case TYPE_OIDS.timestamp: case TYPE_OIDS.date: case TYPE_OIDS.numeric: return (v: string) => v
      default: return pg.types.getTypeParser(oid as never, 'text')
    }
  }) as pg.CustomTypesConfig['getTypeParser'],
}

// ---- Logins ----

export const CORE_LOGIN = 'box_core'
export const SYSTEM_LOGIN = 'box_system'
export type Reach = 'area' | 'core'

/** Role id -> its login: the published policy snapshot's routing (policy-snapshot.ts). */
function roleLogins(): ReadonlyMap<string, string> {
  return policySnapshot()?.logins ?? new Map()
}

/** Tests that exercise routing alone: republish the current snapshot with `map` as its routing. */
export function setRoleLoginsForTests(map: ReadonlyMap<string, string>): void {
  const snap = policySnapshot()
  publishPolicySnapshot({ generation: snap?.generation ?? 0, roles: snap?.roles ?? new Map(), logins: map }, { reset: true })
}

/** Every area a role level can name (features plus core areas), for expanding a role's fallback. */
let knownAreaList: readonly string[] = []
export function setKnownAreas(areas: readonly string[]): void { knownAreaList = [...areas] }

export interface TxContext {
  login: string
  principal: string
  readAreas: string[]
  writeAreas: string[]
  revision: number
}

/** The login and context the current scope runs `reach` work on; refuses when there is none. */
export function contextFor(scope: ContextScope, reach: Reach): TxContext {
  switch (scope.kind) {
    case 'none':
      throw new ExecutorError('NO_CONTEXT', 'database access without a request, system or bootstrap context')
    case 'system':
      return { login: SYSTEM_LOGIN, principal: `system:${scope.reason}`, readAreas: [], writeAreas: [], revision: 0 }
    case 'bootstrap':
      if (reach !== 'core') throw new ExecutorError('NO_LOGIN', 'bootstrap context reaches core accessors only')
      return { login: CORE_LOGIN, principal: 'bootstrap', readAreas: [], writeAreas: [], revision: 0 }
    case 'principal': {
      const { principal, access } = scope
      const readAreas: string[] = [], writeAreas: string[] = []
      const areas = new Set([...knownAreaList, ...access.areas.keys()])
      for (const area of [...areas].sort()) {
        const level = access.areas.get(area) ?? access.fallback
        if (level === 'read' || level === 'write') readAreas.push(area)
        if (level === 'write') writeAreas.push(area)
      }
      // Admin authority reaches rows nothing classifies (PERMISSIONS 8.3; row security, rls.ts).
      if (access.admin) { readAreas.push(ADMIN_AREA); writeAreas.push(ADMIN_AREA) }
      if (reach === 'core') return { login: CORE_LOGIN, principal: principal.id, readAreas, writeAreas, revision: access.revision }
      const login = roleLogins().get(access.role)
      if (!login) throw new ExecutorError('NO_LOGIN', `role "${access.role}" has no database login (policy not reconciled)`)
      return { login, principal: principal.id, readAreas, writeAreas, revision: access.revision }
    }
  }
}

// ---- Budget ----

export class Budget {
  inUse = 0
  private waiting: { resolve: () => void; reject: (e: Error) => void; reserved: boolean }[] = []
  constructor(readonly total: number, readonly reserved: number, readonly maxWaiting: number) {}

  async take(reserved: boolean): Promise<void> {
    if (this.inUse < this.cap(reserved)) { this.inUse++; return }
    if (this.waiting.length >= this.maxWaiting) throw new ExecutorError('BUDGET', 'database connection budget exhausted')
    // The slot is handed over in give() (counted there), so no caller can take it in between.
    await new Promise<void>((resolve, reject) => this.waiting.push({ resolve, reject, reserved }))
  }

  give(): void {
    this.inUse--
    const i = this.waiting.findIndex((w) => this.inUse < this.cap(w.reserved))
    if (i >= 0) { this.inUse++; this.waiting.splice(i, 1)[0]!.resolve() }
  }

  private cap(reserved: boolean): number { return reserved ? this.total : this.total - this.reserved }
}

// ---- Transactions ----

/** Feature SQL: text, or text with a statement name (a prepared statement reused per connection). */
export type Statement = string | { text: string; name?: string }

export interface Tx {
  /** Rows of one feature-SQL statement. */
  query<T = Record<string, unknown>>(sql: Statement, params?: readonly unknown[]): Promise<T[]>
  /** One feature-SQL statement; the number of rows it affected. */
  run(sql: Statement, params?: readonly unknown[]): Promise<number>
  /** One feature-SQL statement; its rows, affected-row count and command tag (the Kysely driver, kysely.ts). */
  exec<T = Record<string, unknown>>(sql: Statement, params?: readonly unknown[]): Promise<ExecResult<T>>
}

export interface ExecResult<T> { rows: T[]; rowCount: number; command: string }

interface OpenTx {
  login: string
  readOnly: boolean
  serializable: boolean
  /** One snapshot for the whole transaction (repeatable read or serializable). */
  snapshot: boolean
  client: pg.Client
  after: (() => void)[]
  tx: Tx
}

const current = new AsyncLocalStorage<OpenTx>()

export interface ExecutorTarget { host: string; port: number; database: string }

export interface TransactionOptions {
  readOnly?: boolean
  timeoutMs?: number
  /** `core` for core accessors (box_core); `area` (default) for feature SQL on the role's login. */
  reach?: Reach
  /** Executor-owned search setting (`hnsw.ef_search`), validated. */
  efSearch?: number
  /**
   * `serializable` for read-modify-write paths that retry (store.ts withSerializable);
   * `repeatable read` for several reads that must see one snapshot (store.ts withSnapshot).
   */
  isolation?: 'read committed' | 'repeatable read' | 'serializable'
}

// ---- Admission against the committed policy (PERMISSIONS 11.10; BOX-Review W8 P findings 1, 2) ----
// Every outer transaction reads core.policy_state.revision in its context round trip. The work is
// stale when that revision is newer than the published snapshot (routing, definitions) or, for a
// principal, newer than the generation its frame's access was resolved at (Access.revision): a
// policy change committed after the frame was filled, here or in another process. A stale
// transaction is abandoned before any work; the policy service publishes the committed snapshot and
// re-resolves the frame's identity and access (pg/boot.ts), and the work is admitted again on the
// fresh context, once, then refused. A route that fails before the probe because the policy moved
// (no login for the frame's role, a retired login, CONNECT revoked) is stale the same way. A
// missing policy row refuses: the policy is unknown.

let policyRefresh: ((observed: number) => Promise<void>) | null = null

/** Installed by the policy service (pg/boot.ts); without one admission does not check. */
export function setPolicyRefresh(fn: ((observed: number) => Promise<void>) | null): void {
  policyRefresh = fn
}

let afterAdmissionForTests: (() => Promise<void>) | null = null

/** Tests: run `fn` after an admitted transaction's revision probe, before its work (null clears). */
export function setAfterAdmissionForTests(fn: (() => Promise<void>) | null): void {
  afterAdmissionForTests = fn
}

class StalePolicy extends Error {
  /** The committed revision the probe saw (0: unknown, the route failed first); the route error. */
  constructor(readonly observed: number, readonly route?: unknown) { super('stale policy') }
}

/** Connection refusals that mean the routing is older than the database's logins. */
const STALE_ROUTE_CODES = new Set(['28000', '42501'])

export class Executor {
  private idle = new Map<string, pg.Client[]>()
  /** Connections this executor holds open: busy, idle and still closing. */
  private open = 0
  /** Acquires waiting for a connection to finish closing. */
  private capacityWaiters: Array<() => void> = []
  private retired = new Set<string>()
  private closed = false

  constructor(readonly target: ExecutorTarget, readonly budget: Budget, private readonly reservedLogins = new Set([CORE_LOGIN])) {}

  /** Run `fn` in a transaction on the current context's login. */
  async transaction<T>(fn: (tx: Tx) => Promise<T>, opts: TransactionOptions = {}): Promise<T> {
    // Admission checks the process executor, the one the policy service governs; a free-standing
    // Executor (tests on their own databases) does not.
    if (current.getStore() || !policyRefresh || this !== instance) return this.admitted(fn, opts, false)
    try {
      return await this.admitted(fn, opts, true)
    } catch (e) {
      if (!(e instanceof StalePolicy)) throw e
      await policyRefresh(e.observed)
      // A core command's system work for a requester: the requester's access was re-resolved; its
      // authorization has to run again before any privileged statement (core-command.ts).
      const scope = currentScope()
      if (scope.kind === 'system' && scope.requester) throw new ExecutorError('REAUTHORIZE', 'the access policy changed after this command was authorized')
      try {
        return await this.admitted(fn, opts, true)
      } catch (again) {
        if (again instanceof StalePolicy) {
          // Keep the route's own error: a real HBA or ACL fault must not read as policy churn only.
          const cause = again.route instanceof Error ? `: ${again.route.message}` : ''
          throw new ExecutorError('POLICY_STALE', `the access policy changed while this work was admitted; try again${cause}`)
        }
        throw again
      }
    }
  }

  private async admitted<T>(fn: (tx: Tx) => Promise<T>, opts: TransactionOptions, check: boolean): Promise<T> {
    const scope = currentScope()
    const roleRoute = scope.kind === 'principal' && (opts.reach ?? 'area') === 'area'
    let ctx: TxContext
    try {
      ctx = contextFor(scope, opts.reach ?? 'area')
    } catch (e) {
      // No login for the frame's role: the routing or the frame may predate a policy commit.
      if (check && roleRoute && e instanceof ExecutorError && e.code === 'NO_LOGIN') throw new StalePolicy(0, e)
      throw e
    }
    const outer = current.getStore()
    if (outer) {
      if (outer.login !== ctx.login) throw new ExecutorError('NESTED_LOGIN', `a ${ctx.login} transaction cannot open inside a ${outer.login} transaction`)
      if (outer.readOnly && !opts.readOnly) throw new ExecutorError('READ_ONLY', 'a write cannot run inside a read-only transaction')
      if (opts.isolation === 'serializable' && !outer.serializable) throw new ExecutorError('ISOLATION', 'a serializable transaction cannot open inside a read committed one')
      if (opts.isolation === 'repeatable read' && !outer.snapshot) throw new ExecutorError('ISOLATION', 'a repeatable read transaction cannot open inside a read committed one')
      return fn(outer.tx)
    }
    let client: pg.Client
    try {
      client = await this.acquire(ctx.login)
    } catch (e) {
      // A retired login, or one whose CONNECT went or that was dropped: the policy moved.
      const code = (e as { code?: unknown }).code
      if (check && roleRoute && ((e instanceof ExecutorError && e.code === 'NO_LOGIN') || (typeof code === 'string' && STALE_ROUTE_CODES.has(code)))) throw new StalePolicy(0, e)
      throw e
    }
    let ok = false
    const serializable = opts.isolation === 'serializable'
    const repeatable = opts.isolation === 'repeatable read'
    const open: OpenTx = { login: ctx.login, readOnly: !!opts.readOnly, serializable, snapshot: serializable || repeatable, client, after: [], tx: txOn(client) }
    try {
      await client.query(`begin${serializable ? ' isolation level serializable' : repeatable ? ' isolation level repeatable read' : ''}${opts.readOnly ? ' read only' : ''}`)
      const context = await client.query(contextSql(client, ctx, opts) + (check ? '; select revision from core.policy_state where id = 1' : ''))
      if (check) {
        const results = context as unknown as pg.QueryResult<{ revision: string }>[]
        const row = results[results.length - 1]?.rows[0]
        if (!row) throw new ExecutorError('NO_POLICY', 'core.policy_state has no row: the access policy is unknown')
        const revision = Number(row.revision)
        if (revision > policyGeneration() || (scope.kind === 'principal' && revision > scope.access.revision)) throw new StalePolicy(revision)
        // A core command's requester: the generation its authorization checked must be as new as
        // the committed policy (not the holder's latest access, which a read during authorize may
        // have refreshed after the check).
        if (scope.kind === 'system' && scope.requester && revision > scope.requester.authorizedRevision) throw new StalePolicy(revision)
        if (afterAdmissionForTests) await afterAdmissionForTests()
      }
      const result = await current.run(open, () => fn(open.tx))
      await client.query('commit')
      ok = true
      // Before the release round trip, in the commit's own continuation: transactions that
      // serialize on a row (chat's outbox counter) then publish in commit order.
      for (const f of open.after) { try { f() } catch (e) { console.error('[executor] afterCommit hook failed:', e) } }
      return result
    } finally {
      await this.release(ctx.login, client, ok)
    }
  }

  /** Stop using logins the policy service retired: idle sessions end now, busy ones on release.
   *  Call after the routing table no longer names them. A login provisioned again is usable again. */
  async retireLogins(logins: Iterable<string>): Promise<void> {
    for (const login of logins) {
      this.retired.add(login)
      // Detached first: a concurrent retire of the same login must not end these twice.
      const list = this.idle.get(login) ?? []
      this.idle.delete(login)
      for (const c of list) await this.drop(c)
    }
  }

  async close(): Promise<void> {
    this.closed = true
    const lists = [...this.idle.values()]
    this.idle.clear()
    for (const list of lists) for (const c of list) await this.drop(c)
  }

  /** How many connections are open (tests: the budget bounds this, idle pools included). */
  openConnections(): number { return this.open }

  /** Close `c`; it counts against the budget until the close has completed. */
  private drop(c: pg.Client): Promise<void> {
    return c.end().catch(() => {}).finally(() => {
      this.open--
      this.capacityWaiters.shift()?.()
    })
  }

  /** Start closing one idle connection, from the login holding the most idle ones. */
  private evictIdle(): void {
    let pick: string | undefined
    for (const [login, list] of this.idle) if (list.length && (!pick || list.length > this.idle.get(pick)!.length)) pick = login
    const c = pick ? this.idle.get(pick)!.shift() : undefined
    if (c) void this.drop(c)
  }

  private async acquire(login: string): Promise<pg.Client> {
    if (this.closed) throw new ExecutorError('NOT_CONFIGURED', 'the executor is closed')
    if (this.retired.has(login)) {
      if (![...roleLogins().values()].includes(login)) throw new ExecutorError('NO_LOGIN', `login ${login} was retired`)
      this.retired.delete(login)
    }
    await this.budget.take(this.reservedLogins.has(login))
    const pooled = this.idle.get(login)?.pop()
    if (pooled) return pooled
    // At the limit, some connection is idle or closing: this caller holds a budget slot but no
    // connection, so busy ones are fewer than the total. Close an idle one and wait for a close to
    // complete; re-check, since a newcomer may have taken the freed place first.
    while (this.open >= this.budget.total) {
      this.evictIdle()
      await new Promise<void>((resolve) => this.capacityWaiters.push(resolve))
    }
    this.open++
    try {
      const c = new pg.Client({ host: this.target.host, port: this.target.port, user: login, database: this.target.database, types: BOX_TYPES })
      c.on('error', () => { /* a dead connection fails its next query and is destroyed on release */ })
      await c.connect()
      return c
    } catch (e) { this.open--; this.budget.give(); throw e }
  }

  /** `committed`: the commit went through, so no transaction is open and a rollback would only log a warning. */
  private async release(login: string, c: pg.Client, committed: boolean): Promise<void> {
    try {
      if (!committed) await c.query('rollback')
      await c.query('discard all')
      clearStatementCache(c)
      if (this.closed || this.retired.has(login)) await this.drop(c)
      else this.idle.set(login, [...(this.idle.get(login) ?? []), c])
    } catch {
      void this.drop(c)
    } finally { this.budget.give() }
  }
}

/** Queue `fn` to run after the current outermost transaction commits; runs now outside one. */
export function afterCommit(fn: () => void): void {
  const open = current.getStore()
  if (open) open.after.push(fn)
  else fn()
}

/** Whether code is running inside an executor transaction. */
export function inTransaction(): boolean { return current.getStore() !== undefined }

/** The open transaction's statement runner, if code is running inside one (the Kysely driver). */
export function openTx(): Tx | undefined { return current.getStore()?.tx }

function contextSql(c: pg.Client, ctx: TxContext, opts: TransactionOptions): string {
  const lit = (v: string) => c.escapeLiteral(v)
  const timeout = Math.trunc(opts.timeoutMs ?? 10_000)
  if (!(timeout > 0 && timeout <= 600_000)) throw new Error(`invalid timeout ${opts.timeoutMs}`)
  const parts = [
    `set local statement_timeout = ${timeout}`,
    `set local timezone = 'UTC'`,
    `set local box.principal = ${lit(ctx.principal)}`,
    `set local box.read_areas = ${lit(ctx.readAreas.join(','))}`,
    `set local box.write_areas = ${lit(ctx.writeAreas.join(','))}`,
    `set local box.revision = ${lit(String(ctx.revision))}`,
  ]
  if (opts.efSearch !== undefined) {
    if (!(Number.isInteger(opts.efSearch) && opts.efSearch >= 1 && opts.efSearch <= 1000)) throw new Error(`invalid efSearch ${opts.efSearch}`)
    parts.push(`set local hnsw.ef_search = ${opts.efSearch}`)
  }
  // Executor-owned SQL on the simple protocol: one round trip for the whole context.
  return parts.join('; ')
}

function txOn(c: pg.Client): Tx {
  const exec = async (sql: Statement, params: readonly unknown[] | undefined) => {
    const { text, name } = typeof sql === 'string' ? { text: sql, name: undefined } : sql
    const refused = classify(text)
    if (refused) throw new ExecutorError('CLASSIFIED', refused)
    // queryMode 'extended' keeps the server from running a second statement hidden in `text`.
    return c.query({ text, ...(name ? { name } : {}), values: params ? [...params] : [], queryMode: 'extended' } as pg.QueryConfig)
  }
  return {
    async query<T>(sql: Statement, params?: readonly unknown[]) { return (await exec(sql, params)).rows as T[] },
    async run(sql: Statement, params?: readonly unknown[]) { return (await exec(sql, params)).rowCount ?? 0 },
    async exec<T>(sql: Statement, params?: readonly unknown[]) {
      const r = await exec(sql, params)
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0, command: r.command }
    },
  }
}

/**
 * The driver caches named prepared statements per connection; after DISCARD ALL the server has
 * forgotten them, so the cache must go too or the next named statement fails (proven in phase 0).
 * `pg` is pinned (8.16.3) because this reaches a private field; executor.test.ts guards it.
 */
function clearStatementCache(c: pg.Client): void {
  const conn = (c as unknown as { connection?: { parsedStatements?: Record<string, unknown> } }).connection
  if (!conn || typeof conn.parsedStatements !== 'object') throw new Error('pg driver internals changed: parsedStatements not found')
  conn.parsedStatements = {}
}

// ---- Process executor ----

let instance: Executor | null = null

export function configureExecutor(target: ExecutorTarget, budget = new Budget(24, 4, 64)): Executor {
  instance = new Executor(target, budget)
  return instance
}

export function executor(): Executor {
  if (!instance) throw new ExecutorError('NOT_CONFIGURED', 'the database executor is not configured (openDatabase has not run in this process)')
  return instance
}

export async function closeExecutor(): Promise<void> {
  const e = instance
  instance = null
  await e?.close()
}
