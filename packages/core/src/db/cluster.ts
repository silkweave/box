// The Box's database cluster: where it lives, which one is active, and the one authority that
// initializes, starts, adopts and stops it.
//
//   data/db/active.json          the active cluster (id, engine, exact build), written atomically
//   data/db/<engine>-<n>/        one cluster: pgdata/, cache/, server.log, owner.lock, cluster.json
//
// Ownership: one process owns a running cluster (the instance lock). The supervisor (`box start` /
// `box dev`) is the normal owner and keeps the cluster across application restarts. A CLI script
// that finds a live owner only connects; it never stops a cluster it does not own. A CLI script that
// finds no owner takes the lock, starts (or adopts an orphaned server), and stops it on exit.
//
// Nothing listens on TCP: the server binds a Unix socket in an owner-only directory, and every login
// authenticates by OS peer through one ident map for the Box's OS account (PERMISSIONS 11.1).

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import pg from 'pg'
import type { DatabaseEngine } from '../box-json.js'
import type { EngineInstall } from './engines.js'
import { writeJsonDurable } from './durable.js'
import { FileLockUnavailable, withFileLock } from './flock.js'

export const DEFAULT_PORT = 5432
/** The maintenance (owner) login: creates objects, runs migrations. Never used by runtime work. */
export const OWNER_LOGIN = 'box_owner'

const BASE_SETTINGS = [
  '-c', 'listen_addresses=',
  '-c', 'unix_socket_permissions=0700',
  '-c', 'fsync=on', '-c', 'synchronous_commit=on', '-c', 'full_page_writes=on',
  '-c', 'max_connections=40', '-c', 'superuser_reserved_connections=3', '-c', 'reserved_connections=4',
  '-c', 'shared_buffers=256MB',
  '-c', 'timezone=UTC', '-c', 'log_timezone=UTC',
]

export interface ClusterIdentity {
  id: string
  engine: DatabaseEngine
  /** Exact server build at creation, e.g. `postgres (PostgreSQL) 18.6`. */
  build: string
  version: string
  major: number
  pgvector: string
  created: string
}

export interface Cluster {
  /** Directory name under data/db, e.g. `pgrust-1`. */
  name: string
  dir: string
  port: number
}

export interface ActiveCluster {
  cluster: string
  engine: DatabaseEngine
  build: string
  version: string
  pgvector: string
  activated: string
  /** The maintenance operation (restore, switch) that activated this cluster, if any. */
  operation?: string
  /** The cluster this one replaced, kept stopped for rollback until the next retirement. */
  previous?: { cluster: string; engine: DatabaseEngine; retired: string }
}

export function clusterPaths(c: Cluster) {
  return {
    data: join(c.dir, 'pgdata'),
    cache: join(c.dir, 'cache'),
    log: join(c.dir, 'server.log'),
    lock: join(c.dir, 'owner.lock'),
    identity: join(c.dir, 'cluster.json'),
  }
}

// ---- Active cluster record ----

export function readActive(dbRoot: string): ActiveCluster | null {
  const f = join(dbRoot, 'active.json')
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as ActiveCluster : null
}

/** Atomic replace: a crash leaves either the old or the new record, never a partial one. */
export function writeActive(dbRoot: string, a: ActiveCluster): void {
  writeJsonDurable(join(dbRoot, 'active.json'), a)
}

export function clusterOf(dbRoot: string, name: string, port = DEFAULT_PORT): Cluster {
  if (!/^[a-z]+-\d+$/.test(name)) throw new Error(`invalid cluster name "${name}"`)
  return { name, dir: join(dbRoot, name), port }
}

/** The next free `<engine>-<n>` directory name. */
export function nextClusterName(dbRoot: string, engine: DatabaseEngine): string {
  const used = existsSync(dbRoot) ? readdirSync(dbRoot).filter((n) => n.startsWith(`${engine}-`)).map((n) => Number(n.slice(engine.length + 1)) || 0) : []
  return `${engine}-${Math.max(0, ...used) + 1}`
}

