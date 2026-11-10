// Bringing a running cluster's Box database to service (PHASE1.md W3): the database, the schema
// under the advisory lock, role logins reconciled with the roles, the catalog and file check
// (fail closed), then routing and the process executor. The supervisor, the server and CLI
// scripts reach this after openDatabase (db/index.ts); tests through testing.ts.

import { AsyncLocalStorage } from 'node:async_hooks'
import pg from 'pg'
import { clusterPaths, OWNER_LOGIN, type RunningCluster } from '../../db/cluster.js'
import { configureExecutor, CORE_LOGIN, executor, ExecutorError, setKnownAreas, setPolicyRefresh, type Executor } from '../executor.js'
import { clearPolicySnapshot, policyGeneration, policySnapshot, publishPolicySnapshot, type PolicySnapshot, type StoredRoleRow } from '../policy-snapshot.js'
import { CORE_SCHEMA, featureArea } from './areas.js'
import { CatalogMismatch, catalogCheck, checkRolePolicy, fileCheck } from './catalog.js'
import { AGENTS_LOCK_KEY, applyPgSchema, type ApplyOptions, type ApplyResult, type SchemaOwner } from './migrate.js'
import { BOX_DATABASE, POLICY_CHANNEL, policyTablesOf, readRoleLogins, bumpRevisionInTransaction, dropRetiredLogins, ensureDatabase, lockPolicy, pendingRetiredLogins, POLICY_LOGIN, reconcileInTransaction, reconcileRoleLogins, type RolePolicy } from './policy.js'
import { setPolicyRevisionPersister } from '../../auth/policy-revision.js'

export interface Target { socket: string; port: number }

export function client(t: Target, user: string, database: string): pg.Client {
  const c = new pg.Client({ host: t.socket, port: t.port, user, database })
  c.on('error', () => { /* surfaced by the next query */ })
  return c
}

/** Run `fn` on a fresh client, always closing it. */
export async function withClient<T>(t: Target, user: string, database: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = client(t, user, database)
  await c.connect()
  try { return await fn(c) } finally { await c.end().catch(() => {}) }
}

/** The roles the database must carry logins for: the built-ins plus the stored custom roles. */
export async function rolePolicies(owner: pg.Client, builtins: readonly RolePolicy[]): Promise<RolePolicy[]> {
  const rows = (await owner.query<{ id: string; default_level: string; areas: Record<string, string> | null }>(
    `select id, default_level, areas from ${CORE_SCHEMA}.roles order by id`)).rows
  const level = (v: unknown) => (v === 'read' || v === 'write' ? v : 'none')
  return [...builtins, ...rows.map((r) => ({
    id: r.id, default: level(r.default_level),
    areas: Object.fromEntries(Object.entries(r.areas ?? {}).map(([a, l]) => [a, level(l)])),
  } satisfies RolePolicy))]
}

export interface BootOptions extends ApplyOptions {
  core: SchemaOwner
  features: readonly SchemaOwner[]
  builtinRoles: readonly RolePolicy[]
  /** Every area a role level can name (features plus core areas). */
  knownAreas: readonly string[]
  database?: string
  /** Data and socket directory checks; off for clusters the caller does not own the files of. */
  checkFiles?: { dataDir: string; socketDir: string } | false
}

export interface BootedDatabase {
  schema: ApplyResult
  executor: Executor
  roleLogins: Map<string, string>
}

export interface PreparedDatabase {
  schema: ApplyResult
  roleLogins: Map<string, string>
}

/**
 * Schema, role logins and checks on the database at `t`; refuses with CatalogMismatch. No process
 * state changes: restore and switch prepare a target cluster with this before it is active.
 */
export async function prepareDatabase(t: Target, opts: BootOptions): Promise<PreparedDatabase> {
  const database = opts.database ?? BOX_DATABASE
  await withClient(t, OWNER_LOGIN, 'postgres', (c) => ensureDatabase(c, database))
  return withClient(t, OWNER_LOGIN, database, async (owner) => {
    const schema = await applyPgSchema(owner, opts.core, opts.features, opts)
    const roles = await rolePolicies(owner, opts.builtinRoles)
    const areas = schema.areas.areas
    // A preparing process holds no sessions of its own yet: finish every pending cleanup now.
    const { logins } = await withClient(t, POLICY_LOGIN, database, async (p) => {
      const r = await reconcileRoleLogins(p, roles, areas)
      await dropRetiredLogins(p, await pendingRetiredLogins(p))
      return r
    })
    const problems = await catalogCheck(owner, { areas, coreTables: opts.core.models.map((m) => m.table), roles, policyTables: policyTablesOf(opts.features.map((f) => ({ id: featureArea(f), models: f.models }))) })
    if (opts.checkFiles) problems.push(...fileCheck(opts.checkFiles.dataDir, opts.checkFiles.socketDir))
    if (problems.length) throw new CatalogMismatch(problems)
    return { schema, roleLogins: logins }
  })
}

