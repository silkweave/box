import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import { isMain, repoRoot } from './repo.ts'
import { runTasks, type RunState, type Task, type TaskState } from './tasks.ts'
import { taskReceipt, taskRows, warningExcerpt } from './task-view.ts'
import { cleanText, elapsedText, screenFrame } from './ui.ts'

// The verification contract, including skill linking. Every check except mobile needs the build;
// the typecheck also needs freshly generated types. Otherwise checks are independent: they run
// concurrently, and one failure (a timing-sensitive test on a loaded host, say) still lets the
// rest run and report. Core and server tests share one Turbo invocation, because two concurrent
// invocations would both schedule the dependency builds under each other.
// --force reruns these instead of replaying cached results (Turbo's cache, the mobile check's own).
const FORCE_SCRIPTS = new Set(['build', 'typecheck', 'test:packages', 'test:mobile'])
const TEST_SCRIPTS = new Set(['test:packages'])

// Timings and test totals of the last passing run, so progress has an honest denominator.
type History = Record<string, { elapsed: number; total?: number }>
const historyFile = (root: string): string => join(root, 'node_modules', '.cache', 'silkweave-verify.json')
function readHistory(root: string): History {
  try { return JSON.parse(readFileSync(historyFile(root), 'utf8')) as History } catch { return {} }
}
function writeHistory(root: string, state: RunState, previous: History): void {
  const next: History = { ...previous }
  for (const task of state.tasks) {
    if (task.status !== 'passed') continue
    // A cache replay says nothing about how long the real work takes.
    next[task.id] = { elapsed: task.cached ? previous[task.id]?.elapsed ?? task.elapsed : Math.round(task.elapsed), total: task.progress?.total ?? previous[task.id]?.total }
  }
  try { mkdirSync(dirname(historyFile(root)), { recursive: true }); writeFileSync(historyFile(root), JSON.stringify(next) + '\n') }
  catch { /* Progress estimates are optional. */ }
}

/** One machine-readable progress line for `--json`: the Builder renders it as a task list. */
export function verifyEvent(state: RunState, now = performance.now()): string {
  const task = (t: TaskState) => ({
    id: t.id, name: t.name, phase: t.phase, command: t.command, status: t.status,
    elapsed: Math.round(t.status === 'running' ? now - t.started : t.elapsed),
    expected: t.expected?.elapsed, progress: t.progress, cached: t.cached,
    warnings: t.warnings.map(warningExcerpt),
    diagnostics: t.status === 'failed' || t.status === 'cancelled' ? [...new Set([...t.diagnostics, ...t.tail.slice(-12)])] : [],
    exitCode: t.exitCode, log: t.log,
  })
  return JSON.stringify({
    verify: 1, elapsed: Math.round(state.finished ? state.elapsed : now - state.started), finished: state.finished,
    cancelled: state.cancelled, logDirectory: state.logDirectory, tasks: state.tasks.map(task),
  }) + '\n'
}

export function verifyTasks(bun = process.versions.bun ? process.execPath : 'bun', { force = false } = {}): Task[] {
  const definitions: [string, string, string, string[], string[]][] = [
    ['build', 'Build workspace', 'Build', ['build'], []],
    ['skills', 'Link skills', 'Prepare', ['skills'], ['build']],
    ['cli-tests', 'CLI tests', 'Prepare', ['test:cli'], ['build']],
    ['web-tests', 'Web tests', 'Prepare', ['test:web'], ['build']],
    // The adapter currently reports every nested reflected DTO as `unknown` (212 procedures in
    // the full Stack). Those are known type-precision debt, not run-specific verification
    // findings. Keep direct `bun run typegen` verbose for schema work, but do not make every
    // otherwise-clean verify permanently yellow.
    ['typegen', 'Generate types', 'Prepare', ['typegen', '--quiet'], ['build']],
    ['typecheck', 'Typecheck', 'Check', ['typecheck'], ['build', 'typegen']],
    ['lint', 'Lint', 'Check', ['lint'], ['build']],
    // Turbo-cached: a package's tests rerun only when its inputs or a dependency's build changed.
    ['package-tests', 'Core and server tests', 'Validate', ['test:packages'], ['build']],
    ['schema', 'Schema matrix', 'Validate', ['schema:check'], ['build']],
    // Flutter analyze and test for the mobile framework, modules and app. Passes with a skip when
    // the Flutter SDK is not installed. It needs nothing from the build, so it starts at once, and
    // skips a package whose inputs match its last passing check.
    ['mobile', 'Mobile app', 'Validate', ['test:mobile'], []],
  ]
  return definitions.map(([id, name, phase, script, needs]) => {
    const forced = force && FORCE_SCRIPTS.has(script[0]!) ? [...script, '--force'] : script
    // Vitest hides per-file results when it detects an agent; the default reporter keeps the
    // finished-file lines that drive test progress. `bun run` drops a leading `--`, and Turbo
    // hands everything after the next `--` to the package test task.
    // Oxlint's graphical report spreads one finding over several lines; the unix format keeps
    // file, position, message and rule on the one line a warning excerpt shows.
    const args = TEST_SCRIPTS.has(script[0]!) ? [forced[0]!, '--', ...forced.slice(1), '--', '--reporter=default']
      : script[0] === 'lint' ? [...forced, '--format=unix'] : forced
    return {
      id, name, phase, needs, command: `bun run ${forced.join(' ')}`,
      executable: bun, args: ['--bun', '--no-env-file', 'run', ...args],
    }
  })
}

