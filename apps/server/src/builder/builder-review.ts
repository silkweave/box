import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import {
  BuilderLifecycleError,
  readBuilderControl,
  writeBuilderControl,
  withBuilderMutex,
  type BuilderLifecyclePaths,
} from './builder-lifecycle.js'

const execFileAsync = promisify(execFile)
const GIT_TIMEOUT_MS = 15_000
const GIT_MAX_BUFFER = 4 * 1024 * 1024
const DEFAULT_MAX_DIFF_BYTES = 512 * 1024
const MAX_FILES = 2_000
const MAX_COMMIT_MESSAGE = 1_000
const MAX_UNTRACKED_PREVIEW_BYTES = 64 * 1024

export interface BuilderReviewFile {
  path: string
  status: string
}

export interface BuilderReviewCommit {
  sha: string
  message: string
}

export interface BuilderReview {
  version: 1
  fingerprint: string
  branch: string
  targetBranch: string | null
  baseRevision: string
  headRevision: string
  files: BuilderReviewFile[]
  commits: BuilderReviewCommit[]
  diff: string
  truncated: boolean
}

export interface BuilderReviewOptions {
  /** Maximum UTF-8 bytes returned in `diff`, including untracked file previews. */
  maxDiffBytes?: number
}

export interface BuilderReviewMutationOptions {
  /** Fingerprint returned by the review being acted on. */
  fingerprint: string
  /** The commit message used when pending work is checkpointed. */
  message: string
}

export interface BuilderCheckpointResult {
  commitSHA: string
  review: BuilderReview
}

export interface BuilderFinishResult {
  checkpoint: BuilderCheckpointResult | null
  integratedSHA: string
  targetBranch: string
  checkedOutBranch: string
  review: BuilderReview
}

export interface BuilderFinalizeCheckoutOptions {
  expectedBranch: string
  expectedSHA: string
  targetBranch: string
}

export interface BuilderFinalizeCheckoutResult {
  branch: string
  revision: string
}

interface GitResult {
  stdout: string
  stderr: string
  code: number
}

const isSha = (value: string): boolean => /^[0-9a-f]{40,64}$/i.test(value)
const isBranch = (value: string): boolean => value.length > 0 && value.length <= 255 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) && !value.includes('..') && !value.includes('@{') && !value.endsWith('/') && !value.endsWith('.')
const isRelativeRepoPath = (value: string): boolean => {
  if (!value || isAbsolute(value)) return false
  const normalized = value.replaceAll('\\', '/')
  return normalized !== '.' && normalized !== '..' && !normalized.startsWith('../') && !normalized.includes('/../') && !normalized.includes('/./')
}

const failGit = (args: string[], result: GitResult): never => {
  const detail = result.stderr.trim()
  throw new BuilderLifecycleError(503, `git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`)
}

const runGitResult = async (paths: BuilderLifecyclePaths, args: string[], maxBuffer = GIT_MAX_BUFFER): Promise<GitResult> => {
  try {
    const result = await execFileAsync('git', ['-C', paths.repoRoot, ...args], {
      encoding: 'utf8',
      maxBuffer,
      timeout: GIT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    })
    return { stdout: String(result.stdout), stderr: String(result.stderr), code: 0 }
  } catch (error) {
    const detail = error as { stdout?: string | Buffer; stderr?: string | Buffer; code?: number | string }
    return { stdout: detail.stdout ? String(detail.stdout) : '', stderr: detail.stderr ? String(detail.stderr) : '', code: typeof detail.code === 'number' ? detail.code : 1 }
  }
}

const runGit = async (paths: BuilderLifecyclePaths, args: string[], maxBuffer = GIT_MAX_BUFFER): Promise<string> => {
  const result = await runGitResult(paths, args, maxBuffer)
  if (result.code !== 0) failGit(args, result)
  return result.stdout
}

