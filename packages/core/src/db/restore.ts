// Restore (PHASE1.md "W7 design" item 4, R2 to R6): an offline maintenance operation that builds a
// fresh cluster from a restore point's snapshot, validates it, and only then makes it active. The
// active cluster is never modified; a failure anywhere leaves it active.
//
// The operation journal `data/db/restore.json` is written (durably) before each mutation. Start-up
// (`recoverMaintenance`, first thing in openDatabase) settles an interrupted operation by one rule:
// `active.json` names the target with this operation id -> finish forward; names the source ->
// roll back; anything else -> refuse with the journal's path. Lock order: maintenance gate, schema
// lock, agents lock.
//
// Commit steps, each journalled before it starts: `commit` (every staged file set flushed to disk;
// swaps applied; active.json written), then `cleanup` (only the
// parked old files are removed). Recovery in `cleanup` never touches live files; recovery in
// `commit` re-applies swaps from each swap's recorded state, never from a missing path alone.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { BUILTIN_ROLES, knownAreas } from '../auth/roles.js'
import { agentIdentity, agentIdentityFrom, boxJsonPath } from '../box-config.js'
import { readBoxConfig } from '../box-json.js'
import { configPath, configRoot, instanceDir } from '../io.js'
import { agentsDir, parseAgentFile } from '../agents.js'
import { captureAgentFilesFrom, interruptedAgentChange, parkedAgentsDir, stageAgentFiles, type AgentFiles } from '../warehouse/agent-snapshot.js'
import { prepareDatabase } from '../warehouse/pg/boot.js'
import { BOX_DATABASE } from '../warehouse/pg/policy.js'
import { boxSchemaOwners } from '../warehouse/schema.js'
import { backupName, backupsDir, findRestorePoint, pruneBackupsQuietly } from '../warehouse/restore-points.js'
import {
  acquireMaintenance, clusterOf, clusterPaths, lockHolder, maintenanceHolder, MaintenanceRunning, nextClusterName,
  OWNER_LOGIN, postmasterPid, readActive, readIdentity, registerCluster, startMaintenanceServer, stopServer, writeActive,
  type ActiveCluster, type RunningCluster,
} from './cluster.js'
import { fsyncDir, fsyncTree, writeJsonDurable } from './durable.js'
import type { EngineInstall } from './engines.js'
import {
  compareLedger, readLedger, takeRestorePoint, unpackRestorePoint, validateRestorePoint,
  type ValidRestorePoint,
} from './restore-point.js'

const JOURNAL_FORMAT = 'box-db-operation/2'

export interface OperationJournal {
  format: typeof JOURNAL_FORMAT
  id: string
  kind: 'restore'
  step: string
  startedAt: string
  /** The cluster active when the operation started (null on a Box without one). */
  source: { cluster: string } | null
  target: { cluster: string }
  restorePoint: string
  /** Restore points retention and prune must keep while this journal exists. */
  pins: string[]
  /** File sets replaced at commit: `staged` goes to `live`, the old `live` to `parked`. */
  swaps: JournalSwap[]
  /** The record `active.json` gets on activation. */
  expectedActive: ActiveCluster | null
  /** Id of the staged file sets (Builder names its staging directories with it). */
  stage?: string
}

/** One file or directory replaced at commit. `staged` may be absent: the live one is then removed
 *  (parked) and nothing takes its place. */
export interface FileSwap { live: string; staged: string; parked: string; hadLive: boolean }

/** A swap as journalled: whether its staged side existed when the commit was decided. With that
 *  and `hadLive`, every state of the swap is told apart by what exists on disk. */
export interface JournalSwap extends FileSwap { hasStaged: boolean }

class InconsistentSwap extends Error {}

function moveDurable(from: string, to: string): void {
  renameSync(from, to)
  fsyncDir(dirname(to))
  if (dirname(from) !== dirname(to)) fsyncDir(dirname(from))
}