export async function main(argv: string[]): Promise<number> {
  let values
  try {
    ({ values } = parseArgs({ args: argv, options: {
      plain: { type: 'boolean' }, json: { type: 'boolean' }, list: { type: 'boolean' }, verbose: { type: 'boolean' }, force: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    } }))
  } catch (error) { process.stderr.write(`${(error as Error).message}\nUse box verify --help for usage.\n`); return 2 }
  if (values.help) {
    process.stdout.write('Verify this checkout: build, skills, CLI tests, web tests, generated types, types, lint, core and server tests, schema and the mobile app.\n\n  box verify             Live progress in a terminal; concise output in CI\n  box verify --plain     Append-only progress without ANSI\n  box verify --json      Progress snapshots as JSON lines, then the plain receipt\n  box verify --list      The checks as one JSON line, without running them\n  box verify --verbose   Append-only progress and full child output\n  box verify --force     Rerun build, typecheck, tests and the mobile check instead of replaying cached results\n\nLive keys: d toggles output detail; Ctrl+C cancels the active command and descendants.\nMotion is always on. Complete command logs are retained in a private temporary directory.\n')
    return 0
  }
  if (values.list) {
    const history = readHistory(repoRoot)
    process.stdout.write(JSON.stringify(verifyTasks().map(({ id, name, phase, command }) => ({ id, name, phase, command, expected: history[id]?.elapsed }))) + '\n')
    return 0
  }
  const out = process.stdout, input = process.stdin
  const live = Boolean(out.isTTY && !values.plain && !values.json && !values.verbose && !process.env.CI && process.env.TERM !== 'dumb')
  const interactive = live && Boolean(input.isTTY)
  const depth = Object.hasOwn(process.env, 'NO_COLOR') ? 1 : out.getColorDepth?.() ?? 1
  const controller = new AbortController()
  let state: RunState | undefined, timer: ReturnType<typeof setInterval> | undefined
  let details = false, screen = false, brokenOutput = false
  const previousRaw = input.isRaw
  const statuses = new Map<string, string>()
  const target = cleanText(basename(repoRoot))
  const write = (text: string): void => { if (!brokenOutput) out.write(text) }
  const draw = (): void => {
    if (!state || !screen) return
    const height = out.rows || 24
    write(screenFrame(taskRows(state, target, height, details, interactive), out.columns || 80, height, depth, performance.now()))
  }
  const restore = (): void => {
    if (timer) clearInterval(timer)
    if (screen) { write('\x1b[0m\x1b[?25h\x1b[?1049l'); screen = false }
    if (interactive) { input.setRawMode(previousRaw ?? false); input.pause() }
  }
  const cancel = (): void => { controller.abort(); if (state) state.cancelled = true; draw() }
  const onKey = (chunk: Buffer): void => {
    if (chunk.includes(3)) cancel()
    else if (chunk.toString() === 'd') { details = !details; draw() }
  }
  const onOutputError = (): void => { brokenOutput = true; cancel() }
  process.on('SIGINT', cancel)
  process.on('SIGTERM', cancel)
  process.on('exit', restore)
  out.on('error', onOutputError)
  try {
    if (live) {
      write('\x1b[?1049h\x1b[?25l\x1b[2J')
      screen = true
      if (interactive) { input.setRawMode(true); input.resume(); input.on('data', onKey) }
      timer = setInterval(draw, 80)
    } else if (values.json) {
      // A heartbeat keeps elapsed time moving through checks that print nothing for a while.
      timer = setInterval(() => { if (state && !state.finished) write(verifyEvent(state)) }, 1000)
    } else write(`silkweave / verify · ${target}\n`)
    const history = readHistory(repoRoot)
    const tasks = verifyTasks(undefined, { force: values.force }).map(t => ({ ...t, expected: history[t.id] }))
    let lastEvent = 0, lastShape = ''
    const result = await runTasks(tasks, {
      cwd: repoRoot, signal: controller.signal,
      onUpdate(next) {
        state = next
        if (values.json) {
          // Status changes go out at once; streaming output at most four times a second.
          const shape = next.tasks.map(t => t.status).join() + next.finished
          const now = performance.now()
          if (shape !== lastShape || now - lastEvent >= 250) { lastShape = shape; lastEvent = now; write(verifyEvent(next, now)) }
          return
        }
        if (!live) for (const task of next.tasks) {
          if (statuses.get(task.id) === task.status || task.status === 'pending') continue
          statuses.set(task.id, task.status)
          write(`[${task.status}] ${task.name}${task.status === 'running' ? ` · ${task.command}` : task.started ? ` · ${elapsedText(task.elapsed)}` : ''}\n`)
        }
      },
      onLine(task, line) { if (values.verbose) write(`[${task.name}] ${line}\n`) },
    })
    restore()
    writeHistory(repoRoot, result, history)
    write(taskReceipt(result, { depth: live ? depth : 1, columns: out.columns || 100 }))
    if (brokenOutput) return 1
    if (result.cancelled) return 130
    const failed = result.tasks.find(task => task.status === 'failed')
    return failed ? (failed.exitCode !== null && failed.exitCode > 0 ? failed.exitCode : 1) : 0
  } catch (error) {
    restore()
    process.stderr.write(`verify: ${(error as Error).message}\n`)
    return 1
  } finally {
    restore()
    input.removeListener('data', onKey)
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
    process.removeListener('exit', restore)
    // Keep the output error handler until pending writes have drained.
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2))
}
