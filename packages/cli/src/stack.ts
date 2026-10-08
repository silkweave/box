// `box stack where` and `box stack fetch`: where this Box's Stack lives, and a local copy of its
// source an agent can read `features/<id>` from while adapting a recipe. The Box already ships
// `recipes/`; the implementation source stays in the Stack.
//
// A path source is read in place and never modified. A git source (GitHub shorthand or a URL) is
// cloned into the gitignored `<box>/.stack/` cache and refreshed with `git fetch`. Git always runs
// from an argument array, never through a shell.
import { existsSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readBoxConfig, stackSourceKind } from '@silkweave/box-core/box-json'
import { resolveStackSource, STACK_CACHE_DIR, type StackLocation } from '@silkweave/box-core/stack-source'
import { commandError } from './command-ui.ts'
import { isMain, repoRoot } from './repo.ts'

export type StackCommand =
  | { verb: 'where' }
  | { verb: 'fetch'; ref?: string; quiet: boolean }

const USAGE = 'Expected: box stack where, or box stack fetch [--ref <rev>] [--quiet]'

export function parseStackArgs(argv: readonly string[]): StackCommand {
  const [verb, ...args] = argv
  if (verb === 'where') {
    if (args.length) throw new Error(`box stack where takes no arguments. ${USAGE}`)
    return { verb }
  }
  if (verb !== 'fetch') throw new Error(USAGE)
  const command: { verb: 'fetch'; ref?: string; quiet: boolean } = { verb, quiet: false }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!
    if (arg === '--quiet' || arg === '-q') command.quiet = true
    else if (arg === '--ref') command.ref = args[++index]
    else if (arg.startsWith('--ref=')) command.ref = arg.slice('--ref='.length)
    else throw new Error(`Unknown option ${arg}. ${USAGE}`)
    if ((arg === '--ref' || arg.startsWith('--ref=')) && !command.ref) throw new Error('--ref needs a revision')
  }
  // A revision is handed to git as an argument; one that starts with a dash would read as an option.
  if (command.ref !== undefined && (command.ref.startsWith('-') || /[\s\0]/.test(command.ref))) throw new Error(`Invalid revision ${JSON.stringify(command.ref)}`)
  return command
}

interface GitResult { ok: boolean; out: string; err: string }

function git(cwd: string, args: readonly string[]): GitResult {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.error) throw new Error(`git is not available: ${result.error.message}`)
  return { ok: result.status === 0, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() }
}

/** Network-facing git: progress and credential prompts reach the terminal; stdout stays clean for `--quiet`. */
function gitLoud(cwd: string, args: readonly string[]): void {
  const result = spawnSync('git', ['-C', cwd, ...args], { stdio: ['inherit', 2, 'inherit'] })
  if (result.error) throw new Error(`git is not available: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed with status ${result.status ?? result.signal ?? 'unknown'}`)
}

const isDir = (path: string): boolean => existsSync(path) && statSync(path).isDirectory()

