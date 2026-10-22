import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('public commands use the enclosing Box, forward arguments and return the child exit status', () => {
  const root = mkdtempSync(join(tmpdir(), 'box-commands-'))
  try {
    for (const dir of ['apps/server/scripts', 'packages/core', 'packages/cli/src']) mkdirSync(join(root, dir), { recursive: true })
    for (const dir of ['apps/server', 'packages/core']) writeFileSync(join(root, dir, 'package.json'), '{}')
    const stub = "console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2),bun:process.versions.bun})); process.exitCode=7"
    writeFileSync(join(root, 'packages/cli/src/verify.ts'), stub)
    writeFileSync(join(root, 'packages/cli/src/app-control.ts'), stub)
    writeFileSync(join(root, 'packages/cli/src/stack.ts'), stub)
    writeFileSync(join(root, 'apps/server/scripts/auth-login.ts'), stub)
    writeFileSync(join(root, 'apps/server/scripts/setup.ts'), stub)
    writeFileSync(join(root, 'command.ts'), stub)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: {
      build: 'bun command.ts build', dev: 'bun command.ts dev', start: 'bun command.ts start', 'start:prod': 'bun command.ts production',
    } }))
    // Launch the real dispatch from outside its own checkout, as the installed shim does.
    for (const [args, expected] of [
      [['verify', '--plain'], ['--plain']], [['build', '--force'], ['build', '--force']],
      [['setup', '--yes', '--owner', 'alice'], ['--yes', '--owner', 'alice']],
      [['app', 'restart'], ['restart']],
      [['stack', 'fetch', '--ref', 'v1', '--quiet'], ['fetch', '--ref', 'v1', '--quiet']],
      [['dev'], ['dev']], [['start', '--prod'], ['production']], [['auth', 'login', 'alice', '--ttl', '5'], ['alice', '--ttl', '5']],
    ]) {
      const child = spawnSync(process.execPath, ['--no-env-file', new URL('../index.ts', import.meta.url).pathname, ...args], {
        cwd: join(root, 'apps/server'), encoding: 'utf8', env: { ...process.env, BOX_INVOKED_FROM: root }, timeout: 10000,
      })
      assert.equal(child.status, 7, child.stderr)
      const output = JSON.parse(child.stdout.trim())
      assert.deepEqual(output.args, expected)
      assert.ok(output.bun, 'commands must execute under Bun')
      // macOS resolves /var to /private/var when a script runner changes directories.
      assert.ok(output.cwd.endsWith(root.split('/').at(-1)))
    }
    const retired = spawnSync(process.execPath, ['--no-env-file', new URL('../index.ts', import.meta.url).pathname, 'auth', 'link', 'alice'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, BOX_INVOKED_FROM: root }, timeout: 10000,
    })
    assert.equal(retired.status, 1)
    assert.match(retired.stderr, /expected one of: token, login, reveal/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('shim installer recognizes a Bun-only checkout and preserves foreign programs', () => {
  const root = mkdtempSync(join(tmpdir(), 'box-shim-'))
  try {
    const bin = join(root, 'bin')
    const checkout = join(root, 'checkout')
    for (const dir of ['apps/server', 'packages/core', 'packages/cli/src', 'packages/cli/bin']) mkdirSync(join(checkout, dir), { recursive: true })
    for (const dir of ['apps/server', 'packages/core']) writeFileSync(join(checkout, dir, 'package.json'), '{}')
    for (const file of ['box-install.ts', 'repo.ts']) copyFileSync(new URL(`../${file}`, import.meta.url), join(checkout, 'packages/cli/src', file))
    writeFileSync(join(checkout, 'packages/cli/bin/box'), '#!/bin/sh\n')
    const invoke = () => spawnSync(process.execPath, ['--no-env-file', join(checkout, 'packages/cli/src/box-install.ts'), `--bin-dir=${bin}`], { encoding: 'utf8' })
    assert.equal(invoke().status, 0)
    assert.equal(readlinkSync(join(bin, 'box')), realpathSync(join(checkout, 'packages/cli/bin/box')))
    rmSync(join(bin, 'box'))
    writeFileSync(join(bin, 'box'), 'someone else owns this')
    const refused = invoke()
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /refusing to replace/)
    // A deleted Box's shim dangles and is replaced; a dangling link of another shape is left alone.
    rmSync(join(bin, 'box'))
    symlinkSync(join(root, 'deleted-box/packages/cli/bin/box'), join(bin, 'box'))
    assert.equal(invoke().status, 0)
    assert.equal(readlinkSync(join(bin, 'box')), realpathSync(join(checkout, 'packages/cli/bin/box')))
    rmSync(join(bin, 'box'))
    symlinkSync(join(root, 'gone/bin/box'), join(bin, 'box'))
    assert.equal(invoke().status, 1)
    assert.equal(readlinkSync(join(bin, 'box')), join(root, 'gone/bin/box'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
