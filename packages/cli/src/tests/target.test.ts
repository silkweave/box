// Which Box `box` acts on. The predicate underneath it decides where `db restore` writes and where
// feature integration writes into, so the two trees that used to be classified wrongly get a
// named case each (see the rationale on `isBoxRoot` in repo.ts).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { findBoxRoot, isBoxRoot } from '../repo.ts'

/** Build a tree from `path -> contents`, and hand back its root. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'box-target-test-'))
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
  return root
}

const BOX = {
  'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n  - 'packages/*'\n",
  'apps/server/package.json': '{ "name": "@silkweave/box-server" }',
  'packages/core/package.json': '{ "name": "@silkweave/box-core", "version": "1.0.0" }',
}

const roots: string[] = []
const make = (files: Record<string, string>): string => {
  const r = tree(files)
  roots.push(r)
  return r
}
test.after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

test('a Box checkout is a server package and a core package', () => {
  assert.equal(isBoxRoot(make(BOX)), true)
})

test('a Box with no pnpm-workspace.yaml is still a Box', () => {
  // box-apps hides `box/pnpm-workspace.yaml` with sparse-checkout so pnpm cannot find a second
  // workspace root. That tree builds, boots and holds the node_modules - it is the Box.
  const { 'pnpm-workspace.yaml': _hidden, ...rest } = BOX
  assert.equal(isBoxRoot(make(rest)), true)
})

test('a repo that only holds app SOURCE is not a Box', () => {
  // silkweave/box-apps: a workspace root whose apps/server and packages/core hold the published
  // apps' truth and no package of their own. It used to match, and `box` then targeted it.
  const root = make({
    'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n",
    'package.json': '{ "name": "silkweave-box-apps" }',
    'features/crm/server/index.ts': 'export default {}\n',
    'features/crm/core/manifest.ts': 'export default {}\n',
    'features/crm/web/index.tsx': 'export default {}\n',
  })
  assert.equal(isBoxRoot(root), false)
})

test('a random pnpm monorepo is not a Box', () => {
  assert.equal(isBoxRoot(make({ 'pnpm-workspace.yaml': 'packages:\n', 'packages/thing/package.json': '{}' })), false)
})

test('half a Box is not a Box', () => {
  assert.equal(isBoxRoot(make({ 'apps/server/package.json': '{}' })), false)
  assert.equal(isBoxRoot(make({ 'packages/core/package.json': '{}' })), false)
})

test('findBoxRoot walks up to the nearest Box and stops', () => {
  const root = make(BOX)
  assert.equal(findBoxRoot(join(root, 'apps/server')), root)
  assert.equal(findBoxRoot(join(root, 'packages/core')), root)
  assert.equal(findBoxRoot(root), root)
})

test('findBoxRoot walks PAST a feature source repo to the Box nested in it', () => {
  // A source repository can contain feature reference code and a nested Box checkout. Standing
  // in the nested checkout must resolve it, not the repo above it.
  const pair = make({
    'pnpm-workspace.yaml': 'packages:\n',
    'features/crm/server/index.ts': 'export default {}\n',
    'box/apps/server/package.json': '{ "name": "@silkweave/box-server" }',
    'box/packages/core/package.json': '{ "name": "@silkweave/box-core", "version": "1.0.0" }',
  })
  assert.equal(findBoxRoot(join(pair, 'box')), join(pair, 'box'))
  assert.equal(findBoxRoot(join(pair, 'box/apps/server')), join(pair, 'box'))
  // From the feature source root there is no Box at all, so callers can fall back to their
  // registered checkout rather than writing into a source-only repository.
  assert.equal(findBoxRoot(pair), null)
})
