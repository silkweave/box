import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fetchStack, formatWhere, httpsFetchHint, parseStackArgs, stackInfo } from '../stack.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const temp = (): string => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'box-stack-')))
  roots.push(root)
  return root
}

const GIT_IDENTITY = ['-c', 'user.name=Box Test', '-c', 'user.email=box@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false']
function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', [...GIT_IDENTITY, '-C', cwd, ...args], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

/** A throwaway Stack checkout with one commit and a `v1` tag, plus a second commit on top. */
function stackFixture(parent: string): { path: string; first: string; second: string } {
  const path = join(parent, 'stack')
  for (const dir of ['recipes/demo', 'features/demo/core']) mkdirSync(join(path, dir), { recursive: true })
  writeFileSync(join(path, 'recipes/demo/RECIPE.md'), '# Demo\n')
  writeFileSync(join(path, 'features/demo/core/index.ts'), 'export {}\n')
  git(parent, 'init', '--quiet', '--initial-branch=main', path)
  git(path, 'add', '.')
  git(path, 'commit', '--quiet', '-m', 'first')
  git(path, 'tag', 'v1')
  const first = git(path, 'rev-parse', 'HEAD')
  writeFileSync(join(path, 'recipes/demo/SPEC.md'), '# Spec\n')
  git(path, 'add', '.')
  git(path, 'commit', '--quiet', '-m', 'second')
  return { path, first, second: git(path, 'rev-parse', 'HEAD') }
}

function boxFixture(parent: string, source: string, local?: string): string {
  const box = join(parent, 'box')
  mkdirSync(box, { recursive: true })
  writeFileSync(join(box, 'box.json'), JSON.stringify({ stack: { source } }))
  if (local) writeFileSync(join(box, 'box.local.json'), JSON.stringify({ stack: { source: local } }))
  return box
}

test('parses the two verbs and their options', () => {
  assert.deepEqual(parseStackArgs(['where']), { verb: 'where' })
  assert.deepEqual(parseStackArgs(['fetch']), { verb: 'fetch', quiet: false })
  assert.deepEqual(parseStackArgs(['fetch', '--ref', 'v1', '--quiet']), { verb: 'fetch', ref: 'v1', quiet: true })
  assert.deepEqual(parseStackArgs(['fetch', '--ref=main']), { verb: 'fetch', ref: 'main', quiet: false })
  assert.throws(() => parseStackArgs([]), /Expected: box stack where/)
  assert.throws(() => parseStackArgs(['clone']), /Expected: box stack where/)
  assert.throws(() => parseStackArgs(['where', '--json']), /takes no arguments/)
  assert.throws(() => parseStackArgs(['fetch', '--ref']), /--ref needs a revision/)
  assert.throws(() => parseStackArgs(['fetch', '--ref=--upload-pack=x']), /Invalid revision/)
  assert.throws(() => parseStackArgs(['fetch', '--mystery']), /Unknown option/)
})

test('a path source is reported and read in place, and a local override wins', () => {
  const parent = temp()
  const stack = stackFixture(parent)
  const box = boxFixture(parent, 'silkweave/stack', '../stack')
  const info = stackInfo(box)
  assert.deepEqual(info.location, { kind: 'path', path: stack.path })
  assert.equal(info.head, stack.second)
  assert.equal(info.recipes, true)
  assert.equal(info.features, true)
  assert.deepEqual(formatWhere(info).slice(0, 3), ['source    ../stack', 'kind      path', `location  ${stack.path}`])

  assert.deepEqual(fetchStack(box), { path: stack.path, commit: stack.second, warnings: [] })
  const pinned = fetchStack(box, 'v1')
  assert.equal(pinned.commit, stack.second)
  assert.match(pinned.warnings[0] ?? '', new RegExp(`at ${stack.second}, not v1 \\(${stack.first}\\)`))
  // Never touches the user's checkout.
  assert.equal(git(stack.path, 'rev-parse', 'HEAD'), stack.second)
  assert.equal(git(stack.path, 'status', '--porcelain'), '')
})

test('a path source without the Stack layout is refused', () => {
  const parent = temp()
  mkdirSync(join(parent, 'elsewhere', 'recipes'), { recursive: true })
  const box = boxFixture(parent, '../elsewhere')
  assert.throws(() => fetchStack(box), /not a Stack checkout: it has no features\/ directory/)
  assert.throws(() => fetchStack(boxFixture(temp(), '../missing')), /not a directory/)
})

test('a git source is cloned into .stack/, refreshed, detached at a ref, and a foreign cache is refused', () => {
  const parent = temp()
  const stack = stackFixture(parent)
  const url = `file://${stack.path}`
  const box = boxFixture(parent, url)
  assert.equal(stackInfo(box).cached, null)

  const first = fetchStack(box)
  assert.deepEqual(first, { path: join(box, '.stack'), commit: stack.second, warnings: [] })
  assert.equal(stackInfo(box).cached, stack.second)

  const tagged = fetchStack(box, 'v1')
  assert.equal(tagged.commit, stack.first)
  assert.equal(git(join(box, '.stack'), 'rev-parse', 'HEAD'), stack.first)

  writeFileSync(join(stack.path, 'recipes/demo/INSTALL.md'), '# Install\n')
  git(stack.path, 'add', '.')
  git(stack.path, 'commit', '--quiet', '-m', 'third')
  assert.equal(fetchStack(box, 'main').commit, git(stack.path, 'rev-parse', 'HEAD'))

  const other = boxFixture(temp(), 'file:///somewhere/else')
  mkdirSync(join(other, '.stack'))
  assert.throws(() => fetchStack(other), /exists but is not a git checkout.*delete it/)
  rmSync(join(other, '.stack'), { recursive: true })
  git(other, 'clone', '--quiet', url, '.stack')
  assert.throws(() => fetchStack(other), /is a checkout of .*, not file:\/\/\/somewhere\/else.*delete it/)
})

test('a failed HTTPS GitHub fetch points at the SSH source; other URLs get no hint', () => {
  assert.match(httpsFetchHint('https://github.com/silkweave/stack.git') ?? '', /"source": "git@github.com:silkweave\/stack.git".*box.local.json.*\.stack\//)
  assert.equal(httpsFetchHint('git@github.com:silkweave/stack.git'), undefined)
  assert.equal(httpsFetchHint('https://example.com/o/r.git'), undefined)
})