/** The commit `ref` names in `dir`, or null. */
function revParse(dir: string, ref: string): string | null {
  const result = git(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  return result.ok && result.out ? result.out : null
}

/** Is `dir` the top of its own git work tree (not a directory inside some enclosing repository)? */
function isOwnCheckout(dir: string): boolean {
  const top = git(dir, ['rev-parse', '--show-toplevel'])
  return top.ok && realpathSync(top.out) === realpathSync(dir)
}

export interface StackInfo {
  source: string
  location: StackLocation
  /** Path sources: whether the directory exists, its HEAD, dirtiness and layout. */
  exists?: boolean
  head?: string | null
  dirty?: boolean
  recipes?: boolean
  features?: boolean
  /** Git sources: the cache directory and the commit it holds, if fetched. */
  cache?: string
  cached?: string | null
}

export function stackInfo(root: string): StackInfo {
  const source = readBoxConfig(root).stack.source
  const location = resolveStackSource(source, root)
  if (location.kind === 'path') {
    const exists = isDir(location.path)
    const inGit = exists && git(location.path, ['rev-parse', '--is-inside-work-tree']).ok
    return {
      source, location, exists,
      head: inGit ? revParse(location.path, 'HEAD') : null,
      dirty: inGit ? git(location.path, ['status', '--porcelain=v1']).out !== '' : false,
      recipes: exists && isDir(join(location.path, 'recipes')),
      features: exists && isDir(join(location.path, 'features')),
    }
  }
  const cache = join(root, STACK_CACHE_DIR)
  return { source, location, cache, cached: isDir(cache) && isOwnCheckout(cache) ? revParse(cache, 'HEAD') : null }
}

export function formatWhere(info: StackInfo): string[] {
  const kind = stackSourceKind(info.source)
  const lines = [`source    ${info.source}`]
  if (info.location.kind === 'path') {
    lines.push('kind      path', `location  ${info.location.path}${info.exists ? '' : ' (missing)'}`)
    lines.push(`head      ${info.head ? `${info.head}${info.dirty ? ' (with working-tree changes)' : ''}` : 'not a git checkout'}`)
    lines.push(`recipes   ${info.recipes ? 'yes' : 'no'}`, `features  ${info.features ? 'yes' : 'no'}`)
  } else {
    lines.push(`kind      git${kind === 'github' ? ' (GitHub shorthand)' : ''}`, `location  ${info.location.url}`)
    lines.push(`cache     ${info.cache}${info.cached ? ` at ${info.cached}` : ' (not fetched yet: run box stack fetch)'}`)
  }
  return lines
}

export interface FetchResult { path: string; commit: string | null; warnings: string[] }

/** A local Stack checkout, validated and reported as it is. `ref` only ever produces a warning. */
function fetchPath(path: string, ref?: string): FetchResult {
  if (!isDir(path)) throw new Error(`stack.source points at ${path}, which is not a directory`)
  const missing = ['recipes', 'features'].filter(dir => !isDir(join(path, dir)))
  if (missing.length) throw new Error(`${path} is not a Stack checkout: it has no ${missing.join(' or ')}/ directory`)
  const warnings: string[] = []
  const inGit = git(path, ['rev-parse', '--is-inside-work-tree']).ok
  const commit = inGit ? revParse(path, 'HEAD') : null
  if (ref) {
    const wanted = inGit ? revParse(path, ref) : null
    if (!commit) warnings.push(`${path} is not a git checkout, so --ref ${ref} cannot be checked; box stack fetch never changes a local Stack checkout`)
    else if (wanted !== commit) warnings.push(`the local Stack checkout is at ${commit}, not ${ref}${wanted ? ` (${wanted})` : ' (unknown there)'}; box stack fetch never changes a local Stack checkout`)
  }
  return { path, commit, warnings }
}

/** Resolve `ref` in the cache: a remote branch first (local branches in the cache go stale), then
 *  any other revision git knows, then one more targeted fetch for a revision no ref advertises. */
function resolveCacheRef(cache: string, ref: string | undefined): string {
  if (!ref) {
    const head = revParse(cache, 'refs/remotes/origin/HEAD')
    if (!head) throw new Error(`${cache} has no origin/HEAD; pass --ref <rev>`)
    return head
  }
  const known = revParse(cache, `refs/remotes/origin/${ref}`) ?? revParse(cache, ref)
  if (known) return known
  gitLoud(cache, ['fetch', '--quiet', 'origin', ref])
  const fetched = revParse(cache, 'FETCH_HEAD')
  if (!fetched) throw new Error(`the Stack has no revision ${ref}`)
  return fetched
}

/** Clone or refresh the Box's `.stack/` cache from `url`, then detach at `ref` (default origin/HEAD). */
function fetchGit(root: string, url: string, ref?: string): FetchResult {
  const cache = join(root, STACK_CACHE_DIR)
  if (existsSync(cache)) {
    const refuse = (why: string): never => { throw new Error(`${cache} ${why}. It is only a cache: delete it and run box stack fetch again`) }
    if (!isDir(cache)) refuse('is not a directory')
    if (!isOwnCheckout(cache)) refuse('exists but is not a git checkout')
    const origin = git(cache, ['remote', 'get-url', 'origin'])
    if (!origin.ok || origin.out !== url) refuse(`is a checkout of ${origin.ok ? origin.out : 'no origin remote'}, not ${url}`)
    gitLoud(cache, ['fetch', '--prune', '--tags', 'origin'])
    // Follow a default-branch rename on the remote; harmless when nothing changed.
    git(cache, ['remote', 'set-head', 'origin', '--auto'])
  } else {
    // A blobless clone keeps hosted fetches small. Local file:// remotes do not offer filtering and
    // would only answer with a warning, so they get an ordinary clone.
    const filter = url.startsWith('file:') ? [] : ['--filter=blob:none']
    gitLoud(root, ['clone', ...filter, '--no-checkout', '--', url, cache])
  }
  const commit = resolveCacheRef(cache, ref)
  // The cache is disposable and managed by this command, so a stray edit there does not block a checkout.
  gitLoud(cache, ['checkout', '--quiet', '--force', '--detach', commit])
  return { path: cache, commit, warnings: [] }
}

/** Hint for a failed HTTPS GitHub fetch: hosts that only hold an SSH key cannot answer the credential prompt. */
export function httpsFetchHint(url: string): string | undefined {
  const github = /^https:\/\/github\.com\/(.+)$/.exec(url)
  if (!github) return undefined
  return `If this host authenticates to GitHub over SSH only, set "stack": { "source": "git@github.com:${github[1]}" } in box.local.json and delete the .stack/ cache`
}

export function fetchStack(root: string, ref?: string): FetchResult {
  const location = resolveStackSource(readBoxConfig(root).stack.source, root)
  if (location.kind === 'path') return fetchPath(location.path, ref)
  try {
    return fetchGit(root, location.url, ref)
  } catch (error) {
    const hint = httpsFetchHint(location.url)
    if (!hint || !(error instanceof Error) || !error.message.startsWith('git ')) throw error
    throw new Error(`${error.message}. ${hint}`, { cause: error })
  }
}

export function main(argv: readonly string[], root: string = repoRoot): number {
  try {
    const command = parseStackArgs(argv)
    if (command.verb === 'where') {
      for (const line of formatWhere(stackInfo(root))) console.log(line)
      return 0
    }
    const result = fetchStack(root, command.ref)
    // Warnings go to stderr so `--quiet` output stays exactly one path.
    for (const warning of result.warnings) process.stderr.write(`  ! ${warning}\n`)
    if (command.quiet) console.log(result.path)
    else console.log(`path      ${result.path}\ncommit    ${result.commit ?? 'unknown (not a git checkout)'}`)
    return 0
  } catch (error) {
    commandError(error instanceof Error ? error.message : String(error))
    return 1
  }
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2))
