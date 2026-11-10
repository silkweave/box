import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/**
 * HTTP-agnostic Builder lifecycle. This module deliberately has no Nest, WorkerDeck, warehouse,
 * or browser imports. The supervisor and the HTTP controller can both call it with the same paths.
 * `data/builder/control.json` and `data/builder/runner/` are control-plane state; they are kept out
 * of Builder instance backups so a restore cannot resurrect a stale process/session authority.
 */

export interface BuilderLifecyclePaths {
  repoRoot: string
  instanceDir: string
}

export interface BuilderSessionState {
  id: string
  status?: string
  startedAt: string
}

export interface BuilderBackupFile {
  path: string
  bytes: number
  sha256: string
  mode: number
}

/** Files outside the instance dir, kept in an explicit manifest namespace. */
export interface BuilderBackupConfig {
  files: BuilderBackupFile[]
}

export interface BuilderBackupManifest {
  version: 1
  id: string
  createdAt: string
  reason: string
  /** The live checkout revision at the instant the offline copy was taken. */
  codebaseSHA: string
  branch: string | null
  files: BuilderBackupFile[]
  /** Root checkout configuration, currently box.json and optional box.local.json. */
  config?: BuilderBackupConfig
  /** The database restore point (`root-database/`: box.dump, agents.json, manifest.json). */
  database?: BuilderBackupConfig
}

export interface BuilderBackupSummary {
  id: string
  createdAt: string
  reason: string
  codebaseSHA: string
  branch: string | null
  bytes: number
}

export interface BuilderControlState {
  version: 1
  session: BuilderSessionState | null
  branch: string | null
  baseRevision: string | null
  /** The branch that was checked out before Builder created its live branch. */
  integrationBranch: string | null
  /** The integration branch tip captured at start, then advanced by successful Builder finishes. */
  integrationRevision: string | null
  backups: BuilderBackupSummary[]
  updatedAt: string
}

export type WithAppStopped = <T>(operation: () => Promise<T> | T) => Promise<T>

/** One file set a restore commit replaces (core's db/switch.ts FileSwap, structurally). */
export interface BuilderFileSwap { live: string; staged: string; parked: string; hadLive: boolean }

/**
 * The database side of Builder backups, supplied by the supervisor that owns the cluster (this
 * module stays free of database imports). `dump` writes a database restore point into `dir`;
 * `restore` builds a fresh cluster from one and commits it together with the staged file sets
 * under one operation journal, so a crash anywhere settles forward or back as a whole.
 */
export interface BuilderDatabasePort {
  dump(dir: string): Promise<void>
  restore(input: { point: string; engine: 'pgrust' | 'native'; stageFiles: (id: string) => BuilderFileSwap[] }): Promise<void>
}

export interface BuilderOperationOptions {
  paths: BuilderLifecyclePaths
  /** Present in the supervisor: Builder backups carry the database and restores go through it. */
  database?: BuilderDatabasePort
  withAppStopped?: WithAppStopped
  /** Explicit fixture/host contract for callers that have already stopped the app. */
  offline?: true
  now?: () => Date
}

export interface BuilderStartResult {
  state: BuilderControlState
  backup: BuilderBackupManifest
  createdBranch: boolean
}

/** Uncommitted source changes a new Builder session would adopt onto its live branch. */
export interface BuilderPendingChanges {
  /** Null when the checkout is clean. Pass it back to `startBuilder` to confirm adoption. */
  fingerprint: string | null
  files: Array<{ path: string; status: string }>
  truncated: boolean
}

export interface BuilderStartOptions extends BuilderOperationOptions {
  /** Fingerprint of the pending changes the caller confirmed adopting into the Builder branch. */
  adoptChanges?: string
}

export interface BuilderRestoreResult {
  state: BuilderControlState
  restored: BuilderBackupManifest
  safetyBackup: BuilderBackupManifest
}

export class BuilderLifecycleError extends Error {
  constructor(public readonly statusCode: 400 | 404 | 409 | 503, message: string) {
    super(message)
    this.name = 'BuilderLifecycleError'
  }
}

const CONTROL_VERSION = 1 as const
const GIT_TIMEOUT_MS = 15_000
const MAX_BACKUPS_IN_STATE = 32
/** Builder backups copy the whole instance (hundreds of MB each), so disk keeps the newest few per reason. */
const BACKUPS_KEPT_PER_REASON = 3
/** `db` holds the live database clusters (the supervisor keeps them running while the app is
 *  stopped) and `engines` the disposable pgrust unpack: neither is ever copied or deleted as files. */
const EXCLUDED_TOP_LEVEL = new Set(['backups', 'seeds', 'builder', 'db', 'engines'])

let mutexTail: Promise<void> = Promise.resolve()