/**
 * Apply one swap (commit step only; repeatable). States: old live parked or not yet; staged moved
 * into live or not yet. A missing staged side with no parked old side cannot happen before cleanup
 * and is refused rather than guessed at.
 */
export function applySwap(w: JournalSwap): void {
  const stagedThere = w.hasStaged && existsSync(w.staged)
  const parkedThere = w.hadLive && existsSync(w.parked)
  if (w.hasStaged && !stagedThere && w.hadLive && !parkedThere) {
    throw new InconsistentSwap(`${w.live}: the staged copy is gone but the previous one was never parked; resolve by hand`)
  }
  if (w.hadLive && !parkedThere) {
    if (!existsSync(w.live)) throw new InconsistentSwap(`${w.live}: neither the live nor the parked copy exists; resolve by hand`)
    moveDurable(w.live, w.parked)
  }
  if (stagedThere) {
    if (existsSync(w.live)) throw new InconsistentSwap(`${w.live}: exists although the previous copy is parked; resolve by hand`)
    moveDurable(w.staged, w.live)
  }
}

/**
 * Undo one swap before activation. Repeatable at any interruption, and it never infers anything
 * from a missing staged copy: a live path that existed before the commit is replaced only by its
 * parked copy, so while no parked copy exists the live one is the original and stays untouched.
 * A live path that did not exist before (hadLive false) holds nothing original and is removed.
 * Staged copies are never original and are always removed.
 */
export function undoSwap(w: JournalSwap): void {
  if (w.hadLive) {
    if (existsSync(w.parked)) {
      if (existsSync(w.live)) { rmSync(w.live, { recursive: true, force: true }); fsyncDir(dirname(w.live)) }
      moveDurable(w.parked, w.live)
    }
  } else if (w.hasStaged && existsSync(w.live)) {
    rmSync(w.live, { recursive: true, force: true })
    fsyncDir(dirname(w.live))
  }
  if (w.hasStaged && existsSync(w.staged)) { rmSync(w.staged, { recursive: true, force: true }); fsyncDir(dirname(w.staged)) }
}

export interface ResolveEngine { (cacheDir: string): Promise<EngineInstall> }

function journalPath(dbRoot: string): string { return join(dbRoot, 'restore.json') }

function writeJournal(dbRoot: string, j: OperationJournal): void { writeJsonDurable(journalPath(dbRoot), j) }

export function readJournal(dbRoot: string): OperationJournal | null {
  const f = journalPath(dbRoot)
  if (!existsSync(f)) return null
  const j = JSON.parse(readFileSync(f, 'utf8')) as OperationJournal
  if (j.format !== JOURNAL_FORMAT || typeof j.id !== 'string' || !j.target?.cluster) throw new Error(`${f} is not an operation journal this version wrote; resolve it by hand`)
  return j
}

function clearJournal(dbRoot: string): void {
  rmSync(journalPath(dbRoot), { force: true })
  fsyncDir(dbRoot)
}

/** Stop a cluster's server (when one runs and no live process owns it) and delete its directory. */
async function discardCluster(dbRoot: string, name: string): Promise<void> {
  const c = clusterOf(dbRoot, name)
  if (!existsSync(c.dir)) return
  const owner = lockHolder(c)
  if (owner && owner.pid !== process.pid) throw new Error(`cluster ${name} is in use by pid ${owner.pid}; not deleting it`)
  if (postmasterPid(c)) await stopServer(c)
  if (postmasterPid(c)) throw new Error(`cluster ${name} did not stop; not deleting it`)
  rmSync(c.dir, { recursive: true, force: true })
  fsyncDir(dbRoot)
}

// ---- Recovery ----

export interface Recovery { outcome: 'none' | 'forward' | 'rolled-back'; summary?: string }

/**
 * Settle an interrupted restore. Runs before fresh initialization, boot and agent reconciliation. Refuses while the operation's own process is still alive.
 */
