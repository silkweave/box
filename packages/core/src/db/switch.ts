// Restore and engine switch (PHASE1.md "W7 design" items 4 and 5, R2 to R7): an offline maintenance
// operation that builds a fresh cluster from a restore point, validates it, and only then makes it
// active. The active cluster is never modified; a failure anywhere leaves it active.
//
// The operation journal `data/db/switch.json` is written (durably) before each mutation. Start-up
// (`recoverMaintenance`, first thing in openDatabase) settles an interrupted operation by one rule:
// `active.json` names the target with this operation id -> finish forward; names the source ->
// roll back; anything else -> refuse with the journal's path. Lock order: maintenance gate, schema
// lock, agents lock.
//
// Commit steps, each journalled before it starts: `commit` (every staged file set and the new
// configuration flushed to disk; swaps applied; active.json written), then `cleanup` (only the
// parked old files are removed). Recovery in `cleanup` never touches live files; recovery in
// `commit` re-applies swaps from each swap's recorded state, never from a missing path alone.

import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { BUILTIN_ROLES, knownAreas } from '../auth/roles.js'
import { agentIdentity, agentIdentityFrom, boxJson, boxJsonPath } from '../box-config.js'
import { readBoxConfig } from '../box-json.js'
import type { DatabaseEngine } from '../box-json.js'
import { configPath, configRoot, instanceDir } from '../io.js'
import { agentsDir, parseAgentFile } from '../agents.js'
import { captureAgentFilesFrom, interruptedAgentChange, parkedAgentsDir, stageAgentFiles, type AgentFiles } from '../warehouse/agent-snapshot.js'
import { prepareDatabase } from '../warehouse/pg/boot.js'
import { ensureClusterObjects, ensureDatabase, ensureDatabaseAcl, BOX_DATABASE, POLICY_LOGIN } from '../warehouse/pg/policy.js'
import { boxSchemaOwners } from '../warehouse/schema.js'
import { backupName, backupsDir, findRestorePoint, pruneBackupsQuietly, type BackupLabel } from '../warehouse/restore-points.js'
import {
  acquireMaintenance, clusterOf, clusterPaths, initCluster, lockHolder, maintenanceHolder, MaintenanceRunning, nextClusterName,
  OWNER_LOGIN, postmasterPid, readActive, readIdentity, startMaintenanceServer, stopServer, writeActive,
  type ActiveCluster, type RunningCluster,
} from './cluster.js'
import { fsyncDir, fsyncTree, replaceTextDurable, writeJsonDurable } from './durable.js'
import type { EngineInstall } from './engines.js'
import {
  compareSnapshots, readSnapshot, runClientTool, takeRestorePoint, toolsFor, validateRestorePoint,
  type RestorePointManifest, type Target, type ValidRestorePoint,
} from './restore-point.js'

const JOURNAL_FORMAT = 'box-db-operation/1'

export type OperationKind = 'restore' | 'switch'

export interface OperationJournal {
  format: typeof JOURNAL_FORMAT
  id: string
  kind: OperationKind
  step: string
  startedAt: string
  /** The cluster active when the operation started (null on a Box without one). */
  source: { cluster: string; engine: DatabaseEngine } | null
  target: { cluster: string; engine: DatabaseEngine }
  restorePoint: string
  /** Restore points retention and prune must keep while this journal exists. */
  pins: string[]
  /** File sets replaced at commit: `staged` goes to `live`, the old `live` to `parked`. */
  swaps: JournalSwap[]
  /** The effective configuration file and its text before and after (engine switch only). */
  config: { file: string; before: string; after: string } | null
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

export interface ResolveEngine { (engine: DatabaseEngine, cacheDir: string): Promise<EngineInstall> }

function journalPath(dbRoot: string): string { return join(dbRoot, 'switch.json') }

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
 * Settle an interrupted restore or switch. Runs before the engine check, fresh initialization,
 * boot and agent reconciliation. Refuses while the operation's own process is still alive.
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
    if (j.config && readFileSync(j.config.file, 'utf8') !== j.config.after) replaceTextDurable(j.config.file, j.config.after)
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
  if (j.config && existsSync(j.config.file) && readFileSync(j.config.file, 'utf8') !== j.config.before) replaceTextDurable(j.config.file, j.config.before)
  await discardCluster(dbRoot, j.target.cluster)
  clearJournal(dbRoot)
}

// ---- The workflow ----

function ownerClient(t: Target, database: string): pg.Client {
  const c = new pg.Client({ host: t.socket, port: t.port, user: OWNER_LOGIN, database })
  c.on('error', () => { /* surfaced by the next query */ })
  return c
}

async function withOwner<T>(t: Target, database: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = ownerClient(t, database)
  await c.connect()
  try { return await fn(c) } finally { await c.end().catch(() => {}) }
}