/** Prepare, then route this process through the database (executor, role logins, policy service). */
export async function bootDatabase(t: Target, opts: BootOptions): Promise<BootedDatabase> {
  const database = opts.database ?? BOX_DATABASE
  const { schema, roleLogins } = await prepareDatabase(t, opts)
  setKnownAreas(opts.knownAreas)
  const executor = configureExecutor({ host: t.socket, port: t.port, database })
  // Boot replaces whatever this process had: a restored database may carry an older generation.
  publishPolicy(await readPolicySnapshot(t, database), { reset: true })
  installService({ t, database, reconcile: { builtins: opts.builtinRoles, areas: schema.areas.areas } })
  return { schema, executor, roleLogins }
}

/**
 * Run an agent change (files and users rows) under the agents advisory lock, so a backup never
 * reads the files halfway through it (R1). Without a booted database there is nothing to exclude.
 */
export async function withAgentsLock<T>(fn: () => Promise<T>): Promise<T> {
  const t = service?.reconcile ? service.t : null
  if (!t) return fn()
  const c = client(t, OWNER_LOGIN, service!.database)
  await c.connect()
  try {
    await c.query('select pg_advisory_lock($1)', [AGENTS_LOCK_KEY])
    return await fn()
  } finally {
    await c.query('select pg_advisory_unlock($1)', [AGENTS_LOCK_KEY]).catch(() => {})
    await c.end().catch(() => {})
  }
}

/** The database this process booted, for maintenance sessions (advisory locks, backups). */
export function bootedTarget(): Target | null {
  return service?.reconcile ? service.t : null
}

// ---- Policy service (PERMISSIONS 11.3, 11.10; PHASE1.md W8 P and BOX-Review's review of P) ----
// The only writer of policy rows, and the only publisher of the policy snapshot this process runs
// on (warehouse/policy-snapshot.ts). Installed by bootDatabase, or explicitly for tests on cloned
// databases (installTestPolicyService: they share their cluster's logins with every other test
// file, so there is no reconcile; a test that exercises logins boots its own cluster). Without
// either, policy commands refuse.

interface PolicyService {
  t: Target
  database: string
  /** The booted database's roles and areas; null for the test service (no login reconcile). */
  reconcile: { builtins: readonly RolePolicy[]; areas: readonly string[] } | null
}

let service: PolicyService | null = null

function installService(s: PolicyService): void {
  service = s
  setPolicyRevisionPersister(async (reason) => (await runPolicyCommand(reason, async () => undefined)).generation)
  setPolicyRefresh(refreshForAdmission)
}

/**
 * Tests on a cloned database (pg/testing.ts): policy commands write rows and move the revision on
 * box_policy without reconciling logins, and admission checks against the published snapshot.
 */
export async function installTestPolicyService(t: Target, database: string): Promise<void> {
  publishPolicy(await readPolicySnapshot(t, database), { reset: true })
  installService({ t, database, reconcile: null })
}

/** Forget the policy service and its snapshot (closing the database). */
export function clearPolicyService(): void {
  service = null
  setPolicyRevisionPersister(null)
  setPolicyRefresh(null)
  stopPolicyListener()
  clearPolicySnapshot()
}

// ---- Snapshots ----

type Queryable = Pick<pg.Client, 'query'>

/** Revision, routing and role definitions on `c`, inside the caller's transaction. */
async function snapshotOn(c: Queryable, generation?: number): Promise<PolicySnapshot> {
  let revision = generation
  if (revision === undefined) {
    const row = (await c.query<{ revision: string }>(`select revision from ${CORE_SCHEMA}.policy_state where id = 1`)).rows[0]
    if (!row) throw new ExecutorError('NO_POLICY', 'core.policy_state has no row: the access policy is unknown')
    revision = Number(row.revision)
  }
  const logins = await readRoleLogins(c)
  const roles = (await c.query<StoredRoleRow>(`select id, label, description, default_level, areas from ${CORE_SCHEMA}.roles order by id`)).rows
  return { generation: revision, logins, roles: new Map(roles.map((r) => [r.id, r])) }
}