/** One process-wide lock serializes branch switches, offline snapshots and restores. */
export async function withBuilderMutex<T>(operation: () => Promise<T>): Promise<T> {
  const previous = mutexTail
  let release!: () => void
  mutexTail = new Promise<void>((resolveRelease) => { release = resolveRelease })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

export function builderControlPath(paths: BuilderLifecyclePaths): string {
  return resolve(paths.instanceDir, 'builder', 'control.json')
}

export function builderBackupRoot(paths: BuilderLifecyclePaths): string {
  return resolve(paths.instanceDir, 'backups', 'builder')
}

export function builderRunnerRoot(paths: BuilderLifecyclePaths): string {
  return resolve(paths.instanceDir, 'builder', 'runner')
}

const nowIso = (options: Pick<BuilderOperationOptions, 'now'>): string => (options.now ?? (() => new Date()))().toISOString()

const defaultState = (now: string): BuilderControlState => ({
  version: CONTROL_VERSION,
  session: null,
  branch: null,
  baseRevision: null,
  integrationBranch: null,
  integrationRevision: null,
  backups: [],
  updatedAt: now,
})

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isSha = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{40,64}$/i.test(value)
const isGitBranch = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 255 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) && !value.includes('..') && !value.includes('@{') && !value.endsWith('/') && !value.endsWith('.')
const isSafeId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)
const isRelativeFile = (value: unknown): value is string => {
  if (typeof value !== 'string' || !value || isAbsolute(value)) return false
  const normalized = value.replaceAll('\\', '/')
  return normalized !== '.' && normalized !== '..' && !normalized.startsWith('../') && !normalized.includes('/../') && !normalized.includes('/./')
}

const parseState = (value: unknown): BuilderControlState => {
  if (!isRecord(value) || value.version !== CONTROL_VERSION || !Array.isArray(value.backups)) throw new BuilderLifecycleError(503, 'Builder control state is invalid')
  const session = value.session
  if (session !== null && (!isRecord(session) || !isSafeId(session.id) || typeof session.startedAt !== 'string')) throw new BuilderLifecycleError(503, 'Builder control session is invalid')
  // Version 1 state written by older supervisors may carry a driver. Accept and discard it so an
  // upgrade removes the obsolete exclusive-control identity on the next write.
  if (value.driver !== undefined && value.driver !== null && (!isRecord(value.driver) || !isSafeId(value.driver.id) || typeof value.driver.display !== 'string')) throw new BuilderLifecycleError(503, 'Builder control legacy driver is invalid')
  if (value.branch !== null && (typeof value.branch !== 'string' || !/^builder\/live\/[a-zA-Z0-9][a-zA-Z0-9._-]{7,80}$/.test(value.branch))) throw new BuilderLifecycleError(503, 'Builder control branch is invalid')
  if (value.baseRevision !== null && !isSha(value.baseRevision)) throw new BuilderLifecycleError(503, 'Builder control base revision is invalid')
  if ((value.branch === null) !== (value.baseRevision === null)) throw new BuilderLifecycleError(503, 'Builder control branch and base revision must be paired')
  if (session !== null && value.branch === null) throw new BuilderLifecycleError(503, 'Builder control session is missing its branch')
  const integrationBranch = value.integrationBranch === undefined ? null : value.integrationBranch
  const integrationRevision = value.integrationRevision === undefined ? null : value.integrationRevision
  if (integrationBranch !== null && !isGitBranch(integrationBranch)) throw new BuilderLifecycleError(503, 'Builder control integration branch is invalid')
  if (integrationRevision !== null && !isSha(integrationRevision)) throw new BuilderLifecycleError(503, 'Builder control integration revision is invalid')
  if ((integrationBranch === null) !== (integrationRevision === null)) throw new BuilderLifecycleError(503, 'Builder control integration branch and revision must be paired')
  if (typeof value.updatedAt !== 'string') throw new BuilderLifecycleError(503, 'Builder control state is invalid')
  const { driver: _legacyDriver, ...state } = value
  return { ...state, integrationBranch, integrationRevision } as unknown as BuilderControlState
}