export async function recoverMaintenance(dbRoot: string): Promise<Recovery> {
  if (!existsSync(journalPath(dbRoot))) return { outcome: 'none' }
  const holder = maintenanceHolder(dbRoot)
  if (holder && holder.pid !== process.pid) throw new MaintenanceRunning(`database maintenance (${holder.operation}, pid ${holder.pid}) is running; wait for it to finish`)
  const release = holder ? () => {} : acquireMaintenance(dbRoot, 'recovery')
  try {
    const j = readJournal(dbRoot)!
    const active = readActive(dbRoot)
    if (active && active.cluster === j.target.cluster && active.operation === j.id) {
      await finishForward(dbRoot, j)
      return { outcome: 'forward', summary: `completed the interrupted ${j.kind} (${j.id}): ${j.target.cluster} is active` }
    }
    if ((j.source && active?.cluster === j.source.cluster) || (!j.source && !active)) {
      await rollBack(dbRoot, j)
      return { outcome: 'rolled-back', summary: `rolled back the interrupted ${j.kind} (${j.id}) at step "${j.step}"; ${active?.cluster ?? 'no cluster'} stays active` }
    }
    throw new Error(`${journalPath(dbRoot)} (${j.kind} ${j.id}) does not match active.json (${active?.cluster ?? 'none'}); resolve it by hand`)
  } finally { release() }
}

async function finishForward(dbRoot: string, j: OperationJournal): Promise<void> {
  if (j.step === 'commit') {
    for (const w of j.swaps) applySwap(w)
    j = { ...j, step: 'cleanup' }
    writeJournal(dbRoot, j)
  }
  if (j.step !== 'cleanup') throw new Error(`${journalPath(dbRoot)}: active.json names the target but the journal is at step "${j.step}"; resolve it by hand`)
  cleanupParked(j)
  clearJournal(dbRoot)
}

/** Cleanup step: remove the parked previous copies. Never touches a live path. */
function cleanupParked(j: OperationJournal): void {
  for (const w of j.swaps) {
    if (!w.hadLive || !existsSync(w.parked)) continue
    rmSync(w.parked, { recursive: true, force: true })
    fsyncDir(dirname(w.parked))
  }
}

/** Test seam: throw inside a rollback after this many swaps were undone (an interrupted rollback). */
let rollbackCrashAfter: number | null = null
export function setRollbackCrashForTests(afterSwaps: number | null): void { rollbackCrashAfter = afterSwaps }

async function rollBack(dbRoot: string, j: OperationJournal): Promise<void> {
  if (j.step === 'cleanup') throw new Error(`${journalPath(dbRoot)}: the operation reached cleanup but active.json does not name its target; resolve it by hand`)
  if (j.step !== 'rollback') { j = { ...j, step: 'rollback' }; writeJournal(dbRoot, j) }
  let undone = 0
  for (const w of [...j.swaps].reverse()) {
    undoSwap(w)
    if (++undone === rollbackCrashAfter) throw Object.assign(new Error(`injected crash after undoing ${undone} swap(s)`), { injected: true })
  }
  // A plain restore's staged agent directory is never live: drop it even when the crash came
  // before its swap was journalled.
  if (j.stage) rmSync(join(dirname(agentsDir()), `agents.restoring-${j.stage}`), { recursive: true, force: true })
  await discardCluster(dbRoot, j.target.cluster)
  clearJournal(dbRoot)
}

// ---- The workflow ----

function ownerClient(t: { socket: string; port: number }, database: string): pg.Client {
  const c = new pg.Client({ host: t.socket, port: t.port, user: OWNER_LOGIN, database })
  c.on('error', () => { /* surfaced by the next query */ })
  return c
}

async function withOwner<T>(t: { socket: string; port: number }, database: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = ownerClient(t, database)
  await c.connect()
  try { return await fn(c) } finally { await c.end().catch(() => {}) }
}

/**
 * Check the recovered target at `t` (maintenance HBA) against the manifest BEFORE any forward
 * migration (R6), then migrate, reconcile and check (R5). Returns every problem found.
 */