/** One consistent snapshot: one repeatable-read, read-only transaction on box_core. */
export async function readPolicySnapshot(t: Target, database: string): Promise<PolicySnapshot> {
  return withClient(t, CORE_LOGIN, database, async (c) => {
    await c.query('begin isolation level repeatable read read only')
    try {
      const snap = await snapshotOn(c)
      await c.query('commit')
      return snap
    } catch (e) {
      await c.query('rollback').catch(() => {})
      throw e
    }
  })
}

/**
 * The one publish path (boot, command, listener, admission refresh): routing, definitions and
 * generation together, ignored when not newer (unless `reset`). Sessions of logins the new routing
 * no longer names are ended separately, after publication; a failure there never blocks it.
 */
function publishPolicy(snap: PolicySnapshot, opts: { reset?: boolean } = {}): boolean {
  const before = policySnapshot()
  if (!publishPolicySnapshot(snap, opts)) return false
  const live = new Set(snap.logins.values())
  const gone = before ? [...before.logins.values()].filter((l) => !live.has(l)) : []
  if (gone.length) {
    void Promise.resolve().then(() => executor().retireLogins(gone)).catch((e: unknown) => console.error('[policy] ending retired logins\' sessions failed:', e))
  }
  return true
}

// ---- Test seams (deterministic interleavings, PHASE1 W8 P tests) ----

export interface PolicyTestHooks {
  /** A command committed `generation` and is about to publish it. */
  beforeCommandPublish?: (generation: number) => Promise<void>
  /** A refresh read `generation` and is about to publish it. */
  beforeRefreshPublish?: (generation: number) => Promise<void>
  /** The listener is about to connect (`attempt` counts from 1). */
  beforeListenerConnect?: (attempt: number) => Promise<void>
}

let hooks: PolicyTestHooks = {}
export function setPolicyTestHooks(next: PolicyTestHooks): void {
  hooks = next
}

// ---- Commands ----

/** What a policy command's callback writes with: fixed core SQL on the box_policy connection. */
export interface PolicyTx {
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>
  run(sql: string, params?: readonly unknown[]): Promise<number>
  /** The committed policy revision this transaction holds the lock at (before its own bump). */
  readonly revision: number
}

/**
 * The one way policy rows change (PERMISSIONS 11.3, 9.2): one transaction on box_policy that takes
 * the policy lock first (core.policy_state), runs `fn` (role rows, a user's role), reconciles the
 * role logins with the roles now stored, checks the role part of the catalog, moves the revision
 * and announces it (NOTIFY, delivered at commit), and reads the snapshot it leaves. After commit
 * this process publishes that snapshot (ignored if a newer one is already published), then ends
 * its sessions of retired logins and finishes their cleanup (errors logged; boot finishes leftovers).
 */
export async function policyCommand<T>(reason: string, fn: (tx: PolicyTx) => Promise<T>): Promise<T> {
  return (await runPolicyCommand(reason, fn)).result
}

// The policy lane (matrix A7): at most one box_policy session per process, taken before it
// connects; callers queue (bounded) instead of each holding a session while it waits for the
// policy row lock. Independent of the executor budget, so a policy change progresses when every
// ordinary slot is busy. The database lock still serializes processes.
export const POLICY_QUEUE_MAX = 64
let laneBusy = false
const laneWaiters: Array<() => void> = []
const inLane = new AsyncLocalStorage<true>()

async function withPolicyLane<T>(reason: string, fn: () => Promise<T>): Promise<T> {
  if (inLane.getStore()) throw new ExecutorError('NESTED_LOGIN', `policy command "${reason}" refused: it runs inside another policy command`)
  if (laneBusy) {
    if (laneWaiters.length >= POLICY_QUEUE_MAX) throw new ExecutorError('BUDGET', `policy command "${reason}" refused: ${POLICY_QUEUE_MAX} policy commands are already queued`)
    // Handed over by the finishing holder (laneBusy stays true), so nobody takes it in between.
    await new Promise<void>((resolve) => laneWaiters.push(resolve))
  } else {
    laneBusy = true
  }
  try {
    return await inLane.run(true, fn)
  } finally {
    const next = laneWaiters.shift()
    if (next) next()
    else laneBusy = false
  }
}

/** Policy commands waiting for the lane (tests). */
export function policyLaneState(): { busy: boolean; waiting: number } {
  return { busy: laneBusy, waiting: laneWaiters.length }
}

