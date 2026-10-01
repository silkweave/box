import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { runTasks, OutputLines, isWarning, readProgress, type Task, type TaskState, type RunState } from '../tasks.ts'
import { cleanText, clip, screenFrame, span, widthOf } from '../ui.ts'
import { taskReceipt, taskRows } from '../task-view.ts'
import { verifyEvent, verifyTasks } from '../verify.ts'

const task = (id: string, code: string, phase = 'Build'): Task => ({
  id, name: id, phase, command: `node ${id}`, executable: process.execPath, args: ['-e', code],
})
function cleanup(state: RunState): void { rmSync(state.logDirectory, { recursive: true, force: true }) }

test('verify keeps the eleven-command order and package-manager entry point', () => {
  const tasks = verifyTasks('/example/bun')
  assert.deepEqual(tasks.map(t => t.command), [
    'bun run build', 'bun run skills', 'bun run test:cli', 'bun run test:web', 'bun run typegen --quiet', 'bun run typecheck', 'bun run lint',
    'bun run test:core', 'bun run test:server', 'bun run schema:check', 'bun run test:mobile',
  ])
  const forced = verifyTasks('/example/bun', { force: true })
  assert.deepEqual(forced.filter(t => t.command.endsWith('--force')).map(t => t.id), ['build', 'typecheck', 'core-tests', 'server-tests'])
  assert.ok(tasks.every(t => t.executable === '/example/bun'))
  assert.deepEqual(tasks[0].args, ['--bun', '--no-env-file', 'run', 'build'])
})

test('runs in the requested checkout, retains complete output, and stops at a failing check', async () => {
  const root = mkdtempSync(join(tmpdir(), 'verify-test-'))
  let state: RunState | undefined
  try {
    state = await runTasks([
      task('first', 'console.log(process.cwd()); console.log("WARN advisory"); console.log("x".repeat(20000))'),
      task('fail', 'console.error("error TS2322: wrong type"); process.exit(7)', 'Check'),
      task('never', 'require("node:fs").writeFileSync("should-not-exist", "bad")', 'Validate'),
    ], { cwd: root })
    assert.deepEqual(state.tasks.map(t => t.status), ['passed', 'failed', 'skipped'])
    assert.equal(state.tasks[1].exitCode, 7)
    const log = readFileSync(state.tasks[0].log, 'utf8')
    assert.ok(log.includes(root) && log.includes('x'.repeat(20000)))
    assert.equal(state.tasks[0].warnings.length, 1)
    assert.ok(state.tasks[0].tail.every(line => line.length <= 4096))
    assert.equal(existsSync(join(root, 'should-not-exist')), false)
    assert.equal(existsSync(state.tasks[2].log), false)
    if (process.platform !== 'win32') {
      assert.equal(statSync(state.logDirectory).mode & 0o777, 0o700)
      assert.equal(statSync(state.tasks[0].log).mode & 0o777, 0o600)
    }
    const receipt = taskReceipt(state)
    assert.match(receipt, /TS2322/)
    assert.match(receipt, /Not run: never/)
    assert.match(receipt, /Inspect: node fail/)
    assert.match(receipt, /Warning output in first/)
  } finally { if (state) cleanup(state); rmSync(root, { recursive: true, force: true }) }
})

test('declared needs keep independent checks running after an unrelated failure', async () => {
  const state = await runTasks([
    { ...task('build', ''), needs: [] },
    { ...task('tests', 'process.exit(3)', 'Validate'), needs: ['build'] },
    { ...task('schema', 'console.log("ran")', 'Validate'), needs: ['build'] },
    { ...task('types', '', 'Check'), needs: ['tests'] },
  ], { cwd: tmpdir() })
  try {
    assert.deepEqual(state.tasks.map(t => t.status), ['passed', 'failed', 'passed', 'skipped'])
    const receipt = taskReceipt(state)
    assert.match(receipt, /Failed: tests/)
    assert.match(receipt, /Not run: types/)
  } finally { cleanup(state) }
})