export function readIdentity(c: Cluster): ClusterIdentity {
  return JSON.parse(readFileSync(clusterPaths(c).identity, 'utf8')) as ClusterIdentity
}

// ---- Socket directory ----

/** macOS `sun_path` is 104 bytes, Linux 108: keep the socket inside the cluster when it fits,
 *  otherwise in a private short directory derived from the cluster path. */
export function socketDir(c: Cluster): string {
  const inside = join(c.dir, 'run')
  if (Buffer.byteLength(`${inside}/.s.PGSQL.${c.port}`) < 100) return inside
  return `/tmp/box-${createHash('sha256').update(c.dir).digest('hex').slice(0, 12)}`
}

/** After the server stopped: remove a short socket directory outside the cluster (empty by now). */
function dropSocketDir(c: Cluster, dir: string): void {
  if (dir === join(c.dir, 'run')) return
  try { rmdirSync(dir) } catch { /* another server's socket or already gone: leave it */ }
}

function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const st = statSync(dir)
  if (st.uid !== process.getuid?.()) throw new Error(`socket directory ${dir} is not owned by this user`)
  chmodSync(dir, 0o700)
}

// ---- Init ----

function osUser(): string { return userInfo().username }

/** The authentication contract (PERMISSIONS 11.1): peer for every login through one ident map. */
export function hbaContract(): string { return 'local all all peer map=box\n' }
export function identContract(user = osUser()): string { return `box ${user} ${OWNER_LOGIN}\nbox ${user} /^box_[a-z0-9_]+$\n` }

function runTool(bin: string, args: string[], install: EngineInstall): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', `${install.shellPrefix}exec "$@"`, 'sh', bin, ...args], {
      env: { ...process.env, ...install.env }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = '', err = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { err += d })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(`${bin} exited ${code}: ${(err || out).trim()}`)))
  })
}

/** Create a new cluster directory with `initdb`; refuses a directory that already holds one. */
export async function initCluster(c: Cluster, install: EngineInstall): Promise<ClusterIdentity> {
  const p = clusterPaths(c)
  if (existsSync(p.identity) || existsSync(p.data)) throw new Error(`refusing to initialize ${c.dir}: it already holds a cluster`)
  mkdirSync(c.dir, { recursive: true, mode: 0o700 })
  mkdirSync(p.cache, { recursive: true, mode: 0o700 })
  await runTool(join(install.binDir, 'initdb'), ['-D', p.data, '-U', OWNER_LOGIN, '-E', 'UTF8', '--no-locale',
    '--auth-local=reject', '--auth-host=reject'], { ...install, env: { ...install.env, ...cacheEnv(install, p.cache) } })
  writeFileSync(join(p.data, 'pg_hba.conf'), hbaContract())
  writeFileSync(join(p.data, 'pg_ident.conf'), identContract())
  const id: ClusterIdentity = {
    id: randomUUID(), engine: install.engine, build: install.build, version: install.version, major: install.major,
    pgvector: install.pgvector, created: new Date().toISOString(),
  }
  writeFileSync(p.identity, JSON.stringify(id, null, 2) + '\n', { mode: 0o600 })
  return id
}

/** pgrust keeps its machine cost profile per cluster, not in the user's home cache. */
function cacheEnv(install: EngineInstall, cache: string): Record<string, string> {
  return install.engine === 'pgrust' ? { PGRUST_COST_CACHE_DIR: cache, XDG_CACHE_HOME: cache } : {}
}

// ---- Instance lock ----

interface LockRecord { pid: number; role: string; since: string }

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
}

export function lockHolder(c: Cluster): LockRecord | null {
  try {
    const l = JSON.parse(readFileSync(clusterPaths(c).lock, 'utf8')) as LockRecord
    return pidAlive(l.pid) ? l : null
  } catch { return null }
}

/**
 * Create `file` holding `record` only if it does not exist, atomically WITH its content: the record
 * is written to a private temp file and hard-linked into place, so a reader never sees an empty or
 * partial lock (which it would take for a dead holder's). Returns false when the file exists.
 */