/** Derived (engine-specific) index entries stay out of a portable restore (rebuilt per engine). */
function portableList(list: string): string {
  return list.split('\n').filter((l) => !/ INDEX \S+ derived_/.test(l)).join('\n')
}

/**
 * Load a validated restore point into the fresh cluster at `t` (maintenance HBA), compare it with
 * the manifest BEFORE any forward migration (R6), then migrate, reconcile and check (R5). Throws
 * with every problem found.
 */
async function loadTarget(t: Target, point: ValidRestorePoint, tools: ReturnType<typeof toolsFor>, cluster: { dir: string; data: string }): Promise<string[]> {
  const scratch = cluster.dir
  const m = point.manifest
  const { core, features } = boxSchemaOwners()
  // Cluster objects first (they are not in the dump): the contract's, then any group or login the
  // restore point's grants name (a feature removed since keeps its group until reconciliation).
  await withOwner(t, 'postgres', async (c) => {
    await ensureClusterObjects(c, features.map((f) => f.id))
    for (const r of m.snapshot.clusterRoles) {
      if (!/^(area_[a-z0-9_]+_(read|write)|box_role_[1-9][0-9]*)$/.test(r.name)) throw new Error(`restore point names an invalid role ${r.name}`)
      if ((await c.query('select 1 from pg_roles where rolname = $1', [r.name])).rowCount) continue
      await c.query(`create role ${r.name} ${r.login ? 'login' : 'nologin'} nosuperuser nocreatedb nocreaterole noreplication nobypassrls`)
      if (!r.login) await c.query(`grant ${r.name} to ${POLICY_LOGIN} with admin true, inherit false, set false`)
    }
    await ensureDatabase(c, BOX_DATABASE)
  })
  const listFile = join(scratch, 'restore.list')
  const { stdout } = await runClientTool(tools, 'pg_restore', ['-l', point.dumpPath], 120_000)
  writeFileSync(listFile, portableList(stdout))
  await runClientTool(tools, 'pg_restore', ['-h', t.socket, '-p', String(t.port), '-U', OWNER_LOGIN, '-d', BOX_DATABASE,
    '--exit-on-error', '--single-transaction', '-L', listFile, point.dumpPath], 60 * 60_000)
  // Database-level settings are ours, never the dump's (R7).
  await withOwner(t, BOX_DATABASE, (c) => ensureDatabaseAcl(c, m.snapshot.roleLogins.map((l) => l.login)))

  const restored = await withOwner(t, BOX_DATABASE, async (c) => {
    await c.query('begin isolation level repeatable read read only')
    try { return await readSnapshot(c) } finally { await c.query('rollback') }
  })
  const problems = compareSnapshots(m.snapshot, restored)
  if (problems.length) return problems

  await prepareDatabase(t, {
    core, features,
    builtinRoles: BUILTIN_ROLES.map((r) => ({ id: r.id, default: r.default, areas: r.areas })),
    knownAreas: knownAreas(),
    // The normal-mode files the next boot will use (the maintenance HBA is passed by path, so the
    // cluster's own pg_hba.conf and pg_ident.conf are the ones checked here).
    checkFiles: { dataDir: cluster.data, socketDir: t.socket },
  })
  return []
}

/**
 * Admission of the target before activation (no live state used): the agent files that will be
 * live after the commit must parse, name roles the restored database has, and not name a person;
 * the configured system agent's role must exist there too.
 */