export function readBuilderControl(paths: BuilderLifecyclePaths, now = new Date()): BuilderControlState {
  const file = builderControlPath(paths)
  if (!existsSync(file)) return defaultState(now.toISOString())
  try {
    return parseState(JSON.parse(readFileSync(file, 'utf8')))
  } catch (error) {
    if (error instanceof BuilderLifecycleError) throw error
    throw new BuilderLifecycleError(503, `Builder control state is unreadable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function writeBuilderControl(paths: BuilderLifecyclePaths, state: BuilderControlState): BuilderControlState {
  const parsed = parseState(state)
  const target = builderControlPath(paths)
  mkdirSync(resolve(paths.instanceDir, 'builder'), { recursive: true })
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temp, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, target)
  return parsed
}

const runGit = (paths: BuilderLifecyclePaths, args: string[], maxBuffer = 2 * 1024 * 1024): string => {
  try {
    return execFileSync('git', ['-C', paths.repoRoot, ...args], {
      encoding: 'utf8',
      maxBuffer,
      timeout: GIT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd()
  } catch (error) {
    const detail = error as { stderr?: Buffer | string }
    const stderr = detail.stderr ? String(detail.stderr).trim() : ''
    throw new BuilderLifecycleError(503, `git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`)
  }
}

const gitSHA = (paths: BuilderLifecyclePaths): string => {
  const sha = runGit(paths, ['rev-parse', 'HEAD'])
  if (!isSha(sha)) throw new BuilderLifecycleError(503, 'Git returned an invalid codebase revision')
  return sha
}

const gitBranch = (paths: BuilderLifecyclePaths): string => runGit(paths, ['branch', '--show-current'])
const gitStatus = (paths: BuilderLifecyclePaths): string => runGit(paths, ['status', '--porcelain=v1', '--untracked-files=all'])

const integrationBranch = (paths: BuilderLifecyclePaths): string | null => {
  const current = gitBranch(paths)
  if (current) return current
  try {
    const remoteHead = runGit(paths, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
    const slash = remoteHead.indexOf('/')
    const candidate = slash >= 0 ? remoteHead.slice(slash + 1) : ''
    if (isGitBranch(candidate)) {
      try {
        runGit(paths, ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`])
        return candidate
      } catch { /* origin/HEAD may exist before a local integration branch is created */ }
    }
  } catch { /* a repository without origin/HEAD can still have a main or master branch */ }
  for (const candidate of ['main', 'master']) {
    try {
      runGit(paths, ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`])
      return candidate
    } catch { /* try the next conventional default */ }
  }
  return null
}

const integrationRevision = (paths: BuilderLifecyclePaths, branch: string | null): string | null => {
  if (!branch) return null
  try {
    const revision = runGit(paths, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`])
    return isSha(revision) ? revision : null
  } catch { return null }
}

const ensureClean = (paths: BuilderLifecyclePaths): void => {
  if (gitStatus(paths)) throw new BuilderLifecycleError(409, 'Builder requires a clean live checkout; commit or stash pending changes first')
}

const MAX_PENDING_FILES = 500

const pendingChanges = (paths: BuilderLifecyclePaths): BuilderPendingChanges & { status: string } => {
  const status = runGit(paths, ['status', '--porcelain=v1', '--untracked-files=all', '-z'])
  if (!status) return { status, fingerprint: null, files: [], truncated: false }
  const tokens = status.split('\0').filter(Boolean)
  const files: BuilderPendingChanges['files'] = []
  for (let index = 0; index < tokens.length; index++) {
    const entry = tokens[index]
    const code = entry.slice(0, 2)
    files.push({ path: entry.slice(3), status: code.trim() || code })
    // Renames and copies carry their source path as the following NUL-separated token.
    if (code[0] === 'R' || code[0] === 'C') index++
  }
  const fingerprint = createHash('sha256').update(['builder-adopt-v1', gitSHA(paths), gitBranch(paths), status].join('\0')).digest('hex')
  return { status, fingerprint, files: files.slice(0, MAX_PENDING_FILES), truncated: files.length > MAX_PENDING_FILES }
}

/** List uncommitted changes that starting Builder would carry onto its live branch. */
export function readBuilderPendingChanges(paths: BuilderLifecyclePaths): BuilderPendingChanges {
  const { status: _status, ...changes } = pendingChanges(paths)
  return changes
}

/** A dirty checkout is only accepted when the caller confirmed exactly the current change set. */
const ensureAdoptable = (paths: BuilderLifecyclePaths, adoptChanges: string | undefined): void => {
  const { fingerprint } = pendingChanges(paths)
  if (!fingerprint) return
  if (!adoptChanges) throw new BuilderLifecycleError(409, 'The live checkout has uncommitted changes; confirm adopting them into the Builder branch')
  if (adoptChanges !== fingerprint) throw new BuilderLifecycleError(409, 'Uncommitted changes changed since they were confirmed; review them again before starting Builder')
}

const withOfflineApp = async <T>(options: BuilderOperationOptions, operation: () => Promise<T> | T): Promise<T> =>
  options.withAppStopped
    ? options.withAppStopped(operation)
    : options.offline === true
      ? await operation()
      : Promise.reject(new BuilderLifecycleError(409, 'Builder backup requires withAppStopped; pass offline:true only when the application is already stopped'))

const summaryOf = (manifest: BuilderBackupManifest): BuilderBackupSummary => ({
  id: manifest.id,
  createdAt: manifest.createdAt,
  reason: manifest.reason,
  codebaseSHA: manifest.codebaseSHA,
  branch: manifest.branch,
  bytes: [...manifest.files, ...(manifest.config?.files ?? [])].reduce((sum, file) => sum + file.bytes, 0),
})

const appendBackup = (state: BuilderControlState, manifest: BuilderBackupManifest, updatedAt: string): BuilderControlState => ({
  ...state,
  backups: [...state.backups, summaryOf(manifest)].slice(-MAX_BACKUPS_IN_STATE),
  updatedAt,
})

/**
 * Keep the newest BACKUPS_KEPT_PER_REASON backups per reason (start, checkpoint, pre-restore, ...)
 * and delete the rest from disk, including directories the control state no longer lists. Writes
 * the pruned state first, so a directory that cannot be removed is only an orphan the next prune
 * sweeps. Removal failures are swallowed: a full disk must not block a Builder start or backup.
 * Never called by restore, which could otherwise delete the point it is restoring from.
 */
