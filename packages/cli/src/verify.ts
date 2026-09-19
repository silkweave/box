import { basename } from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import { isMain, repoRoot } from './repo.ts'
import { runTasks, type RunState, type Task } from './tasks.ts'
import { taskReceipt, taskRows } from './task-view.ts'
import { cleanText, elapsedText, screenFrame } from './ui.ts'

// The same ordered contract as the original package script, including skill linking.
export function verifyTasks(pnpm = process.env.npm_execpath): Task[] {
  // pnpm ships both JavaScript entry points and standalone native executables.
  const script = pnpm !== undefined && /\.[cm]?js$/i.test(pnpm)
  const definitions: [string, string, string, string[]][] = [
    ['build', 'Build workspace', 'Build', ['build']],
    ['skills', 'Link skills', 'Prepare', ['skills']],
    ['cli-tests', 'CLI tests', 'Prepare', ['test:cli']],
    ['typegen', 'Generate types', 'Prepare', ['typegen']],
    ['typecheck', 'Typecheck', 'Check', ['typecheck']],
    ['lint', 'Lint', 'Check', ['lint']],
    ['core-tests', 'Core tests', 'Validate', ['-F', '@silkweave/box-core', 'test']],
    ['server-tests', 'Server tests', 'Validate', ['-F', '@silkweave/box-server', 'test']],
    ['schema', 'Schema matrix', 'Validate', ['schema:check']],
  ]
  return definitions.map(([id, name, phase, args]) => ({
    id, name, phase, command: `pnpm ${args.join(' ')}`,
    executable: script ? process.execPath : pnpm ?? 'pnpm', args: script ? [pnpm!, ...args] : args,
  }))
}

export async function main(argv: string[]): Promise<number> {
  let values
  try {
    ({ values } = parseArgs({ args: argv, options: {
      plain: { type: 'boolean' }, verbose: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
    } }))
  } catch (error) { process.stderr.write(`${(error as Error).message}\nUse pnpm verify --help for usage.\n`); return 2 }
  if (values.help) {
    process.stdout.write('Verify this checkout: build, skills, CLI tests, generated types, types, lint, core tests, server tests and schema.\n\n  pnpm verify             Live progress in a terminal; concise output in CI\n  pnpm verify --plain     Append-only progress without ANSI\n  pnpm verify --verbose   Append-only progress and full child output\n\nLive keys: d toggles output detail; Ctrl+C cancels the active command and descendants.\nMotion is always on. Complete command logs are retained in a private temporary directory.\n')
    return 0
  }
  const out = process.stdout, input = process.stdin
  const live = Boolean(out.isTTY && !values.plain && !values.verbose && !process.env.CI && process.env.TERM !== 'dumb')
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
    } else write(`silkweave / verify · ${target}\n`)
    const result = await runTasks(verifyTasks(), {
      cwd: repoRoot, signal: controller.signal,
      onUpdate(next) {
        state = next
        if (!live) for (const task of next.tasks) {
          if (statuses.get(task.id) === task.status || task.status === 'pending') continue
          statuses.set(task.id, task.status)
          write(`[${task.status}] ${task.name}${task.status === 'running' ? ` · ${task.command}` : task.started ? ` · ${elapsedText(task.elapsed)}` : ''}\n`)
        }
      },
      onLine(task, line) { if (values.verbose) write(`[${task.name}] ${line}\n`) },
    })
    restore()
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