test('verify declares the build as every check\'s prerequisite and typegen before typecheck', () => {
  const needs = Object.fromEntries(verifyTasks('/example/bun').map(t => [t.id, t.needs]))
  assert.deepEqual(needs.build, [])
  assert.deepEqual(needs.typecheck, ['build', 'typegen'])
  assert.deepEqual(needs.schema, ['build'])
  assert.deepEqual(needs.mobile, [])
})

test('a spawn error fails the task and skips following tasks', async () => {
  const state = await runTasks([
    { ...task('missing', ''), executable: join(tmpdir(), 'silkweave-does-not-exist') }, task('never', ''),
  ], { cwd: tmpdir() })
  try {
    assert.deepEqual(state.tasks.map(t => t.status), ['failed', 'skipped'])
    assert.match(state.tasks[0].tail.join('\n'), /Unable to start/)
  } finally { cleanup(state) }
})

test('warning output survives successful checks without counting a no-warnings summary', async () => {
  assert.equal(isWarning('✔ warning output survives successful checks (10ms)'), false)
  assert.equal(isWarning('(pass) warning output survives successful checks [7.87ms]'), false)
  assert.equal(isWarning('(!) Some chunks are larger than 500 kB'), true)
  const state = await runTasks([task('warn', 'console.log("WARN advisory"); console.log("WARN advisory"); console.log("0 warnings"); console.log("no ownership warnings")')], { cwd: tmpdir() })
  try {
    assert.equal(state.tasks[0].status, 'passed')
    assert.deepEqual(state.tasks[0].warnings, ['WARN advisory'])
    assert.match(taskReceipt(state), /Verified with warning output/)
    const colored = taskReceipt(state, { depth: 24 })
    assert.ok(colored.includes('\x1b[38;2;'))
    assert.equal(stripVTControlCharacters(colored), taskReceipt(state))
    assert.ok(!colored.includes('\x1b[H'), 'scrollback receipt must not move the cursor')
    state.tasks[0].warnings = ['[Nest] 83060  - 09/19/2026, 4:17:48 PM    WARN [Silkweave] AuthController.me: ' + 'long reflection warning '.repeat(20)]
    const narrow = taskReceipt(state, { columns: 52 })
    const excerpt = narrow.split('\n').find(line => line.includes('AuthController.me'))!
    assert.ok(widthOf(excerpt) < 52)
    assert.ok(excerpt.endsWith('…') && !narrow.includes('[Nest]'))
    assert.ok(narrow.includes(state.logDirectory), 'full log path remains copyable')
  } finally { cleanup(state) }
})