const runGitLimited = async (paths: BuilderLifecyclePaths, args: string[], limit: number): Promise<{ stdout: string; truncated: boolean }> => {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', ['-C', paths.repoRoot, ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
    let stdout = ''
    let stderr = ''
    let truncated = false
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (truncated) resolvePromise({ stdout, truncated: true })
      else if (exitCode !== 0) reject(new BuilderLifecycleError(503, `git ${args.join(' ')} failed${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
      else resolvePromise({ stdout, truncated: false })
    }
    const timer = setTimeout(() => {
      if (!settled) {
        child.kill('SIGKILL')
        reject(new BuilderLifecycleError(503, `git ${args.join(' ')} timed out`))
        settled = true
      }
    }, GIT_TIMEOUT_MS)
    let exitCode = 1
    child.stdout.on('data', (chunk: Buffer) => {
      if (truncated) return
      const remaining = limit - Buffer.byteLength(stdout)
      if (chunk.byteLength > remaining) {
        stdout += chunk.subarray(0, Math.max(0, remaining)).toString('utf8')
        truncated = true
        child.kill('SIGKILL')
      } else stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8').slice(0, 8_192) })
    child.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(new BuilderLifecycleError(503, `git ${args.join(' ')} failed: ${error.message}`)) } })
    child.on('close', code => { exitCode = code ?? 1; finish() })
  })
}

const runGitInputResult = async (paths: BuilderLifecyclePaths, args: string[], input: string, maxBuffer = GIT_MAX_BUFFER): Promise<GitResult> => {
  return new Promise(resolvePromise => {
    const child = spawn('git', ['-C', paths.repoRoot, ...args], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: GitResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise(result)
    }
    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      if (target === 'stdout') stdout += chunk.toString('utf8')
      else stderr += chunk.toString('utf8')
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxBuffer) {
        child.kill('SIGKILL')
        finish({ stdout, stderr: `${stderr}\nGit output exceeded its bound`, code: 1 })
      }
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ stdout, stderr: `${stderr}\nGit command timed out`, code: 1 })
    }, GIT_TIMEOUT_MS)
    child.stdout.on('data', chunk => append('stdout', chunk))
    child.stderr.on('data', chunk => append('stderr', chunk))
    child.on('error', error => finish({ stdout, stderr: `${stderr}\n${error.message}`, code: 1 }))
    child.on('close', code => finish({ stdout, stderr, code: code ?? 1 }))
    child.stdin.end(input)
  })
}

const ensureRepo = async (paths: BuilderLifecyclePaths): Promise<void> => {
  if (!isAbsolute(paths.repoRoot) || !isAbsolute(paths.instanceDir)) throw new BuilderLifecycleError(400, 'Builder review paths must be absolute')
  const root = resolve(paths.repoRoot)
  if (!existsSync(root) || !lstatSync(root).isDirectory()) throw new BuilderLifecycleError(400, 'Builder review repository does not exist')
  const reported = (await runGit(paths, ['rev-parse', '--show-toplevel'])).trim()
  let realRoot: string
  let realReported: string
  try {
    realRoot = realpathSync(root)
    realReported = realpathSync(reported)
  } catch {
    throw new BuilderLifecycleError(400, 'Builder review repository path is invalid')
  }
  if (realRoot !== realReported) throw new BuilderLifecycleError(400, 'Builder review repository path is not the Git worktree root')
}

const checkedOutBranch = async (paths: BuilderLifecyclePaths): Promise<string> => {
  const branch = (await runGit(paths, ['branch', '--show-current'])).trim()
  if (!isBranch(branch)) throw new BuilderLifecycleError(409, 'Builder review requires a named Git branch')
  return branch
}

const branchCheckedOutInAnotherWorktree = async (paths: BuilderLifecyclePaths, branch: string): Promise<boolean> => {
  const expected = `branch refs/heads/${branch}`
  const lines = (await runGit(paths, ['worktree', 'list', '--porcelain'])).split(/\r?\n/)
  return lines.some(line => line.trim() === expected)
}

const ensureRelativePath = (repoRoot: string, path: string): string => {
  if (!isRelativeRepoPath(path) || path === '.git' || path.startsWith(`.git${sep}`)) throw new BuilderLifecycleError(409, `Builder review rejected unsafe path ${JSON.stringify(path)}`)
  const candidate = resolve(repoRoot, path)
  const rel = relative(resolve(repoRoot), candidate)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new BuilderLifecycleError(409, `Builder review path escaped the repository: ${JSON.stringify(path)}`)
  return rel
}

const parseNul = (output: string): string[] => output.split('\0').filter(Boolean)

const diffPathNames = async (paths: BuilderLifecyclePaths): Promise<string[]> => {
  const outputs = await Promise.all([
    runGit(paths, ['diff', '--name-only', '-z', '--cached']),
    runGit(paths, ['diff-files', '--name-only', '-z']),
    runGit(paths, ['ls-files', '--others', '--exclude-standard', '-z']),
  ])
  const names = new Set<string>()
  for (const output of outputs) for (const path of parseNul(output)) names.add(ensureRelativePath(paths.repoRoot, path))
  return [...names].sort()
}

const worktreeDigest = async (paths: BuilderLifecyclePaths): Promise<string> => {
  const names = await diffPathNames(paths)
  const hash = createHash('sha256')
  hash.update('builder-worktree-v1\0')
  // The index changes deliberately during checkpointing. The status string is part of the
  // complete review fingerprint below, while this digest only answers whether file contents
  // changed concurrently during `git add`.
  for (const path of names) {
    const absolute = resolve(paths.repoRoot, path)
    let descriptor = `${path}\0`
    try {
      const stat = lstatSync(absolute)
      descriptor += `${stat.mode & 0o7777}:${stat.size}:`
      if (stat.isSymbolicLink()) descriptor += `link:${readlinkSync(absolute)}\0`
      else if (stat.isFile()) descriptor += `file:${createHash('sha256').update(readFileSync(absolute)).digest('hex')}\0`
      else descriptor += `other:${stat.mode}\0`
    } catch {
      descriptor += 'missing\0'
    }
    hash.update(descriptor)
  }
  return hash.digest('hex')
}

interface GitState {
  head: string
  branch: string
  indexTree: string
  status: string
  worktree: string
  fingerprint: string
}

const readGitState = async (paths: BuilderLifecyclePaths): Promise<GitState> => {
  const [head, branch, indexTree, status] = await Promise.all([
    runGit(paths, ['rev-parse', 'HEAD']),
    runGit(paths, ['branch', '--show-current']),
    runGit(paths, ['write-tree']),
    runGit(paths, ['status', '--porcelain=v1', '--untracked-files=all', '-z']),
  ])
  const cleanHead = head.trim()
  const cleanBranch = branch.trim()
  const cleanIndex = indexTree.trim()
  if (!isSha(cleanHead) || !isSha(cleanIndex) || !isBranch(cleanBranch)) throw new BuilderLifecycleError(409, 'Builder review requires a named branch and a valid Git state')
  const worktree = await worktreeDigest(paths)
  const fingerprint = createHash('sha256').update(['builder-review-v1', cleanBranch, cleanHead, cleanIndex, status, worktree].join('\0')).digest('hex')
  return { head: cleanHead, branch: cleanBranch, indexTree: cleanIndex, status, worktree, fingerprint }
}

const parseNameStatus = (output: string): BuilderReviewFile[] => {
  const tokens = parseNul(output)
  const files: BuilderReviewFile[] = []
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++]
    const code = status.match(/^[A-Z?][0-9A-Z?]*/)?.[0] ?? status
    const path = tokens[index++]
    if (!path) break
    if (code.startsWith('R') || code.startsWith('C')) {
      const destination = tokens[index++]
      if (destination) files.push({ path: destination, status: code })
      else files.push({ path, status: code })
    } else files.push({ path, status: code })
  }
  return files
}

const findIntegrationBranch = async (paths: BuilderLifecyclePaths): Promise<string | null> => {
  const state = readBuilderControl(paths)
  if (state.integrationBranch && isBranch(state.integrationBranch) && !state.integrationBranch.startsWith('builder/live/')) return state.integrationBranch
  const remote = await runGitResult(paths, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (remote.code === 0) {
    const value = remote.stdout.trim()
    const slash = value.indexOf('/')
    const candidate = slash >= 0 ? value.slice(slash + 1) : ''
    if (isBranch(candidate)) {
      const local = await runGitResult(paths, ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`])
      if (local.code === 0) return candidate
    }
  }
  for (const candidate of ['main', 'master']) {
    const branch = await runGitResult(paths, ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`])
    if (branch.code === 0) return candidate
  }
  return null
}

const reviewInternal = async (paths: BuilderLifecyclePaths, options: BuilderReviewOptions = {}): Promise<BuilderReview> => {
  await ensureRepo(paths)
  const control = readBuilderControl(paths)
  if (!control.branch || !control.baseRevision) throw new BuilderLifecycleError(409, 'Builder review requires an active live branch')
  const state = await readGitState(paths)
  if (state.branch !== control.branch) throw new BuilderLifecycleError(409, `Builder review requires ${control.branch} to be checked out`)
  const base = control.baseRevision
  if (!isSha(base)) throw new BuilderLifecycleError(503, 'Builder review base revision is invalid')
  const validBase = await runGitResult(paths, ['cat-file', '-e', `${base}^{commit}`])
  if (validBase.code !== 0) failGit(['cat-file', '-e', `${base}^{commit}`], validBase)
  const targetBranch = await findIntegrationBranch(paths)
  const nameStatus = parseNameStatus(await runGit(paths, ['diff', '--name-status', '-z', '--find-renames', base, '--']))
  const untracked = parseNul(await runGit(paths, ['ls-files', '--others', '--exclude-standard', '-z']))
  const files = new Map<string, BuilderReviewFile>()
  for (const file of nameStatus) files.set(ensureRelativePath(paths.repoRoot, file.path), file)
  for (const path of untracked) {
    const safePath = ensureRelativePath(paths.repoRoot, path)
    files.set(safePath, { path: safePath, status: '??' })
  }
  const listed = [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const maxFiles = Math.min(MAX_FILES, Math.max(1, listed.length))
  const diffLimit = options.maxDiffBytes === undefined ? DEFAULT_MAX_DIFF_BYTES : options.maxDiffBytes
  if (!Number.isSafeInteger(diffLimit) || diffLimit < 1 || diffLimit > 4 * 1024 * 1024) throw new BuilderLifecycleError(400, 'Builder review diff limit is invalid')
  const trackedDiff = await runGitLimited(paths, ['diff', '--no-ext-diff', '--no-color', '--unified=3', '--find-renames', base, '--'], diffLimit)
  let diff = trackedDiff.stdout
  let truncated = trackedDiff.truncated
  for (const file of untracked) {
    if (Buffer.byteLength(diff) >= diffLimit) { truncated = true; break }
    const path = ensureRelativePath(paths.repoRoot, file)
    const absolute = resolve(paths.repoRoot, path)
    let addition = `\n--- /dev/null\n+++ b/${path}\n`
    try {
      const stat = lstatSync(absolute)
      if (!stat.isFile() || stat.size > MAX_UNTRACKED_PREVIEW_BYTES) addition += `@@ binary or large untracked file (${stat.size} bytes) omitted @@\n`
      else {
        const body = readFileSync(absolute)
        if (body.includes(0)) addition += '@@ binary untracked file omitted @@\n'
        else addition += `@@ -0,0 +1,${body.length ? body.toString('utf8').split('\n').length : 0} @@\n${body.toString('utf8').split('\n').map(line => `+${line}`).join('\n')}\n`
      }
    } catch { addition += '@@ untracked file could not be read @@\n' }
    const remaining = diffLimit - Buffer.byteLength(diff)
    if (Buffer.byteLength(addition) > remaining) {
      diff += Buffer.from(addition).subarray(0, remaining).toString('utf8')
      truncated = true
      break
    }
    diff += addition
  }
  const encoded = Buffer.from(diff)
  if (encoded.byteLength > diffLimit) {
    diff = encoded.subarray(0, diffLimit).toString('utf8')
    truncated = true
  }
  const commitsOutput = await runGit(paths, ['log', '--format=%H%x00%s%x00', '--no-decorate', `${base}..${state.head}`, '--'])
  // `git log --format` separates records with a newline even though the fields use NULs.
  // Normalize that record separator before pairing SHA and subject tokens.
  const commitTokens = parseNul(commitsOutput).map(token => token.replace(/^\n+/, '').replace(/\n+$/, ''))
  const commits: BuilderReviewCommit[] = []
  for (let index = 0; index + 1 < commitTokens.length; index += 2) if (isSha(commitTokens[index])) commits.push({ sha: commitTokens[index], message: commitTokens[index + 1] })
  return { version: 1, fingerprint: state.fingerprint, branch: state.branch, targetBranch, baseRevision: base, headRevision: state.head, files: listed.slice(0, maxFiles), commits, diff, truncated: truncated || listed.length > maxFiles }
}

const validateMutation = (options: BuilderReviewMutationOptions): void => {
  if (typeof options.fingerprint !== 'string' || !/^[0-9a-f]{64}$/i.test(options.fingerprint)) throw new BuilderLifecycleError(400, 'Builder review fingerprint is required')
  if (typeof options.message !== 'string' || !options.message.trim() || options.message.length > MAX_COMMIT_MESSAGE || options.message.includes('\0')) throw new BuilderLifecycleError(400, 'Builder checkpoint message is invalid')
}

const assertFingerprint = (review: BuilderReview, expected: string): void => {
  if (review.fingerprint !== expected) throw new BuilderLifecycleError(409, 'Builder review is stale; refresh the review before continuing')
}

const checkpointInternal = async (paths: BuilderLifecyclePaths, options: BuilderReviewMutationOptions): Promise<BuilderCheckpointResult> => {
  validateMutation(options)
  const before = await reviewInternal(paths)
  assertFingerprint(before, options.fingerprint)
  const beforeState = await readGitState(paths)
  if (beforeState.fingerprint !== options.fingerprint) throw new BuilderLifecycleError(409, 'Builder review is stale; refresh the review before continuing')
  if (!beforeState.status) throw new BuilderLifecycleError(409, 'Builder has no changes to checkpoint')
  const beforeWorktree = beforeState.worktree
  await runGit(paths, ['add', '--all', '--'])
  await reviewInternal(paths)
  const stagedState = await readGitState(paths)
  if (stagedState.worktree !== beforeWorktree) throw new BuilderLifecycleError(409, 'Builder changed while staging; refresh the review and inspect the worktree')
  if (stagedState.head !== before.headRevision || stagedState.branch !== before.branch) throw new BuilderLifecycleError(409, 'Builder changed while staging; refresh the review and inspect the branch')
  const intendedTree = stagedState.indexTree
  await runGit(paths, ['commit', '-m', options.message.trim()])
  const commitSHA = (await runGit(paths, ['rev-parse', 'HEAD'])).trim()
  if (!isSha(commitSHA)) throw new BuilderLifecycleError(503, 'Git returned an invalid checkpoint revision')
  const committedTree = (await runGit(paths, ['rev-parse', 'HEAD^{tree}'])).trim()
  if (committedTree !== intendedTree) throw new BuilderLifecycleError(409, 'A Git commit hook changed the committed source; refresh the review before continuing')
  const afterCommitState = await readGitState(paths)
  if (afterCommitState.status) throw new BuilderLifecycleError(409, 'A Git commit hook changed the Builder worktree; refresh the review before continuing')
  return { commitSHA, review: await reviewInternal(paths) }
}

export async function reviewBuilder(paths: BuilderLifecyclePaths, options?: BuilderReviewOptions): Promise<BuilderReview> {
  return withBuilderMutex(() => reviewInternal(paths, options))
}

export async function checkpointBuilder(paths: BuilderLifecyclePaths, options: BuilderReviewMutationOptions): Promise<BuilderCheckpointResult> {
  return withBuilderMutex(() => checkpointInternal(paths, options))
}

export async function finishBuilder(paths: BuilderLifecyclePaths, options: BuilderReviewMutationOptions): Promise<BuilderFinishResult> {
  return withBuilderMutex(async () => {
    validateMutation(options)
    let review = await reviewInternal(paths)
    assertFingerprint(review, options.fingerprint)
    let checkpoint: BuilderCheckpointResult | null = null
    const beforeState = await readGitState(paths)
    if (beforeState.status) {
      checkpoint = await checkpointInternal(paths, options)
      review = checkpoint.review
    }
    if ((await readGitState(paths)).status) throw new BuilderLifecycleError(409, 'Builder has uncommitted changes after checkpointing')
    const control = readBuilderControl(paths)
    const recordedTargetBranch = control.integrationBranch && !control.integrationBranch.startsWith('builder/live/') ? control.integrationBranch : null
    const targetBranch = recordedTargetBranch ?? review.targetBranch
    if (!targetBranch || !isBranch(targetBranch)) throw new BuilderLifecycleError(409, 'Builder has no captured integration branch')
    const currentBranch = await checkedOutBranch(paths)
    if (currentBranch !== review.branch || currentBranch !== control.branch) throw new BuilderLifecycleError(409, `Builder finish requires ${control.branch ?? review.branch} to be checked out`)
    if (targetBranch === review.branch) throw new BuilderLifecycleError(409, 'Builder integration branch cannot be the live branch')
    if (await branchCheckedOutInAnotherWorktree(paths, targetBranch)) throw new BuilderLifecycleError(409, `Integration branch ${targetBranch} is checked out in another worktree; finish from that worktree or release it first`)
    const targetRef = `refs/heads/${targetBranch}`
    const target = (await runGit(paths, ['rev-parse', '--verify', `${targetRef}^{commit}`])).trim()
    if (!isSha(target)) throw new BuilderLifecycleError(503, 'Git returned an invalid integration branch revision')
    const live = (await runGit(paths, ['rev-parse', 'HEAD'])).trim()
    if (!isSha(live) || live !== review.headRevision) throw new BuilderLifecycleError(409, 'Builder changed after review; refresh before integrating')
    // A retry after a healthy finish sees the target at the reviewed live SHA. Allow that
    // already-integrated state while still rejecting an unrelated target movement.
    if (recordedTargetBranch && control.integrationRevision && target !== control.integrationRevision && target !== live) throw new BuilderLifecycleError(409, `Integration branch ${targetBranch} moved since Builder started; review and resolve it manually before finishing`)
    const ancestor = await runGitResult(paths, ['merge-base', '--is-ancestor', target, live])
    if (ancestor.code !== 0) throw new BuilderLifecycleError(409, `Integration branch ${targetBranch} diverged from the Builder branch; resolve it manually before finishing`)
    // Update the target and verify the live branch tip in one Git ref transaction. This closes
    // the small race where another process could commit after the HEAD check but before target
    // was advanced, which would otherwise leave integration one commit behind a reviewed state.
    const liveRef = `refs/heads/${review.branch}`
    const updated = await runGitInputResult(paths, ['update-ref', '--stdin'], `start\nupdate ${targetRef} ${live} ${target}\nverify ${liveRef} ${live}\nprepare\ncommit\n`)
    if (updated.code !== 0) throw new BuilderLifecycleError(409, `Integration branch ${targetBranch} changed while finishing; refresh the review before continuing`)
    // Remember the last target revision advanced by this Builder session. This permits a
    // health-failure repair commit on the live branch to be integrated on a later finish retry,
    // while still rejecting an unrelated target movement.
    writeBuilderControl(paths, { ...control, integrationBranch: targetBranch, integrationRevision: live, updatedAt: new Date().toISOString() })
    const finalReview = await reviewInternal(paths)
    return { checkpoint, integratedSHA: live, targetBranch, checkedOutBranch: finalReview.branch, review: finalReview }
  })
}

/**
 * Complete the branch handoff after the caller has restarted and health-checked the Box.
 * Finish deliberately leaves the live branch checked out so that health checks observe the
 * exact reviewed tree. This final operation is guarded again against edits or ref movement.
 */
export async function finalizeCheckout(paths: BuilderLifecyclePaths, options: BuilderFinalizeCheckoutOptions): Promise<BuilderFinalizeCheckoutResult> {
  return withBuilderMutex(async () => {
    if (!isBranch(options.expectedBranch) || !isBranch(options.targetBranch) || options.expectedBranch === options.targetBranch) throw new BuilderLifecycleError(400, 'Builder checkout branches are invalid')
    if (!isSha(options.expectedSHA)) throw new BuilderLifecycleError(400, 'Builder checkout revision is invalid')
    await ensureRepo(paths)
    const branch = await checkedOutBranch(paths)
    if (branch !== options.expectedBranch) throw new BuilderLifecycleError(409, `Builder checkout requires ${options.expectedBranch} to be checked out`)
    const state = await readGitState(paths)
    if (state.status) throw new BuilderLifecycleError(409, 'Builder changed after health check; inspect the worktree before finalizing')
    const live = (await runGit(paths, ['rev-parse', 'HEAD'])).trim()
    if (live !== options.expectedSHA) throw new BuilderLifecycleError(409, 'Builder live branch changed after health check; refresh the review before finalizing')
    const targetRef = `refs/heads/${options.targetBranch}`
    const target = (await runGit(paths, ['rev-parse', '--verify', `${targetRef}^{commit}`])).trim()
    if (target !== options.expectedSHA) throw new BuilderLifecycleError(409, `Integration branch ${options.targetBranch} changed after health check; refresh the review before finalizing`)
    try {
      await runGit(paths, ['switch', options.targetBranch])
      const finalizedState = await readGitState(paths)
      const finalizedBranch = finalizedState.branch
      const finalizedRevision = finalizedState.head
      if (finalizedState.status) throw new BuilderLifecycleError(409, 'A checkout hook changed the Builder worktree; inspect it before finalizing')
      if (finalizedBranch !== options.targetBranch || finalizedRevision !== options.expectedSHA) throw new BuilderLifecycleError(409, 'Builder could not finalize the integrated branch')
      return { branch: finalizedBranch, revision: finalizedRevision }
    } catch (error) {
      // A failed checkout hook can leave the target branch selected. Return to the reviewed live
      // branch only when the tree is still exactly the reviewed SHA and clean. Never discard a
      // hook edit while trying to restore the recoverable Builder context.
      const current = await runGitResult(paths, ['branch', '--show-current'])
      const head = await runGitResult(paths, ['rev-parse', 'HEAD'])
      const status = await runGitResult(paths, ['status', '--porcelain=v1', '--untracked-files=all', '-z'])
      if (current.code === 0 && current.stdout.trim() === options.targetBranch && head.code === 0 && head.stdout.trim() === options.expectedSHA && status.code === 0 && !status.stdout) {
        await runGit(paths, ['switch', options.expectedBranch]).catch(() => {})
      }
      throw error
    }
  })
}