async function runPolicyCommand<T>(reason: string, fn: (tx: PolicyTx) => Promise<T>): Promise<{ result: T; generation: number }> {
  const s = service
  if (!s) throw new ExecutorError('NOT_CONFIGURED', `policy command "${reason}" refused: the policy service is not configured (openDatabase has not run in this process)`)
  // The session closes (withClient awaits its end) before the lane passes on.
  const { result, retired, snap } = await withPolicyLane(reason, () => withClient(s.t, POLICY_LOGIN, s.database, async (c) => {
    await c.query('begin')
    try {
      const tx = policyTxOn(c, await lockPolicy(c))
      const result = await fn(tx)
      let retired: string[] = []
      if (s.reconcile) {
        const roles = await rolePolicies(c, s.reconcile.builtins)
        retired = (await reconcileInTransaction(c, roles, s.reconcile.areas)).retired
        const { problems } = await checkRolePolicy(async (sql, params) => (await c.query(sql, params as unknown[])).rows, { areas: s.reconcile.areas, coreTables: [], roles })
        if (problems.length) throw new CatalogMismatch(problems)
      }
      const snap = await snapshotOn(c, await bumpRevisionInTransaction(c))
      await c.query('commit')
      return { result, retired, snap }
    } catch (e) {
      await c.query('rollback').catch(() => {})
      if (e instanceof CatalogMismatch) console.error(`[policy] ${reason}: refused by the catalog check`)
      throw e
    }
  }))
  await hooks.beforeCommandPublish?.(snap.generation)
  publishPolicy(snap)
  if (retired.length) {
    try {
      await executor().retireLogins(retired)
      await withPolicyLane(`${reason}: cleanup`, () => withClient(s.t, POLICY_LOGIN, s.database, (c) => dropRetiredLogins(c, retired)))
    } catch (e) {
      console.error(`[policy] ${reason}: cleanup of retired logins failed (finished at the next boot):`, e)
    }
  }
  return { result, generation: snap.generation }
}

function policyTxOn(c: pg.Client, revision: number): PolicyTx {
  return {
    query: async (sql, params) => (await c.query(sql, params as unknown[])).rows,
    run: async (sql, params) => (await c.query(sql, params as unknown[])).rowCount ?? 0,
    revision,
  }
}

/**
 * Read policy state under the policy lock without changing it (a coverage preview, PERMISSIONS
 * 7.2): the same lane, login and lock as a command, then a rollback. No revision bump, no publish.
 */
export async function policyRead<T>(reason: string, fn: (tx: PolicyTx) => Promise<T>): Promise<T> {
  const s = service
  if (!s) throw new ExecutorError('NOT_CONFIGURED', `policy read "${reason}" refused: the policy service is not configured (openDatabase has not run in this process)`)
  return withPolicyLane(reason, () => withClient(s.t, POLICY_LOGIN, s.database, async (c) => {
    await c.query('begin')
    try {
      return await fn(policyTxOn(c, await lockPolicy(c)))
    } finally {
      await c.query('rollback').catch(() => {})
    }
  }))
}

// ---- Refresh: adopting a policy change committed elsewhere ----

let refreshing: Promise<void> | null = null

/**
 * Publish the committed policy, at least `atLeast` when given. One read at a time: a caller joins
 * the read in flight, and starts another when that one turned out older than what it saw.
 */
export async function refreshPolicy(atLeast = 0): Promise<void> {
  for (let round = 0; round < 3; round++) {
    refreshing ??= (async () => {
      const s = service
      if (!s) return
      const snap = await readPolicySnapshot(s.t, s.database)
      await hooks.beforeRefreshPublish?.(snap.generation)
      publishPolicy(snap)
    })().finally(() => { refreshing = null })
    await refreshing
    if (policyGeneration() >= atLeast) return
  }
}

/** Admission found the work stale (executor.ts): publish what is committed, then re-resolve the frame. */
async function refreshForAdmission(observed: number): Promise<void> {
  await refreshPolicy(observed)
  await reresolveFrameAccess()
}

/**
 * The current request frame's identity and access (a core command's requester), re-read now: the principal through the
 * bootstrap accessor, the access against the published snapshot (tagged no newer than the
 * generation before that read). A principal that no longer resolves loses the frame: the holder is
 * emptied (later work has no context) and this transaction is refused.
 */