const pruneBackups = (paths: BuilderLifecyclePaths, state: BuilderControlState): BuilderControlState => {
  try {
    return applyRetention(paths, state)
  } catch {
    return state
  }
}

const applyRetention = (paths: BuilderLifecyclePaths, state: BuilderControlState): BuilderControlState => {
  const root = builderBackupRoot(paths)
  const candidates = new Map<string, { id: string; createdAt: string; reason: string }>()
  for (const backup of state.backups) candidates.set(backup.id, backup)
  if (existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isSafeId(entry.name) || candidates.has(entry.name)) continue
      try {
        const manifest = JSON.parse(readFileSync(join(root, entry.name, 'manifest.json'), 'utf8')) as unknown
        if (isRecord(manifest) && manifest.id === entry.name && typeof manifest.createdAt === 'string' && typeof manifest.reason === 'string') {
          candidates.set(entry.name, { id: entry.name, createdAt: manifest.createdAt, reason: manifest.reason })
        }
      } catch { /* not a completed Builder backup: leave it alone */ }
    }
  }
  const keep = new Set<string>()
  const byReason = new Map<string, Array<{ id: string; createdAt: string }>>()
  for (const candidate of candidates.values()) byReason.set(candidate.reason, [...(byReason.get(candidate.reason) ?? []), candidate])
  for (const group of byReason.values()) {
    group.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    for (const backup of group.slice(0, BACKUPS_KEPT_PER_REASON)) keep.add(backup.id)
  }
  const pruned = writeBuilderControl(paths, { ...state, backups: state.backups.filter((backup) => keep.has(backup.id)) })
  for (const id of candidates.keys()) {
    if (keep.has(id)) continue
    try { rmSync(resolve(root, id), { recursive: true, force: true }) } catch { /* swept by the next prune */ }
  }
  return pruned
}

const relativeSafe = (root: string, candidate: string): string => {
  const rel = relative(root, candidate)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new BuilderLifecycleError(503, 'Builder backup path escaped its root')
  return rel
}

/** Reject symlinked ancestors as well as symlinked leaves before a backup or restore touches them. */
const assertNoSymlinkAncestors = (root: string, candidate: string): void => {
  const rootAbsolute = resolve(root)
  const candidateAbsolute = resolve(candidate)
  const rel = relative(rootAbsolute, candidateAbsolute)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new BuilderLifecycleError(503, 'Builder backup path escaped its root')
  let current = rootAbsolute
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = join(current, segment)
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new BuilderLifecycleError(409, `Builder refuses symbolic-link path ${relative(rootAbsolute, current)}`)
  }
}

const shouldExclude = (relativePath: string): boolean => {
  const normalized = relativePath.replaceAll('\\', '/')
  const first = normalized.split('/')[0]
  return EXCLUDED_TOP_LEVEL.has(first) || first.startsWith('.builder-')
}

const collectFiles = (root: string, current = root): string[] => {
  if (!existsSync(current)) return []
  const stat = lstatSync(current)
  if (stat.isSymbolicLink()) throw new BuilderLifecycleError(409, `Builder refuses symbolic-link instance path ${relative(root, current) || '.'}`)
  if (stat.isFile()) return [current]
  if (!stat.isDirectory()) return []
  const files: string[] = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const next = join(current, entry.name)
    const rel = relative(root, next)
    if (shouldExclude(rel)) continue
    files.push(...collectFiles(root, next))
  }
  return files
}

const sha256File = async (path: string): Promise<string> => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

const fileEntry = async (root: string, path: string): Promise<BuilderBackupFile> => {
  const stat = statSync(path)
  return { path: relativeSafe(root, path), bytes: stat.size, sha256: await sha256File(path), mode: stat.mode & 0o777 }
}

const validateManifestShape = (manifest: unknown, expectedId?: string): BuilderBackupManifest => {
  if (!isRecord(manifest) || manifest.version !== 1 || !isSafeId(manifest.id) || (expectedId && manifest.id !== expectedId) ||
      typeof manifest.createdAt !== 'string' || typeof manifest.reason !== 'string' || !isSha(manifest.codebaseSHA) ||
      (manifest.branch !== null && typeof manifest.branch !== 'string') || !Array.isArray(manifest.files) ||
      (manifest.config !== undefined && (!isRecord(manifest.config) || !Array.isArray(manifest.config.files))) ||
      (manifest.database !== undefined && (!isRecord(manifest.database) || !Array.isArray(manifest.database.files)))) {
    throw new BuilderLifecycleError(503, 'Builder backup manifest is invalid')
  }
  const files = manifest.files as unknown[]
  const configFiles = manifest.config && isRecord(manifest.config) ? manifest.config.files as unknown[] : []
  const databaseFiles = manifest.database && isRecord(manifest.database) ? manifest.database.files as unknown[] : []
  const seen = new Set<string>()
  const validateEntries = (entries: unknown[], namespace: 'instance' | 'config' | 'database'): void => {
    for (const entry of entries) {
      const pathKey = `${namespace}:${isRecord(entry) ? String(entry.path) : ''}`
      if (!isRecord(entry) || !isRelativeFile(entry.path) || seen.has(pathKey) ||
          (namespace === 'config' && entry.path !== 'box.json' && entry.path !== 'box.local.json') ||
          (namespace === 'database' && !['box.dump', 'agents.json', 'manifest.json'].includes(String(entry.path))) ||
          typeof entry.bytes !== 'number' || entry.bytes < 0 || !Number.isSafeInteger(entry.bytes) || !isSha(entry.sha256) || typeof entry.mode !== 'number' || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) {
        throw new BuilderLifecycleError(503, 'Builder backup manifest contains an invalid file entry')
      }
      if (namespace === 'instance' && shouldExclude(entry.path)) throw new BuilderLifecycleError(503, 'Builder backup manifest includes a control-plane path')
      seen.add(pathKey)
    }
  }
  validateEntries(files, 'instance')
  validateEntries(configFiles, 'config')
  validateEntries(databaseFiles, 'database')
  return manifest as unknown as BuilderBackupManifest
}