async function checkTarget(t: { socket: string; port: number }, point: ValidRestorePoint, dataDir: string): Promise<string[]> {
  const restored = await withOwner(t, BOX_DATABASE, (c) => readLedger(c))
  const problems = compareLedger(point.manifest.ledger, restored)
  if (problems.length) return problems
  const { core, features } = boxSchemaOwners()
  await prepareDatabase(t, {
    core, features,
    builtinRoles: BUILTIN_ROLES.map((r) => ({ id: r.id, default: r.default, areas: r.areas })),
    knownAreas: knownAreas(),
    // The normal-mode files the next boot will use (the maintenance HBA is passed by path, so the
    // cluster's own pg_hba.conf and pg_ident.conf are the ones checked here).
    checkFiles: { dataDir, socketDir: t.socket },
  })
  return []
}

/**
 * Admission of the target before activation (no live state used): the agent files that will be
 * live after the commit must parse, name roles the restored database has, and not name a person;
 * the configured system agent's role must exist there too.
 */
async function admissionProblems(t: { socket: string; port: number }, files: AgentFiles, system: { id: string; role: string } | { problem: string }): Promise<string[]> {
  if ('problem' in system) return [system.problem]
  const systemAgent = system
  const problems: string[] = []
  const roles = new Set<string>(BUILTIN_ROLES.map((r) => r.id))
  const kinds = new Map<string, string | null>()
  await withOwner(t, BOX_DATABASE, async (c) => {
    for (const r of (await c.query<{ id: string }>('select id from core.roles')).rows) roles.add(r.id)
    for (const r of (await c.query<{ id: string; kind: string | null }>('select id, kind from core.users')).rows) kinds.set(r.id, r.kind)
  })
  if (!roles.has(systemAgent.role)) problems.push(`box.json agent ${systemAgent.id}: no role "${systemAgent.role}" in the restored database`)
  // As boot requires: a populated database already has the system agent's row, and it is an agent.
  const people = [...kinds.values()].some((k) => k !== 'agent')
  if (!kinds.has(systemAgent.id) && people) problems.push(`box.json agent ${systemAgent.id} does not exist in the restored database, which has people`)
  if (kinds.has(systemAgent.id) && kinds.get(systemAgent.id) !== 'agent') problems.push(`box.json agent ${systemAgent.id} is a person in the restored database`)
  for (const [name, text] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const id = name.slice(0, -'.md'.length)
    try {
      const parsed = parseAgentFile(id, text, { system: id === systemAgent.id })
      if (parsed.role && !roles.has(parsed.role)) problems.push(`agent file ${name}: no role "${parsed.role}" in the restored database`)
      if (id !== systemAgent.id && kinds.has(id) && kinds.get(id) !== 'agent') problems.push(`agent file ${name}: names an existing person`)
    } catch (e) { problems.push(`agent file ${name}: ${(e as Error).message}`) }
  }
  return problems
}

/** Where `live` will come from after the commit: its staged copy (inside a staged directory or as
 *  a staged file), null when the commit removes it, or `live` itself when no swap covers it. */
function stagedPathOf(swaps: JournalSwap[], live: string): string | null {
  for (const w of swaps) {
    const rel = relative(w.live, live)
    if (rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !rel.includes(`..${sep}`))) {
      return w.hasStaged ? join(w.staged, rel) : null
    }
  }
  return live
}

/** The agent files the staged swaps will make live. */
function stagedAgentFiles(swaps: JournalSwap[]): AgentFiles {
  const dir = stagedPathOf(swaps, agentsDir())
  return dir ? captureAgentFilesFrom(dir) : {}
}

/**
 * The system agent of the configuration that will be live after the commit (Builder restores put
 * back box.json, box.local.json and the identity lock), merged and validated as at startup. A
 * configuration that would not start is a refusal, never a skipped check.
 */