async function reresolveFrameAccess(): Promise<void> {
  // Lazily: request-context and the auth modules load the feature registry, which this module
  // (loaded by every test file's database setup) must not pull in.
  const { requestHolder, currentScope } = await import('../../request-context.js')
  // A core command's system frame re-resolves its requester (core-command.ts).
  const scope = currentScope()
  const holder = scope.kind === 'system' ? scope.requester?.holder ?? null : requestHolder()
  const principal = holder?.principal
  if (!holder || !principal) return
  const { resolvePrincipalById } = await import('../../auth/principal.js')
  const { accessOf } = await import('../../auth/access.js')
  const fresh = await resolvePrincipalById(principal.id)
  if (!fresh || fresh.kind !== principal.kind) {
    holder.principal = undefined
    holder.access = undefined
    throw new ExecutorError('NO_PRINCIPAL', `"${principal.id}" can no longer act (revoked, removed or retired)`)
  }
  // The transport's session stays the transport's (a session grant is kept as presented).
  const next = { ...principal, display: fresh.display, role: fresh.role, resolvedAt: fresh.resolvedAt }
  holder.principal = next
  holder.access = await accessOf(next)
}

// ---- Listener: an early hint, never the barrier (admission is) ----
// One LISTEN session at a time. Every start gets a generation; callbacks act only for the current
// one, so a late error or end of an old client can neither clear nor duplicate a newer listener,
// and stop cancels a start still connecting.

let listener: pg.Client | null = null
let listenerGeneration = 0
let listenerStarting: Promise<void> | null = null
let listenerTimer: ReturnType<typeof setTimeout> | null = null
let listenerStopped = true
let listenerAttempts = 0

/** Start LISTEN box_policy for this process (the server): refresh as soon as another process commits. */
export function startPolicyListener(): Promise<void> {
  if (!service?.reconcile) return Promise.resolve()
  listenerStopped = false
  if (listener) return Promise.resolve()
  if (!listenerStarting) {
    // Only the connect is shared; a stop clears it, so a later start never joins a stale one.
    const p = connectListener().finally(() => { if (listenerStarting === p) listenerStarting = null })
    listenerStarting = p
  }
  // Set up before this read, so nothing committed in between is missed.
  return listenerStarting.then(() => refreshPolicy().catch((e: unknown) => console.error('[policy] refresh after listening failed:', e)))
}

async function connectListener(): Promise<void> {
  const s = service
  if (!s) return
  const gen = ++listenerGeneration
  const c = client(s.t, CORE_LOGIN, s.database)
  c.on('notification', (msg) => {
    if (gen !== listenerGeneration) return
    void refreshPolicy(Number(msg.payload) || 0).catch((e: unknown) => console.error('[policy] refresh after notification failed:', e))
  })
  c.on('error', () => listenerLost(gen, c))
  c.on('end', () => listenerLost(gen, c))
  try {
    const attempt = ++listenerAttempts
    await hooks.beforeListenerConnect?.(attempt)
    if (gen !== listenerGeneration) return
    await c.connect()
    if (gen !== listenerGeneration) { await c.end().catch(() => {}); return }
    await c.query(`listen ${POLICY_CHANNEL}`)
    if (gen !== listenerGeneration) { await c.end().catch(() => {}); return }
    listener = c
  } catch (e) {
    listenerLost(gen, c)
    throw e
  }
}

function listenerLost(gen: number, c: pg.Client): void {
  if (gen !== listenerGeneration) return
  listenerGeneration++
  if (listener === c) listener = null
  void c.end().catch(() => {})
  if (listenerStopped || listenerTimer) return
  listenerTimer = setTimeout(() => {
    listenerTimer = null
    if (!listenerStopped) void startPolicyListener().catch(() => { /* listenerLost scheduled the next try */ })
  }, 1000)
  listenerTimer.unref?.()
}

export function stopPolicyListener(): void {
  listenerStopped = true
  listenerGeneration++
  listenerStarting = null
  if (listenerTimer) { clearTimeout(listenerTimer); listenerTimer = null }
  const old = listener
  listener = null
  void old?.end().catch(() => {})
}

/** Tests: whether a listener session is up, and how many connects were attempted. */
export function policyListenerState(): { connected: boolean; starting: boolean; attempts: number; retryScheduled: boolean } {
  return { connected: listener !== null, starting: listenerStarting !== null, attempts: listenerAttempts, retryScheduled: listenerTimer !== null }
}

/** File-check paths for a cluster this process opened. */
export function clusterFiles(running: RunningCluster): { dataDir: string; socketDir: string } {
  return { dataDir: clusterPaths(running.cluster).data, socketDir: running.socket }
}