const readManifest = (paths: BuilderLifecyclePaths, id: string): { manifest: BuilderBackupManifest; directory: string } => {
  if (!isSafeId(id)) throw new BuilderLifecycleError(400, 'invalid Builder backup id')
  const root = builderBackupRoot(paths)
  let rootReal: string
  try { rootReal = existsSync(root) ? realpathSync(root) : root } catch { rootReal = root }
  const directory = resolve(rootReal, id)
  if (relative(rootReal, directory).startsWith(`..${sep}`)) throw new BuilderLifecycleError(404, 'Builder backup not found')
  const file = join(directory, 'manifest.json')
  if (!existsSync(file)) throw new BuilderLifecycleError(404, 'Builder backup not found')
  try {
    if (realpathSync(directory) !== directory) throw new BuilderLifecycleError(404, 'Builder backup not found')
  } catch (error) {
    if (error instanceof BuilderLifecycleError) throw error
    throw new BuilderLifecycleError(404, 'Builder backup not found')
  }
  try {
    const manifest = validateManifestShape(JSON.parse(readFileSync(file, 'utf8')), id)
    for (const entry of manifest.files) {
      const source = resolve(directory, entry.path)
      assertNoSymlinkAncestors(directory, source)
      if (relative(directory, source).startsWith(`..${sep}`) || !existsSync(source) || !lstatSync(source).isFile()) throw new BuilderLifecycleError(503, `Builder backup file is missing: ${entry.path}`)
    }
    for (const [sub, entries] of [['root-config', manifest.config?.files ?? []], ['root-database', manifest.database?.files ?? []]] as const) {
      for (const entry of entries) {
        const source = resolve(directory, sub, entry.path)
        assertNoSymlinkAncestors(directory, source)
        if (relative(directory, source).startsWith(`..${sep}`) || !existsSync(source) || !lstatSync(source).isFile()) throw new BuilderLifecycleError(503, `Builder backup ${sub} file is missing: ${entry.path}`)
      }
    }
    return { manifest, directory }
  } catch (error) {
    if (error instanceof BuilderLifecycleError) throw error
    throw new BuilderLifecycleError(503, `Builder backup manifest is unreadable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const validateBackupFiles = async (manifest: BuilderBackupManifest, directory: string): Promise<void> => {
  for (const entry of manifest.files) {
    const path = resolve(directory, entry.path)
    const stat = statSync(path)
    if (stat.size !== entry.bytes || await sha256File(path) !== entry.sha256) throw new BuilderLifecycleError(503, `Builder backup failed validation: ${entry.path}`)
  }
  for (const [sub, entries] of [['root-config', manifest.config?.files ?? []], ['root-database', manifest.database?.files ?? []]] as const) {
    for (const entry of entries) {
      const path = resolve(directory, sub, entry.path)
      const stat = statSync(path)
      if (stat.size !== entry.bytes || await sha256File(path) !== entry.sha256) throw new BuilderLifecycleError(503, `Builder backup ${sub} failed validation: ${entry.path}`)
    }
  }
}

const createBackup = async (options: BuilderOperationOptions, reason: string): Promise<BuilderBackupManifest> => {
  const { paths } = options
  const id = randomUUID()
  const createdAt = nowIso(options)
  const directory = resolve(builderBackupRoot(paths), id)
  const codebaseSHA = gitSHA(paths)
  const branch = gitBranch(paths) || null
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const files: BuilderBackupFile[] = []
    const instanceFiles = collectFiles(paths.instanceDir)
    // The app is stopped, so every SQLite store is closed: a non-empty WAL means a writer is still
    // open (or died) and a file copy would miss its commits.
    const openWal = instanceFiles.filter((file) => file.endsWith('-wal') && statSync(file).size > 0)
    if (openWal.length) throw new BuilderLifecycleError(409, `Builder backup refused: SQLite stores still open (${openWal.map((file) => relative(paths.instanceDir, file)).join(', ')})`)
    for (const source of instanceFiles) {
      const rel = relativeSafe(paths.instanceDir, source)
      const destination = resolve(directory, rel)
      mkdirSync(resolve(destination, '..'), { recursive: true })
      copyFileSync(source, destination)
      chmodSync(destination, statSync(source).mode & 0o777)
      files.push(await fileEntry(paths.instanceDir, source))
    }
    files.sort((a, b) => a.path.localeCompare(b.path))
    const configFiles: BuilderBackupFile[] = []
    for (const name of ['box.json', 'box.local.json']) {
      const source = join(paths.repoRoot, name)
      if (!existsSync(source)) continue
      assertNoSymlinkAncestors(paths.repoRoot, source)
      const destination = resolve(directory, 'root-config', name)
      mkdirSync(resolve(destination, '..'), { recursive: true })
      copyFileSync(source, destination)
      chmodSync(destination, statSync(source).mode & 0o777)
      configFiles.push(await fileEntry(paths.repoRoot, source))
    }
    configFiles.sort((a, b) => a.path.localeCompare(b.path))
    let database: BuilderBackupConfig | undefined
    if (options.database) {
      const dumpDir = resolve(directory, 'root-database')
      await options.database.dump(dumpDir)
      database = { files: await Promise.all(['box.dump', 'agents.json', 'manifest.json'].map((name) => fileEntry(dumpDir, join(dumpDir, name)))) }
    }
    const manifest: BuilderBackupManifest = { version: 1, id, createdAt, reason, codebaseSHA, branch, files, config: { files: configFiles }, ...(database ? { database } : {}) }
    writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await validateBackupFiles(manifest, directory)
    return manifest
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    if (error instanceof BuilderLifecycleError) throw error
    throw new BuilderLifecycleError(503, `Builder backup failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Take an offline, hashed copy of the complete instance state except restore/control domains. */
export async function backupBuilder(options: BuilderOperationOptions): Promise<BuilderBackupManifest>
export async function backupBuilder(reason: string, options: BuilderOperationOptions): Promise<BuilderBackupManifest>
export async function backupBuilder(reasonOrOptions: string | BuilderOperationOptions, suppliedOptions?: BuilderOperationOptions): Promise<BuilderBackupManifest> {
  const reason = typeof reasonOrOptions === 'string' ? reasonOrOptions : 'checkpoint'
  const options = typeof reasonOrOptions === 'string' ? suppliedOptions : reasonOrOptions
  if (!options) throw new BuilderLifecycleError(400, 'Builder backup paths are required')
  return withBuilderMutex(async () => {
    return withOfflineApp(options, async () => {
      const manifest = await createBackup(options, reason)
      const current = readBuilderControl(options.paths)
      pruneBackups(options.paths, writeBuilderControl(options.paths, appendBackup(current, manifest, nowIso(options))))
      return manifest
    })
  })
}

export const checkpointBuilder = backupBuilder

/** Start the one shared live-checkout Builder session. A dirty checkout is adopted only when
 * `adoptChanges` matches `readBuilderPendingChanges`. The actual WorkerDeck session is recorded
 * separately with `recordBuilderSession`, after the caller has successfully created it. */
export async function startBuilder(options: BuilderStartOptions): Promise<BuilderStartResult> {
  return withBuilderMutex(async () => {
    const current = readBuilderControl(options.paths)
    if (current.session) throw new BuilderLifecycleError(409, 'Builder already has an active shared session')
    // Confirmed uncommitted work is carried onto the new branch by `git switch -c`; the review
    // then presents it as pending Builder work against the unchanged base revision.
    ensureAdoptable(options.paths, options.adoptChanges)
    const revision = gitSHA(options.paths)
    const currentBranch = gitBranch(options.paths)
    if (current.branch && currentBranch !== current.branch) throw new BuilderLifecycleError(409, `Builder branch ${current.branch} is not checked out`)
    const backup = await withOfflineApp(options, async () => {
      const snapshot = await createBackup(options, 'start')
      writeBuilderControl(options.paths, appendBackup(current, snapshot, nowIso(options)))
      return snapshot
    })
    let branch = current.branch
    let baseRevision = current.baseRevision
    const capturedTargetBranch = current.integrationBranch ?? (!current.branch ? (currentBranch || integrationBranch(options.paths)) : null)
    const capturedTargetRevision = integrationRevision(options.paths, capturedTargetBranch)
    let targetBranch = current.integrationBranch ?? capturedTargetBranch
    let targetRevision = current.integrationRevision ?? capturedTargetRevision
    let createdBranch = false
    try {
      if (!branch) {
        branch = `builder/live/${nowIso(options).replace(/[^0-9]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`
        try {
          runGit(options.paths, ['switch', '-c', branch])
        } catch (error) {
          throw new BuilderLifecycleError(409, `Builder could not create its live branch: ${error instanceof Error ? error.message : String(error)}`)
        }
        baseRevision = revision
        targetBranch = capturedTargetBranch
        targetRevision = capturedTargetRevision
        createdBranch = true
      }
      const state = appendBackup({
        ...current,
        session: null,
        branch,
        baseRevision,
        integrationBranch: targetBranch,
        integrationRevision: targetRevision,
        }, backup, nowIso(options))
      writeBuilderControl(options.paths, state)
      return { state: pruneBackups(options.paths, state), backup, createdBranch }
    } catch (error) {
      // A failed state write must not strand a newly-created live branch. Both branches share one
      // revision, so switching back carries any adopted changes with it; a detached source is
      // restored to its original revision.
      if (createdBranch && branch) {
        try {
          if (currentBranch) runGit(options.paths, ['switch', currentBranch])
          else runGit(options.paths, ['switch', '--detach', revision])
        } catch { /* preserve the lifecycle error; host recovery can still find the branch */ }
        try { runGit(options.paths, ['branch', '-D', branch]) } catch { /* preserve the lifecycle error */ }
      }
      throw error
    }
  })
}

export async function recordBuilderSession(session: BuilderSessionState, options: BuilderOperationOptions): Promise<BuilderControlState> {
  return withBuilderMutex(async () => {
    const current = readBuilderControl(options.paths)
    if (!current.branch) throw new BuilderLifecycleError(409, 'Builder has not been started')
    if (current.session && current.session.id !== session.id) throw new BuilderLifecycleError(409, 'Builder already has an active shared session')
    return writeBuilderControl(options.paths, { ...current, session, updatedAt: nowIso(options) })
  })
}

/** End the shared session while deliberately leaving the dedicated live branch checked out. */
export async function stopBuilder(options: BuilderOperationOptions): Promise<BuilderControlState> {
  return withBuilderMutex(async () => {
    const current = readBuilderControl(options.paths)
    // Leave the dedicated branch checked out for inspection/recovery, but clear its lifecycle
    // identity so the next session always gets a fresh builder/live branch.
    return writeBuilderControl(options.paths, { ...current, session: null, branch: null, baseRevision: null, integrationBranch: null, integrationRevision: null, updatedAt: nowIso(options) })
  })
}

const removeManagedFiles = (paths: BuilderLifecyclePaths): void => {
  for (const file of collectFiles(paths.instanceDir)) unlinkSync(file)
}

const applyBackup = async (paths: BuilderLifecyclePaths, manifest: BuilderBackupManifest, directory: string): Promise<void> => {
  removeManagedFiles(paths)
  for (const entry of manifest.files) {
    const source = resolve(directory, entry.path)
    const destination = resolve(paths.instanceDir, entry.path)
    assertNoSymlinkAncestors(directory, source)
    assertNoSymlinkAncestors(paths.instanceDir, destination)
    mkdirSync(resolve(destination, '..'), { recursive: true })
    copyFileSync(source, destination)
    chmodSync(destination, entry.mode)
    const stat = statSync(destination)
    if (stat.size !== entry.bytes || await sha256File(destination) !== entry.sha256) throw new BuilderLifecycleError(503, `Restored file failed validation: ${entry.path}`)
  }
  if (manifest.config) {
    const names = new Set(manifest.config.files.map((entry) => entry.path))
    for (const name of ['box.json', 'box.local.json']) {
      const destination = join(paths.repoRoot, name)
      assertNoSymlinkAncestors(paths.repoRoot, destination)
      if (!names.has(name) && existsSync(destination)) unlinkSync(destination)
    }
    for (const entry of manifest.config.files) {
      const source = resolve(directory, 'root-config', entry.path)
      const destination = resolve(paths.repoRoot, entry.path)
      assertNoSymlinkAncestors(directory, source)
      assertNoSymlinkAncestors(paths.repoRoot, destination)
      mkdirSync(resolve(destination, '..'), { recursive: true })
      copyFileSync(source, destination)
      chmodSync(destination, entry.mode)
      const stat = statSync(destination)
      if (stat.size !== entry.bytes || await sha256File(destination) !== entry.sha256) throw new BuilderLifecycleError(503, `Restored config file failed validation: ${entry.path}`)
    }
  }
}

/** The engine a Builder backup's configuration names (box.local.json over box.json; pgrust by default). */
const backupEngine = (directory: string, manifest: BuilderBackupManifest): 'pgrust' | 'native' => {
  let engine: unknown = 'pgrust'
  for (const name of ['box.json', 'box.local.json']) {
    if (!manifest.config?.files.some((file) => file.path === name)) continue
    try {
      const raw = JSON.parse(readFileSync(resolve(directory, 'root-config', name), 'utf8')) as { database?: { engine?: unknown } }
      if (raw.database?.engine !== undefined) engine = raw.database.engine
    } catch { /* validated by the restored boot */ }
  }
  if (engine !== 'pgrust' && engine !== 'native') throw new BuilderLifecycleError(503, `Builder backup names an unknown database engine ${String(engine)}`)
  return engine
}

/**
 * Stage every file set the restore commit replaces, beside the live ones (same filesystems, so each
 * swap is a rename): each top-level instance entry Builder manages, and box.json / box.local.json.
 * Nothing live changes here; the database port's journal applies or undoes the swaps.
 */
const stageBuilderFiles = (paths: BuilderLifecyclePaths, manifest: BuilderBackupManifest, directory: string, id: string): BuilderFileSwap[] => {
  const stageRoot = resolve(paths.instanceDir, `.builder-restore-${id}`)
  const parkRoot = resolve(paths.instanceDir, `.builder-parked-${id}`)
  rmSync(stageRoot, { recursive: true, force: true })
  mkdirSync(stageRoot, { recursive: true, mode: 0o700 })
  mkdirSync(parkRoot, { recursive: true, mode: 0o700 })
  for (const entry of manifest.files) {
    const source = resolve(directory, entry.path)
    const destination = resolve(stageRoot, entry.path)
    assertNoSymlinkAncestors(directory, source)
    mkdirSync(resolve(destination, '..'), { recursive: true })
    copyFileSync(source, destination)
    chmodSync(destination, entry.mode)
  }
  const top = new Set<string>()
  for (const entry of manifest.files) top.add(entry.path.replaceAll('\\', '/').split('/')[0]!)
  for (const name of existsSync(paths.instanceDir) ? readdirSync(paths.instanceDir) : []) if (!shouldExclude(name)) top.add(name)
  const swaps: BuilderFileSwap[] = [...top].sort().map((name) => ({
    live: resolve(paths.instanceDir, name), staged: resolve(stageRoot, name), parked: resolve(parkRoot, name), hadLive: existsSync(resolve(paths.instanceDir, name)),
  }))
  for (const name of ['box.json', 'box.local.json']) {
    const live = join(paths.repoRoot, name)
    assertNoSymlinkAncestors(paths.repoRoot, live)
    const staged = join(paths.repoRoot, `.builder-restore-${id}-${name}`)
    rmSync(staged, { force: true })
    const entry = manifest.config?.files.find((file) => file.path === name)
    if (entry) {
      copyFileSync(resolve(directory, 'root-config', name), staged)
      chmodSync(staged, entry.mode)
    }
    swaps.push({ live, staged, parked: join(paths.repoRoot, `.builder-parked-${id}-${name}`), hadLive: existsSync(live) })
  }
  return swaps
}

/** Restore a validated Builder backup. The current instance is first captured as a safety backup. */
export async function restoreBuilder(id: string, options: BuilderOperationOptions & { allowCodebaseMismatch?: boolean }): Promise<BuilderRestoreResult> {
  return withBuilderMutex(async () => {
    const source = readManifest(options.paths, id)
    await validateBackupFiles(source.manifest, source.directory)
    ensureClean(options.paths)
    if (!options.allowCodebaseMismatch && gitSHA(options.paths) !== source.manifest.codebaseSHA) {
      throw new BuilderLifecycleError(409, `Builder backup codebase ${source.manifest.codebaseSHA.slice(0, 12)} does not match the live checkout; restore the matching source revision first`)
    }
    if (options.database) {
      if (!source.manifest.database) throw new BuilderLifecycleError(409, 'This Builder backup carries no database (taken before backups included it); it cannot be restored')
      const database = options.database
      const safetyBackup = await withOfflineApp(options, async () => {
        const safety = await createBackup(options, 'pre-restore')
        writeBuilderControl(options.paths, appendBackup(readBuilderControl(options.paths), safety, nowIso(options)))
        try {
          await database.restore({
            point: resolve(source.directory, 'root-database'),
            engine: backupEngine(source.directory, source.manifest),
            stageFiles: (stageId) => stageBuilderFiles(options.paths, source.manifest, source.directory, stageId),
          })
        } finally {
          // Staging is removed only once the database journal is gone: while data/db/switch.json
          // exists (a rollback that failed), it may name these paths as the only copy of the
          // previous or restored files, and the next start settles it. Without a journal nothing
          // references them (the Builder mutex and the maintenance gate exclude a concurrent run).
          if (!existsSync(join(options.paths.instanceDir, 'db', 'switch.json'))) {
            for (const root of [options.paths.instanceDir, options.paths.repoRoot]) {
              for (const name of readdirSync(root)) if (/^\.builder-(restore|parked)-/.test(name)) rmSync(join(root, name), { recursive: true, force: true })
            }
          }
        }
        return safety
      })
      return { state: readBuilderControl(options.paths), restored: source.manifest, safetyBackup }
    }
    const safetyBackup = await withOfflineApp(options, async () => {
      const safety = await createBackup(options, 'pre-restore')
      writeBuilderControl(options.paths, appendBackup(readBuilderControl(options.paths), safety, nowIso(options)))
      try {
        await applyBackup(options.paths, source.manifest, source.directory)
      } catch (error) {
        try {
          await applyBackup(options.paths, safety, resolve(builderBackupRoot(options.paths), safety.id))
        } catch (recoveryError) {
          throw new BuilderLifecycleError(503, `Builder restore failed and safety recovery also failed: ${String((recoveryError as Error)?.message ?? recoveryError)}`)
        }
        throw error
      }
      return safety
    })
    const state = readBuilderControl(options.paths)
    return { state, restored: source.manifest, safetyBackup }
  })
}
