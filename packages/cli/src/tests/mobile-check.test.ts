import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageHash, pathDependencies } from '../mobile-check.ts'

function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), 'mobile-check-'))
  const write = (file: string, text: string): void => { mkdirSync(join(root, file, '..'), { recursive: true }); writeFileSync(join(root, file), text) }
  write('.gitignore', '.dart_tool/\nbuild/\n')
  write('packages/mobile/pubspec.yaml', 'name: box_mobile\n')
  write('packages/mobile/lib/a.dart', 'void a() {}\n')
  write('features/x/mobile/pubspec.yaml', 'name: box_x\ndependencies:\n  box_mobile:\n    path: ../../../packages/mobile\n')
  write('features/y/mobile/pubspec.yaml', 'name: box_y\n')
  write('apps/mobile/pubspec.yaml', 'name: box_app\ndependencies:\n  box_x:\n    path: ../../features/x/mobile\n  box_y:\n    path: "../../features/y/mobile" # module\n')
  spawnSync('git', ['init', '-q'], { cwd: root })
  return root
}

test('path dependencies resolve from the pubspec, quoted or not', () => {
  const root = checkout()
  try {
    assert.deepEqual(pathDependencies(join(root, 'apps/mobile')), [join(root, 'features/x/mobile'), join(root, 'features/y/mobile')])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a package hash follows its own files, its path dependencies and the Flutter version, not ignored output', () => {
  const root = checkout()
  try {
    const hash = (dir: string, version = '3.47') => packageHash(root, join(root, dir), version)
    const app = hash('apps/mobile'), y = hash('features/y/mobile')
    assert.ok(app && y)
    mkdirSync(join(root, 'packages/mobile/.dart_tool'))
    writeFileSync(join(root, 'packages/mobile/.dart_tool/state.json'), '{}')
    assert.equal(hash('apps/mobile'), app, 'ignored tool state is not an input')
    assert.notEqual(hash('apps/mobile', '3.48'), app, 'the Flutter version is an input')
    writeFileSync(join(root, 'packages/mobile/lib/a.dart'), 'void a() { print(1); }\n')
    assert.notEqual(hash('apps/mobile'), app, 'a transitive path dependency is an input')
    assert.equal(hash('features/y/mobile'), y, 'an unrelated module keeps its hash')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('outside a git checkout there is no hash, so the package is always checked', () => {
  const root = mkdtempSync(join(tmpdir(), 'mobile-nogit-'))
  try {
    writeFileSync(join(root, 'pubspec.yaml'), 'name: lone\n')
    assert.equal(packageHash(root, root, '3.47'), null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