async function admissionProblems(t: Target, files: AgentFiles, system: { id: string; role: string } | { problem: string }): Promise<string[]> {
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
  /** Restore point name (backups/db or seeds) or an absolute directory; null for a switch, which
   *  restores the dump it takes of the active cluster. */
  point: string | null
  /** Engine of the new cluster; default `box.json` `database.engine`. */
  engine?: DatabaseEngine
  kind?: OperationKind
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
  const kind = o.kind ?? 'restore'
  const release = acquireMaintenance(dbRoot, kind)
  const crash = (step: string) => { if (o.crashAfter === step) throw Object.assign(new Error(`injected crash after ${step}`), { injected: true }) }
  let journal: OperationJournal | null = null
  let target: RunningCluster | null = null
  try {
    const interrupted = interruptedAgentChange()
    if (interrupted) throw new Error(`${kind} refused: ${interrupted}`)
    const engine = o.engine ?? boxJson().database.engine
    const active = readActive(dbRoot)
    if (o.point === null && !active) throw new Error('nothing to switch: this Box has no database yet')
    const targetName = nextClusterName(dbRoot, engine)
    const targetCluster = clusterOf(dbRoot, targetName)
    const targetInstall = await o.resolveEngine(engine, clusterPaths(targetCluster).cache)
    const validate = async (dir: string) => {
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as RestorePointManifest
      const tools = toolsFor(manifest.source?.major ?? targetInstall.major, targetInstall.major)
      const point = await validateRestorePoint(dir, tools)
      if (!o.identityFromBackup) checkSystemAgent(point)
      return { point, tools }
    }
    // A restore validates its point in full before anything changes.
    let checked = o.point === null ? null : await validate(resolvePointDir(o.point))

    const id = randomUUID()
    journal = {
      format: JOURNAL_FORMAT, id, kind, step: 'park', startedAt: new Date().toISOString(),
      source: active ? { cluster: active.cluster, engine: active.engine } : null,
      target: { cluster: targetName, engine },
      restorePoint: checked?.point.dir ?? '(the switch dump)', pins: checked ? [checked.point.manifest.name] : [], swaps: [], config: null, expectedActive: null,
    }
    writeJournal(dbRoot, journal)

    // Park the active cluster as a restore point first (R4: under the maintenance HBA).
    let parked: string | null = null
    if (active) {
      const src = clusterOf(dbRoot, active.cluster)
      const srcInstall = await o.resolveEngine(active.engine, clusterPaths(src).cache)
      const running = await startMaintenanceServer(src, srcInstall)
      try {
        const label: BackupLabel = kind === 'switch' ? 'pre-switch' : 'pre-restore'
        const name = backupName(label)
        journal = { ...journal, pins: [...journal.pins, name] }
        writeJournal(dbRoot, journal)
        // Test seam: real process death while the source runs under the maintenance HBA.
        if (o.crashAfter === 'kill-in-park') process.kill(process.pid, 'SIGKILL')
        await takeRestorePoint({ target: running, parent: backupsDir(), name, label, source: { cluster: active.cluster, identity: readIdentity(src) } })
        parked = name
        log(`parked ${active.cluster} as ${name}`)
      } finally { await running.release() }
    }
    crash('park')
    if (!checked) checked = await validate(join(backupsDir(), parked!))
    const { point, tools } = checked

    journal = { ...journal, step: 'target' }
    writeJournal(dbRoot, journal)
    const identity = await initCluster(targetCluster, targetInstall)
    target = await startMaintenanceServer(targetCluster, targetInstall)
    crash('target')
    journal = { ...journal, step: 'load' }
    writeJournal(dbRoot, journal)
    const problems = await loadTarget(target, point, tools, { dir: targetCluster.dir, data: clusterPaths(targetCluster).data })
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
    const config = kind === 'switch' ? engineConfigChange(engine) : null
    const expectedActive: ActiveCluster = {
      cluster: targetName, engine, build: identity.build, version: identity.version, pgvector: identity.pgvector,
      activated: new Date().toISOString(), operation: id,
      ...(active ? { previous: { cluster: active.cluster, engine: active.engine, retired: new Date().toISOString() } } : {}),
    }
    journal = { ...journal, step: 'commit', swaps, config, expectedActive }
    writeJournal(dbRoot, journal)
    for (const w of swaps) applySwap(w)
    if (config) replaceTextDurable(config.file, config.after)
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
    const summary = `${kind === 'switch' ? 'switched to' : 'restored'} ${point.manifest.name} into ${targetName} (${engine}); ` +
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

/** The effective config file for `database.engine` and its text after the switch (R2). */
function engineConfigChange(engine: DatabaseEngine): OperationJournal['config'] {
  const local = join(configRoot(), 'box.local.json')
  const sets = (file: string) => {
    if (!existsSync(file)) return false
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { database?: { engine?: unknown } }
    return typeof raw.database?.engine === 'string'
  }
  const file = sets(local) ? local : boxJsonPath()
  const before = readFileSync(file, 'utf8')
  const raw = JSON.parse(before) as Record<string, unknown>
  raw.database = { ...(raw.database as object | undefined), engine }
  return { file, before, after: `${JSON.stringify(raw, null, 2)}\n` }
}

// ---- Clusters on disk ----

export interface ClusterEntry { name: string; engine: string; build: string; state: 'active' | 'retired' | 'unused' }

/** Every cluster directory under `data/db/`, with its role. */
export function listClusters(dbRoot: string): ClusterEntry[] {
  if (!existsSync(dbRoot)) return []
  const active = readActive(dbRoot)
  return readdirSync(dbRoot).filter((n) => /^[a-z]+-\d+$/.test(n) && existsSync(clusterPaths(clusterOf(dbRoot, n)).identity)).sort().map((name) => {
    const id = readIdentity(clusterOf(dbRoot, name))
    const state = name === active?.cluster ? 'active' : name === active?.previous?.cluster ? 'retired' : 'unused'
    return { name, engine: id.engine, build: id.build, state }
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
