import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

interface Harness {
  root: string
  write: (path: string, content?: string) => void
  link: (path: string, target: string) => void
  exec: (...args: string[]) => SpawnSyncReturns<string>
}

// The fixture mirrors the REAL layout: `skills.ts` finds the checkout by going three directories
// up from its own file, so it has to sit at `packages/cli/src/` inside the throwaway root, next to
// the `repo.ts` it imports. The scratch lives under the OS temp dir, like the rest of this repo's
// tests, because Node refuses to strip types from a file under `node_modules`.
function fixture(run: (harness: Harness) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'box-skill-'))
  const write = (path: string, content = 'fixture'): void => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content) }
  const link = (path: string, target: string): void => { mkdirSync(dirname(join(root, path)), { recursive: true }); symlinkSync(target, join(root, path)) }
  write('packages/cli/src/skills.ts')
  for (const file of ['skills.ts', 'repo.ts']) copyFileSync(new URL(`../${file}`, import.meta.url), join(root, 'packages/cli/src', file))
  for (const core of ['setup-box', 'consult', 'adapt', 'upgrade', 'verify']) write(`.claude/skills/${core}/SKILL.md`)
  write('features/demo/skills/draft/SKILL.md', '---\nname: draft\nrequires: [demo]\n---\nRecipe')
  write('features/demo/skills/draft/support.md', 'support')
  write('features/demo/core/manifest.ts')
  const exec = (...args: string[]): SpawnSyncReturns<string> => spawnSync(process.execPath, ['packages/cli/src/skills.ts', ...args], { cwd: root, encoding: 'utf8' })
  try { run({ root, write, link, exec }) } finally { rmSync(root, { recursive: true, force: true }) }
}
function snapshot(root: string): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  function visit(path: string): void {
    for (const name of readdirSync(join(root, path))) {
      const child = path ? `${path}/${name}` : name
      const stat = lstatSync(join(root, child))
      if (stat.isSymbolicLink()) result[child] = ['link', readlinkSync(join(root, child))]
      else if (stat.isDirectory()) { result[child] = ['dir']; visit(child) }
      else result[child] = ['file', readFileSync(join(root, child), 'utf8')]
    }
  }
  visit('')
  return result
}
for (const farm of ['.claude', '.agents']) {
  for (const check of [false, true]) {
    test(`${farm} collision preserves both farms without partial writes (${check ? 'check' : 'write'})`, () => fixture(({ root, write, link, exec }) => {
      write(`${farm}/skills/draft/personal.md`, 'do not delete')
      link('.claude/skills/stale', '../../features/gone/skills/stale')
      const before = snapshot(root)
      const result = exec(...(check ? ['--check'] : []))
      assert.equal(result.status, 1)
      assert.match(result.stderr, /refusing to replace personal skill/)
      assert.deepEqual(snapshot(root), before)
    }))
  }
}
test('generation preserves personal entries and supporting files, retires stale managed links, and is idempotent', () => fixture(({ root, write, link, exec }) => {
  for (const farm of ['.claude', '.agents']) {
    write(`${farm}/skills/personal/SKILL.md`)
    link(`${farm}/skills/custom-link`, '../../personal-source')
    link(`${farm}/skills/stale`, '../../features/gone/skills/stale')
  }
  assert.equal(exec().status, 0)
  for (const farm of ['.claude', '.agents']) {
    assert.equal(readFileSync(join(root, `${farm}/skills/draft/support.md`), 'utf8'), 'support')
    assert.ok(existsSync(join(root, `${farm}/skills/personal/SKILL.md`)))
    assert.equal(readlinkSync(join(root, `${farm}/skills/custom-link`)), '../../personal-source')
    assert.equal(lstatSync(join(root, `${farm}/skills/stale`), { throwIfNoEntry: false }), undefined)
  }
  const before = snapshot(root)
  assert.equal(exec('--check').status, 0)
  assert.equal(exec().status, 0)
  assert.deepEqual(snapshot(root), before)
}))
test('broken generated links repair; requires gating removes skills when code disappears', () => fixture(({ root, link, exec }) => {
  link('.claude/skills/draft', '../../missing')
  link('.agents/skills/draft', '../../missing')
  assert.match(exec('--check').stderr, /points elsewhere/)
  assert.equal(exec().status, 0)
  rmSync(join(root, 'features/demo/core'), { recursive: true })
  assert.equal(exec().status, 0)
  assert.equal(existsSync(join(root, '.claude/skills/draft')), false)
  assert.equal(existsSync(join(root, '.agents/skills/draft')), false)
  assert.ok(existsSync(join(root, '.agents/skills/consult/SKILL.md')))
}))
test('a missing secondary requirement withholds both agents recipes', () => fixture(({ root, write, exec }) => {
  write('features/extra/SPEC.md')
  write('features/demo/skills/draft/SKILL.md', '---\nrequires: [demo, extra]\n---\nRecipe')
  assert.equal(exec().status, 0)
  assert.equal(existsSync(join(root, '.claude/skills/draft')), false)
  assert.equal(existsSync(join(root, '.agents/skills/draft')), false)
}))