function stagedSystemAgent(swaps: JournalSwap[]): { id: string; role: string } | { problem: string } {
  const tmp = mkdtempSync(join(tmpdir(), 'box-restore-config-'))
  try {
    const place = (live: string, name: string) => {
      const from = stagedPathOf(swaps, live)
      if (from && existsSync(from)) copyFileSync(from, join(tmp, name))
    }
    place(boxJsonPath(), 'box.json')
    place(join(configRoot(), 'box.local.json'), 'box.local.json')
    place(configPath('agent-identity.lock.json'), 'agent-identity.lock.json')
    if (!existsSync(join(tmp, 'box.json'))) return { problem: 'the restored configuration has no box.json' }
    readBoxConfig(tmp)
    const a = agentIdentityFrom({ root: join(tmp, 'box.json'), local: join(tmp, 'box.local.json'), lock: join(tmp, 'agent-identity.lock.json') })
    return { id: a.id, role: a.role }
  } catch (e) {
    return { problem: `the restored configuration would not start: ${(e as Error).message}` }
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

export interface RestoreOptions {
  /** Restore point name (backups/db or seeds) or an absolute directory. */
  point: string
  resolveEngine: ResolveEngine
  /** Builder: stage every file set the commit replaces (instance files, root config, agent files);
   *  when absent the restore point's agent files are staged. */
  stageFiles?: (id: string) => FileSwap[]
  /** Builder: the system identity comes back with the restored configuration, so the restore
   *  point's system agent is not compared with the live one. */
  identityFromBackup?: boolean
  /** Test seam: throw after this step to simulate a crash (`kill-in-park` kills the process). */
  crashAfter?: string
  log?: (line: string) => void
}

export interface RestoreResult {
  operation: string
  activated: ActiveCluster
  parked: string | null
  retired: string | null
  summary: string
}

function resolvePointDir(point: string): string {
  return point.startsWith('/') ? point : findRestorePoint(point).path
}

/** The restore point must come from this system principal and its identity lock (checked before
 *  anything changes). */
function checkSystemAgent(point: ValidRestorePoint): void {
  // R1: a restore across a system-agent replacement cannot be reconciled from the files.
  const liveSystem = agentIdentity().id
  const recorded = point.manifest.systemAgent
  const across = `Restore the whole Box from a Builder backup taken before the replacement instead.`
  if (recorded.id !== liveSystem) {
    throw new Error(`${point.manifest.name} was taken when the system principal was "${recorded.id}"; this Box's is "${liveSystem}" (replaced since). ${across}`)
  }
  const lockId = (text: string | null) => {
    if (text === null) return null
    try { return (JSON.parse(text) as { id?: unknown }).id ?? '(unreadable)' } catch { return '(unreadable)' }
  }
  const recordedLock = lockId(recorded.identityLock)
  const liveLock = lockId(existsSync(configPath('agent-identity.lock.json')) ? readFileSync(configPath('agent-identity.lock.json'), 'utf8') : null)
  if (recordedLock !== null && liveLock !== null && recordedLock !== liveLock) {
    throw new Error(`${point.manifest.name} was taken under the identity lock of "${String(recordedLock)}"; this Box's lock is "${String(liveLock)}". ${across}`)
  }
}

/**
 * Restore a restore point into a fresh cluster and make it active. Offline: refuses while another
 * process owns the active cluster (stop Box first) or another maintenance runs.
 */
export async function restoreDatabase(dbRoot: string, o: RestoreOptions): Promise<RestoreResult> {
  const log = o.log ?? (() => {})
  await recoverMaintenance(dbRoot)
  const release = acquireMaintenance(dbRoot, 'restore')
  const crash = (step: string) => { if (o.crashAfter === step) throw Object.assign(new Error(`injected crash after ${step}`), { injected: true }) }
  let journal: OperationJournal | null = null
  let target: RunningCluster | null = null
  try {
    const interrupted = interruptedAgentChange()
    if (interrupted) throw new Error(`restore refused: ${interrupted}`)
    const active = readActive(dbRoot)
    const targetName = nextClusterName(dbRoot)
    const targetCluster = clusterOf(dbRoot, targetName)
    const targetPaths = clusterPaths(targetCluster)
    const targetInstall = await o.resolveEngine(targetPaths.cache)
    // The restore point is validated in full before anything changes.
    const point = await validateRestorePoint(resolvePointDir(o.point))
    if (!o.identityFromBackup) checkSystemAgent(point)

    const id = randomUUID()
    journal = {
      format: JOURNAL_FORMAT, id, kind: 'restore', step: 'unpack', startedAt: new Date().toISOString(),
      source: active ? { cluster: active.cluster } : null,
      target: { cluster: targetName },
      restorePoint: point.dir, pins: [point.manifest.name], swaps: [], expectedActive: null,
    }
    writeJournal(dbRoot, journal)
    // Unpacked before the source is parked: an archive that does not unpack to a data directory
    // with its backup label is refused before anything else happens.
    mkdirSync(targetCluster.dir, { recursive: true, mode: 0o700 })
    await unpackRestorePoint(point, targetPaths.data, targetInstall.major)
    crash('unpack')

    // Park the active cluster as a restore point first (R4: under the maintenance HBA).
    let parked: string | null = null
    if (active) {
      const src = clusterOf(dbRoot, active.cluster)
      const srcInstall = await o.resolveEngine(clusterPaths(src).cache)
      const name = backupName('pre-restore')
      journal = { ...journal, step: 'park', pins: [...journal.pins, name] }
      writeJournal(dbRoot, journal)
      const running = await startMaintenanceServer(src, srcInstall)
      try {
        // Test seam: real process death while the source runs under the maintenance HBA.
        if (o.crashAfter === 'kill-in-park') process.kill(process.pid, 'SIGKILL')
        await takeRestorePoint({ target: { ...running, dataDir: clusterPaths(src).data }, parent: backupsDir(), name, label: 'pre-restore',
          source: { cluster: active.cluster, identity: readIdentity(src) } })
        parked = name
        log(`parked ${active.cluster} as ${name}`)
      } finally { await running.release() }
    }
    crash('park')

    // The server's backup recovery replays the archive's WAL as the maintenance server starts.
    journal = { ...journal, step: 'target' }
    writeJournal(dbRoot, journal)
    const identity = registerCluster(targetCluster, targetInstall)
    target = await startMaintenanceServer(targetCluster, targetInstall)
    crash('target')
    journal = { ...journal, step: 'load' }
    writeJournal(dbRoot, journal)
    const problems = await checkTarget(target, point, targetPaths.data)
    if (problems.length) throw new Error(`the restored database does not match ${point.manifest.name}:\n  ${problems.join('\n  ')}`)
    crash('load')

    // Stage every file set the commit replaces (nothing live changes): Builder stages the whole
    // instance (agent files included); a plain restore stages the agents. Then admit the target
    // against exactly what will be live, before the journal commits to it.
    journal = { ...journal, step: 'stage', stage: id.slice(0, 8) }
    writeJournal(dbRoot, journal)
    const stagedSwaps: FileSwap[] = o.stageFiles
      ? o.stageFiles(id.slice(0, 8))
      : [{ live: agentsDir(), staged: stageAgentFiles(point.agents, id.slice(0, 8)), parked: parkedAgentsDir(id.slice(0, 8)), hadLive: existsSync(agentsDir()) }]
    const swaps: JournalSwap[] = stagedSwaps.map((w) => ({ ...w, hasStaged: existsSync(w.staged) }))
    journal = { ...journal, swaps }
    writeJournal(dbRoot, journal)
    const refused = await admissionProblems(target, stagedAgentFiles(swaps), stagedSystemAgent(swaps))
    if (refused.length) throw new Error(`the restore would not boot; nothing was changed:\n  ${refused.join('\n  ')}`)
    await target.release()
    target = null
    crash('stage')
    // Staged content is on disk before the journal relies on it.
    for (const w of swaps) if (w.hasStaged) { fsyncTree(w.staged); fsyncDir(dirname(w.staged)) }
    for (const w of swaps) if (w.hadLive) fsyncDir(dirname(w.parked))
    const expectedActive: ActiveCluster = {
      cluster: targetName, build: identity.build, version: identity.version, pgvector: identity.pgvector,
      activated: new Date().toISOString(), operation: id,
      ...(active ? { previous: { cluster: active.cluster, retired: new Date().toISOString() } } : {}),
    }
    journal = { ...journal, step: 'commit', swaps, expectedActive }
    writeJournal(dbRoot, journal)
    for (const w of swaps) applySwap(w)
    crash('swap')
    writeActive(dbRoot, expectedActive)
    crash('activate')

    // Done: cleanup (parked copies only), the journal, then the older retired cluster (one is kept).
    journal = { ...journal, step: 'cleanup' }
    writeJournal(dbRoot, journal)
    const older = active?.previous?.cluster
    if (o.crashAfter === 'cleanup-partial') {
      const first = swaps.find((w) => w.hadLive && existsSync(w.parked))
      if (first) { rmSync(first.parked, { recursive: true, force: true }); crash('cleanup-partial') }
    }
    cleanupParked(journal)
    crash('cleanup')
    clearJournal(dbRoot)
    if (older && older !== targetName) await discardCluster(dbRoot, older).catch((e) => log(`could not delete retired cluster ${older}: ${(e as Error).message}`))
    pruneBackupsQuietly(instanceDir())
    const summary = `restored ${point.manifest.name} into ${targetName}; ` +
      (active ? `${active.cluster} is retired (kept for rollback) and parked as ${parked}` : 'there was no previous cluster')
    return { operation: id, activated: expectedActive, parked, retired: active?.cluster ?? null, summary }
  } catch (e) {
    if (target) await target.release().catch(() => {})
    if ((e as { injected?: boolean }).injected) throw e
    // Not activated: the source stays active; discard what this run built. A rollback that fails
    // leaves the journal (and every path it names) for the next start to settle; say so.
    if (journal && readActive(dbRoot)?.operation !== journal.id) {
      try { await rollBack(dbRoot, journal) }
      catch (r) {
        throw new Error(`${(e as Error).message}\nRolling back also failed: ${(r as Error).message}. ${journalPath(dbRoot)} stays; ` +
          'the next start (or `box db restore`) retries the rollback, and nothing it names may be deleted by hand.', { cause: e })
      }
    }
    throw e
  } finally { release() }
}

// ---- Clusters on disk ----

export interface ClusterEntry { name: string; build: string; state: 'active' | 'retired' | 'unused' }

/** Every cluster directory under `data/db/`, with its role. */
export function listClusters(dbRoot: string): ClusterEntry[] {
  if (!existsSync(dbRoot)) return []
  const active = readActive(dbRoot)
  return readdirSync(dbRoot).filter((n) => /^[a-z]+-\d+$/.test(n) && existsSync(clusterPaths(clusterOf(dbRoot, n)).identity)).sort().map((name) => {
    const id = readIdentity(clusterOf(dbRoot, name))
    const state = name === active?.cluster ? 'active' : name === active?.previous?.cluster ? 'retired' : 'unused'
    return { name, build: id.build, state }
  })
}

/**
 * Delete every stopped cluster that is not active and not named by a journal (`box db prune`).
 * The retired cluster goes too: after this, rollback is a restore of a restore point.
 */
export async function pruneClusters(dbRoot: string): Promise<string[]> {
  await recoverMaintenance(dbRoot)
  const release = acquireMaintenance(dbRoot, 'prune')
  try {
    const active = readActive(dbRoot)
    const removed: string[] = []
    for (const c of listClusters(dbRoot)) {
      if (c.state === 'active') continue
      await discardCluster(dbRoot, c.name)
      removed.push(c.name)
    }
    if (active?.previous) {
      const { previous: _gone, ...rest } = active
      writeActive(dbRoot, rest)
    }
    return removed
  } finally { release() }
}