test('CLI plain/verbose output, failure exits, and help operate from outside the checkout', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'verify-cli-')))
  const source = join(root, 'packages/cli/src')
  mkdirSync(source, { recursive: true })
  const scripts = Object.fromEntries(['build', 'skills', 'test:cli', 'test:web', 'typegen', 'typecheck', 'lint', 'test:core', 'test:server', 'schema:check', 'test:mobile'].map(name => [name, `bun fixture.cjs ${name}`]))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', workspaces: ['packages/*'], scripts }))
  for (const file of ['verify.ts', 'repo.ts', 'tasks.ts', 'ui.ts', 'task-view.ts']) copyFileSync(new URL(`../${file}`, import.meta.url), join(source, file))
  const fixture = join(root, 'fixture.cjs')
  const exec = (...args: string[]) => spawnSync(process.execPath, [join(source, 'verify.ts'), ...args], {
    cwd: tmpdir(), encoding: 'utf8', timeout: 10000,
  })
  const logs: string[] = []
  try {
    writeFileSync(fixture, `if (!process.cwd().startsWith(${JSON.stringify(root)})) process.exit(8); console.log('child-detail');`)
    const plain = exec('--plain')
    logs.push(plain.stdout.match(/^Logs: (.+)$/m)?.[1] ?? '')
    assert.equal(plain.status, 0, plain.stdout + plain.stderr)
    assert.match(plain.stdout, /11\/11 checks/)
    assert.ok(!plain.stdout.includes('child-detail') && !plain.stdout.includes('\x1b'))
    const verbose = exec('--verbose')
    logs.push(verbose.stdout.match(/^Logs: (.+)$/m)?.[1] ?? '')
    assert.equal(verbose.status, 0)
    assert.match(verbose.stdout, /\[Build workspace\] child-detail/)
    writeFileSync(fixture, 'if (process.argv[2] === "typecheck") { console.error("SyntaxError: regression fixture"); process.exit(7) }')
    const failure = exec('--plain')
    logs.push(failure.stdout.match(/^Logs: (.+)$/m)?.[1] ?? '')
    assert.equal(failure.status, 7)
    assert.match(failure.stdout, /SyntaxError: regression fixture/)
    assert.match(failure.stdout, /\[passed\] Lint/)
    assert.match(failure.stdout, /\[passed\] Schema matrix/)
    writeFileSync(fixture, 'if (process.argv[2] === "build") process.exit(5)')
    const broken = exec('--plain')
    logs.push(broken.stdout.match(/^Logs: (.+)$/m)?.[1] ?? '')
    assert.equal(broken.status, 5)
    assert.match(broken.stdout, /\[skipped\] Lint/)
    assert.equal(exec('--help').status, 0)
    assert.equal(exec('--no-motion').status, 2)
  } finally {
    for (const path of logs) if (path) rmSync(path, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('cancellation stops the active process and its SIGTERM-resistant descendant', { timeout: 10000, skip: process.platform === 'win32' }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'verify-cancel-'))
  const heartbeat = join(root, 'heartbeat')
  const controller = new AbortController()
  t.after(() => { controller.abort(); rmSync(root, { recursive: true, force: true }) })
  const grandchild = `process.on('SIGTERM', () => {}); setInterval(() => require('node:fs').appendFileSync(${JSON.stringify(heartbeat)}, 'x'), 25); console.log('grandchild-ready')`
  const parent = `process.on('SIGTERM', () => {}); require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], {stdio: 'inherit'}); setInterval(() => {}, 1000)`
  const state = await runTasks([task('parent', parent), task('never', '')], {
    cwd: root, signal: controller.signal,
    onLine(_task, line) { if (line === 'grandchild-ready') controller.abort() },
  })
  try {
    assert.deepEqual(state.tasks.map(s => s.status), ['cancelled', 'skipped'])
    assert.equal(state.cancelled, true)
    const before = existsSync(heartbeat) ? readFileSync(heartbeat, 'utf8') : ''
    await delay(150)
    const after = existsSync(heartbeat) ? readFileSync(heartbeat, 'utf8') : ''
    assert.equal(after, before, 'grandchild must stop writing after cancellation returns')
  } finally { cleanup(state) }
})

test('pre-cancelled runs start nothing', async () => {
  const controller = new AbortController(); controller.abort()
  const state = await runTasks([task('never', '')], { cwd: tmpdir(), signal: controller.signal })
  try { assert.equal(state.tasks[0].status, 'skipped'); assert.equal(state.cancelled, true) }
  finally { cleanup(state) }
})

test('output parsing handles split ANSI, CR progress and unterminated lines', () => {
  const lines: string[] = [], parser = new OutputLines(line => lines.push(line))
  parser.push('\x1b[3'); parser.push('1merror\x1b[0m\rworking\r\nlast'); parser.end()
  assert.deepEqual(lines, ['error', 'working', 'last'])
  assert.equal(cleanText('safe\x1b[2J\x1b]0;title\x07\u202ehidden'), 'safehidden')
  assert.equal(clip('你好e\u0301🙂', 6), '你好e\u0301…')
  assert.equal(widthOf('你好e\u0301🙂'), 7)
})

test('redraw removes shortened and blank line tails and rows from collapsed details', () => {
  // Replay the supported cursor/erase commands against a tiny terminal screen, not just snapshots.
  const cells: string[][] = Array.from({ length: 10 }, () => Array(40).fill(' '))
  let row = 0, column = 0
  const apply = (frame: string): void => {
    for (let i = 0; i < frame.length; i++) {
      if (frame[i] === '\x1b') {
        const command = frame.slice(i, i + 3)
        assert.ok(['\x1b[H', '\x1b[K', '\x1b[J'].includes(command))
        if (command.endsWith('H')) { row = 0; column = 0 }
        else if (command.endsWith('K')) cells[row].fill(' ', column)
        else { cells[row].fill(' ', column); for (let r = row + 1; r < cells.length; r++) cells[r].fill(' ') }
        i += 2
      } else if (frame[i] === '\r') column = 0
      else if (frame[i] === '\n') row++
      else cells[row][column++] = frame[i]
    }
  }
  apply(screenFrame([[span('running')], [span('workspace packages 4.0s')], [span('old activity')], [span('output detail')]], 40, 10, 1, 0))
  apply(screenFrame([[span('4.0s')], [], [span('new')]], 40, 10, 1, 80))
  assert.deepEqual(cells.slice(0, 5).map(line => line.join('').trimEnd()), ['4.0s', '', 'new', '', ''])
})

test('live rows remain within the terminal and activity always animates', async () => {
  const state = await runTasks([task('sample', '')], { cwd: tmpdir() })
  try {
    state.tasks[0].status = 'running'; state.finished = false
    for (const height of [12, 20, 24, 40]) {
      const rows = taskRows(state, 'test', height, true, true, state.started + 10)
      assert.ok(rows.length < height)
      const a = screenFrame(rows, 52, height, 24, 0), b = screenFrame(rows, 52, height, 24, 1000)
      assert.notEqual(a, b)
      assert.ok(!cleanText(a).includes('m motion'))
    }
  } finally { cleanup(state) }
})

test('reads Vitest and Bun test progress through Turbo prefixes', () => {
  const state = { progress: undefined, cached: false, expected: { elapsed: 1000, total: 30 } } as unknown as TaskState
  readProgress(state, '@silkweave/box-core:test: ✓ src/a.test.ts (12 tests) 34ms')
  readProgress(state, '@silkweave/box-core:test: ❯ src/b.test.ts (6 tests | 1 failed) 20ms')
  readProgress(state, '✓ editing and deleting (6)')
  assert.deepEqual(state.progress, { done: 18, total: 30, unit: 'tests' })
  readProgress(state, '@silkweave/box-core:test: Tests  1 failed | 31 passed (32)')
  assert.deepEqual(state.progress, { done: 32, total: 32, unit: 'tests' })
  const bun = { cached: false } as unknown as TaskState
  readProgress(bun, 'Ran 44 tests across 9 files. [3.15s]')
  assert.deepEqual(bun.progress, { done: 44, total: 44, unit: 'tests' })
  readProgress(bun, 'Cached:    2 cached, 2 total')
  assert.equal(bun.cached, true)
})

test('verify --json snapshots carry progress, warnings and failure diagnostics', async () => {
  const state = await runTasks([
    task('warn', 'console.log("@pkg:build: WARN careful"); console.log("Ran 3 tests across 1 files.")'),
    task('fail', 'console.error("error TS2322: wrong type"); process.exit(2)', 'Check'),
  ], { cwd: tmpdir() })
  try {
    const event = JSON.parse(verifyEvent(state))
    assert.equal(event.verify, 1)
    assert.deepEqual(event.tasks[0].warnings, ['WARN careful'])
    assert.deepEqual(event.tasks[0].progress, { done: 3, total: 3, unit: 'tests' })
    assert.equal(event.tasks[1].status, 'failed')
    assert.ok(event.tasks[1].diagnostics.some((line: string) => line.includes('TS2322')))
  } finally { cleanup(state) }
})

test('verify asks Vitest for per-file results without changing the displayed command', () => {
  const core = verifyTasks('/example/bun').find(t => t.id === 'core-tests')!
  assert.equal(core.command, 'bun run test:core')
  assert.deepEqual(core.args.slice(-4), ['test:core', '--', '--', '--reporter=default'])
  const forced = verifyTasks('/example/bun', { force: true }).find(t => t.id === 'core-tests')!
  assert.deepEqual(forced.args.slice(-5), ['test:core', '--', '--force', '--', '--reporter=default'])
})