function createLockFile(file: string, record: object): boolean {
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`
  writeFileSync(tmp, JSON.stringify(record), { mode: 0o600, flag: 'wx' })
  try { linkSync(tmp, file); return true }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e }
  finally { rmSync(tmp, { force: true }) }
}

/**
 * Remove a stale lock file, but only if it still holds exactly the stale content read and only
 * while holding the kernel reclaim lock beside it: two processes reclaiming the same stale lock are
 * serialized, and the second re-reads inside the lock, so it can never remove the first one's new,
 * live lock (the compare-then-unlink race). Returns whether it removed the file. Where kernel locks
 * are unavailable it refuses with the path to remove by hand.
 */
export function reclaimStaleLock(file: string, staleText: string | null): boolean {
  let held: { value: boolean } | null
  try {
    held = withFileLock(`${file}.reclaim`, () => {
      if (readText(file) !== staleText) return false
      rmSync(file, { force: true })
      return true
    })
  } catch (e) {
    if (e instanceof FileLockUnavailable) throw new Error(`${file} belongs to a process that is gone; ${e.message}, so remove it by hand`)
    throw e
  }
  return held?.value ?? false
}

function readText(file: string): string | null {
  try { return readFileSync(file, 'utf8') } catch { return null }
}

/** Exclusive create with a liveness check: a dead owner's lock is stale and is taken over. */
function tryAcquire(c: Cluster, role: string): (() => void) | null {
  const f = clusterPaths(c).lock
  for (let attempt = 0; attempt < 2; attempt++) {
    if (createLockFile(f, { pid: process.pid, role, since: new Date().toISOString() } satisfies LockRecord)) {
      return () => {
        try { if ((JSON.parse(readFileSync(f, 'utf8')) as LockRecord).pid === process.pid) rmSync(f) } catch { /* gone */ }
      }
    }
    const text = readText(f)
    if (lockHolder(c)) return null
    reclaimStaleLock(f, text)
  }
  return null
}

// ---- Start, adopt, stop ----

export function postmasterPid(c: Cluster): number | null {
  const f = join(clusterPaths(c).data, 'postmaster.pid')
  if (!existsSync(f)) return null
  const pid = Number(readFileSync(f, 'utf8').split('\n')[0])
  return pid && pidAlive(pid) ? pid : null
}

export interface RunningCluster {
  cluster: Cluster
  socket: string
  port: number
  /** True when this process holds the instance lock (and may stop the server). */
  owns: boolean
  /** Stops the server when this process owns it; otherwise only lets go. */
  release(): Promise<void>
}

export type OwnerRole = 'supervisor' | 'cli' | 'test'

// ---- Instance-wide maintenance gate ----
// Restore, switch, prune and Builder restore hold `data/db/maintenance.lock` for their whole run
// and its recovery. Every open (owner or adopting) refuses while another live process holds it.

export interface MaintenanceRecord { pid: number; operation: string; since: string }

export function maintenanceLockPath(dbRoot: string): string { return join(dbRoot, 'maintenance.lock') }

export function maintenanceHolder(dbRoot: string): MaintenanceRecord | null {
  try {
    const m = JSON.parse(readFileSync(maintenanceLockPath(dbRoot), 'utf8')) as MaintenanceRecord
    return pidAlive(m.pid) ? m : null
  } catch { return null }
}

export class MaintenanceRunning extends Error {}

/** Refuse when another live process holds the maintenance gate. */
export function assertNoMaintenance(dbRoot: string): void {
  const m = maintenanceHolder(dbRoot)
  if (m && m.pid !== process.pid) {
    throw new MaintenanceRunning(`database maintenance (${m.operation}, pid ${m.pid}) is running since ${m.since}; wait for it to finish`)
  }
}

/** Take the maintenance gate; returns its release. Refuses when a live process holds it. */
export function acquireMaintenance(dbRoot: string, operation: string): () => void {
  mkdirSync(dbRoot, { recursive: true, mode: 0o700 })
  const f = maintenanceLockPath(dbRoot)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (createLockFile(f, { pid: process.pid, operation, since: new Date().toISOString() } satisfies MaintenanceRecord)) {
      return () => {
        try { if ((JSON.parse(readFileSync(f, 'utf8')) as MaintenanceRecord).pid === process.pid) rmSync(f) } catch { /* gone */ }
      }
    }
    const text = readText(f)
    const held = maintenanceHolder(dbRoot)
    if (held) throw new MaintenanceRunning(`database maintenance (${held.operation}, pid ${held.pid}) is already running`)
    reclaimStaleLock(f, text)
  }
  throw new MaintenanceRunning('could not take the database maintenance lock')
}

/** The HBA a maintenance run starts a cluster with: only the owner and the policy login (role-login
 *  reconciliation on a restored target) connect; no runtime login does. */
export const MAINTENANCE_HBA = `local all ${OWNER_LOGIN},box_policy peer map=box\n`

/** Present while (and only while) the cluster's server may be running with the maintenance HBA. A
 *  normal open that finds it next to a running server stops that server instead of adopting it. */
function maintenanceHbaPath(c: Cluster): string { return join(c.dir, 'maintenance_hba.conf') }

/**
 * Start `c` for maintenance by this process: takes its owner lock (refusing a live owner), stops an
 * orphaned server, and starts it with the maintenance HBA so no runtime login can connect. The
 * release stops it.
 */
export async function startMaintenanceServer(c: Cluster, install: EngineInstall): Promise<RunningCluster> {
  const p = clusterPaths(c)
  if (!existsSync(p.identity)) throw new Error(`no cluster at ${c.dir}`)
  const id = readIdentity(c)
  if (id.engine !== install.engine || id.major !== install.major) throw new Error(`cluster ${c.name} is ${id.build}; ${install.build} cannot open it`)
  const release = tryAcquire(c, 'maintenance')
  if (!release) throw new Error(`cluster ${c.name} is in use by ${lockHolder(c)?.role ?? 'another process'} (pid ${lockHolder(c)?.pid}); stop Box first`)
  try {
    if (postmasterPid(c)) await stopServer(c)
    const sock = socketDir(c)
    ensurePrivateDir(sock)
    const hba = maintenanceHbaPath(c)
    writeFileSync(hba, MAINTENANCE_HBA, { mode: 0o600 })
    await spawnServer(c, install, sock, ['-c', `hba_file=${hba}`])
    return {
      cluster: c, socket: sock, port: c.port, owns: true,
      async release() {
        try { await stopServer(c); rmSync(hba, { force: true }); dropSocketDir(c, sock) } finally { release() }
      },
    }
  } catch (e) { release(); throw e }
}

/**
 * Bring the active cluster up for this process. `install` must be the engine the cluster was
 * created with (same engine, same major): a config or binary change never opens a cluster with
 * another engine. Waits for a live owner's server when one is starting.
 */
/**
 * `settings` are extra server `-c` pairs, applied after the base settings when this call starts the
 * server (tests: the shared test cluster serves every parallel worker, each with its own budget).
 */
export async function openCluster(c: Cluster, install: EngineInstall, role: OwnerRole, opts: { waitMs?: number; settings?: string[] } = {}): Promise<RunningCluster> {
  const p = clusterPaths(c)
  if (!existsSync(p.identity)) throw new Error(`no cluster at ${c.dir}`)
  assertNoMaintenance(dirname(c.dir))
  const id = readIdentity(c)
  if (id.engine !== install.engine) throw new Error(`cluster ${c.name} is ${id.engine}, but ${install.engine} was resolved: switch engines with \`box db switch\``)
  if (id.major !== install.major) throw new Error(`cluster ${c.name} was created by ${id.build}; ${install.build} is a different major version: upgrade through \`box db switch\``)
  const sock = socketDir(c)
  ensurePrivateDir(sock)
  const deadline = Date.now() + (opts.waitMs ?? 30_000)

  for (;;) {
    assertNoMaintenance(dirname(c.dir))
    const release = tryAcquire(c, role)
    if (release) {
      try {
        // The gate may have been taken while this process waited for the owner lock (a switch parks
        // the source and lets its lock go): check again now that the lock is ours.
        assertNoMaintenance(dirname(c.dir))
        // A server left running by a dead maintenance run admits only maintenance logins: never
        // adopt it; restart it with the normal HBA.
        if (postmasterPid(c) && existsSync(maintenanceHbaPath(c))) await stopServer(c)
        rmSync(maintenanceHbaPath(c), { force: true })
        if (!postmasterPid(c)) await spawnServer(c, install, sock, opts.settings)
        else await waitReady(c, sock, 15_000)
      } catch (e) { release(); throw e }
      return {
        cluster: c, socket: sock, port: c.port, owns: true,
        async release() { try { await stopServer(c); dropSocketDir(c, sock) } finally { release() } },
      }
    }
    // Another live process owns it: connect only, once its server answers in normal mode.
    if (postmasterPid(c) && !existsSync(maintenanceHbaPath(c))) {
      assertNoMaintenance(dirname(c.dir))
      await waitReady(c, sock, Math.max(1000, deadline - Date.now()))
      return { cluster: c, socket: sock, port: c.port, owns: false, async release() { /* not ours to stop */ } }
    }
    if (Date.now() > deadline) throw new Error(`cluster ${c.name} is owned by ${lockHolder(c)?.role ?? 'another process'} but its server is not running`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function spawnServer(c: Cluster, install: EngineInstall, sock: string, extra: string[] = []): Promise<void> {
  const p = clusterPaths(c)
  const args = [join(install.binDir, 'postgres'), '-D', p.data, '-k', sock, '-p', String(c.port), ...BASE_SETTINGS, ...install.serverArgs, ...extra]
  const log = openSync(p.log, 'a', 0o600)
  const child = spawn('/bin/sh', ['-c', `${install.shellPrefix}exec "$@"`, 'sh', ...args], {
    env: { ...process.env, ...install.env, ...cacheEnv(install, p.cache) },
    stdio: ['ignore', log, log], detached: true,
  })
  closeSync(log)
  let exited: number | null = null
  child.on('exit', (code) => { exited = code ?? -1 })
  child.unref()
  await waitReady(c, sock, 30_000, () => exited !== null ? `database server exited (${exited}); see ${p.log}` : null)
}

async function waitReady(c: Cluster, sock: string, timeoutMs: number, dead?: () => string | null): Promise<void> {
  const end = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < end) {
    const d = dead?.()
    if (d) throw new Error(d)
    const client = new pg.Client({ host: sock, port: c.port, user: OWNER_LOGIN, database: 'postgres' })
    client.on('error', () => { /* reported through connect */ })
    try { await client.connect(); await client.query('select 1'); await client.end(); return }
    catch (e) { last = (e as Error).message; await client.end().catch(() => {}) }
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`database server not ready after ${timeoutMs} ms: ${last}`)
}

/** Fast shutdown (SIGINT): rolls back open transactions, checkpoints, exits. */
export async function stopServer(c: Cluster, mode: 'fast' | 'immediate' = 'fast'): Promise<void> {
  const pid = postmasterPid(c)
  if (!pid) return
  process.kill(pid, mode === 'fast' ? 'SIGINT' : 'SIGQUIT')
  const end = Date.now() + 60_000
  while (Date.now() < end) {
    if (!pidAlive(pid)) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`database server pid ${pid} did not stop`)
}

/** A maintenance connection as the owner login (migrations, catalog, policy bootstrap). */
export function ownerClient(running: RunningCluster, database = 'postgres'): pg.Client {
  const client = new pg.Client({ host: running.socket, port: running.port, user: OWNER_LOGIN, database })
  client.on('error', () => { /* surfaced by the next query */ })
  return client
}
