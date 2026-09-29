import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { cleanText } from './ui.ts'

export interface Task {
  id: string
  name: string
  phase: string
  command: string
  executable: string
  args: string[]
  /**
   * Task ids that must pass before this task runs. Omitted means every earlier task (fail-fast).
   * Declared needs let independent checks still run and report after an unrelated failure.
   */
  needs?: string[]
  /** What the previous passing run of this task took and counted, for progress estimates. */
  expected?: { elapsed: number; total?: number }
}
export type TaskStatus = 'pending' | 'running' | 'passed' | 'failed' | 'cancelled' | 'skipped'
export interface TaskState extends Task {
  status: TaskStatus
  started: number
  elapsed: number
  lastOutput: number
  tail: string[]
  warnings: string[]
  diagnostics: string[]
  log: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  /** Counted progress, when the command reports it (test files finishing, a final test total). */
  progress?: TaskProgress
  /** Turbo replayed every package task from its cache. */
  cached: boolean
}
export interface TaskProgress { done: number; total?: number; unit: string }
export interface RunState {
  tasks: TaskState[]
  started: number
  elapsed: number
  finished: boolean
  cancelled: boolean
  logDirectory: string
}
export interface RunOptions {
  cwd: string
  signal?: AbortSignal
  onUpdate?: (state: RunState) => void
  onLine?: (task: TaskState, line: string) => void
}

/** A bounded display buffer. The complete original bytes go separately to the task log. */
export class OutputLines {
  private pending = ''
  private emit: (line: string) => void
  constructor(emit: (line: string) => void) { this.emit = emit }
  push(chunk: string): void {
    const parts = (this.pending + chunk).split(/\r\n|[\r\n]/)
    this.pending = parts.pop()!.slice(-16_384)
    for (const line of parts) this.line(line)
  }
  end(): void { if (this.pending) this.line(this.pending); this.pending = '' }
  private line(value: string): void {
    const line = cleanText(value).trim().slice(0, 4096)
    if (line) this.emit(line)
  }
}

export function isWarning(line: string): boolean {
  // Test titles can mention warnings without emitting one.
  if (/^(?:[✓✔]|\(pass\)|ok\s+\d+\b|# Subtest:|PASS\b)/.test(line)) return false
  return (/\bwarn(?:ing|ings)?\b/i.test(line) || /(?:^|\s)\(!\)|⚠/.test(line)) && !/\b(?:no|0)\s+(?:\w+\s+)?warnings?\b/i.test(line)
}

// Turbo prefixes package output with `package:task:`; strip it before reading runner lines.
const turboPrefix = /^@?[\w./-]+:[\w:-]+:\s+/
/**
 * Reads the runners' own progress lines. Vitest reports each finished file with its test count
 * and a final `Tests ... (total)` line; Bun test prints `Ran N tests across M files.`.
 */
export function readProgress(task: TaskState, raw: string): void {
  const line = raw.replace(turboPrefix, '')
  const file = /^[✓❯×↓]\s+\S+\s+\((\d+) tests?\b/.exec(line)
  const total = /^Tests\s+.*\((\d+)\)$/.exec(line) ?? /^Ran (\d+) tests? across\b/.exec(line)
  if (total) {
    const count = Number(total[1])
    task.progress = { done: count, total: count, unit: 'tests' }
  } else if (file) {
    const done = (task.progress?.done ?? 0) + Number(file[1])
    const expected = task.expected?.total
    task.progress = { done, total: expected && expected >= done ? expected : undefined, unit: 'tests' }
  }
  const cache = /^Cached:\s+(\d+) cached, (\d+) total/.exec(line.trim())
  if (cache && cache[1] === cache[2]) task.cached = true
}

function terminate(child: ChildProcess, force: boolean): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    // taskkill includes descendants; SIGTERM alone would leave bun run grandchildren running.
    const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', ...(force ? ['/F'] : [])], { stdio: 'ignore' })
    killer.on('error', () => { child.kill(force ? 'SIGKILL' : 'SIGTERM') })
  } else {
    try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
  }
}

async function execute(task: TaskState, options: RunOptions, update: () => void): Promise<void> {
  const fd = openSync(task.log, 'wx', 0o600)
  let child: ChildProcess | undefined
  let escalation: ReturnType<typeof setTimeout> | undefined
  let storageError = ''
  const accept = (line: string): void => {
    task.lastOutput = performance.now()
    readProgress(task, line)
    task.tail.push(line)
    if (task.tail.length > 30) task.tail.shift()
    if (isWarning(line) && task.warnings.length < 5 && !task.warnings.includes(line)) task.warnings.push(line)
    if (/\b(?:\w*error|failed|failure|TS\d{4})\b/i.test(line) && task.diagnostics.length < 8) task.diagnostics.push(line)
    options.onLine?.(task, line)
    update()
  }
  const out = new OutputLines(accept), err = new OutputLines(accept)
  const stop = (): void => {
    if (!child || escalation) return
    terminate(child, false)
    escalation = setTimeout(() => { if (child) terminate(child, true) }, 1500)
  }
  try {
    writeSync(fd, `$ ${task.command}\n`)
    if (options.signal?.aborted) { task.status = 'cancelled'; return }
    child = spawn(task.executable, task.args, {
      cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    options.signal?.addEventListener('abort', stop, { once: true })
    const capture = (parser: OutputLines) => (chunk: string): void => {
      if (!storageError) {
        try { writeSync(fd, chunk) }
        catch (error) { storageError = `Cannot retain command output: ${(error as Error).message}`; stop() }
      }
      parser.push(chunk)
    }
    child.stdout!.setEncoding('utf8').on('data', capture(out))
    child.stderr!.setEncoding('utf8').on('data', capture(err))
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => {
      child!.once('error', error => { accept(`Unable to start ${task.command}: ${error.message}`) })
      child!.once('close', (code, signal) => resolve({ code, signal }))
    })
    out.end(); err.end()
    task.exitCode = result.code
    task.signal = result.signal
    if (storageError) accept(storageError)
    task.status = options.signal?.aborted ? 'cancelled' : result.code === 0 && !storageError ? 'passed' : 'failed'
  } finally {
    options.signal?.removeEventListener('abort', stop)
    // On cancellation, kill remaining descendants even if the direct child exited first.
    if (escalation) { clearTimeout(escalation); if (child) terminate(child, true) }
    closeSync(fd)
  }
}

const blocked = (task: TaskState, tasks: TaskState[]): boolean => task.needs
  ? task.needs.some(id => tasks.find(t => t.id === id)?.status !== 'passed')
  : tasks.slice(0, tasks.indexOf(task)).some(t => t.status !== 'passed')

/** Serial execution in declared order. A task runs only when everything it needs has passed. */
export async function runTasks(tasks: Task[], options: RunOptions): Promise<RunState> {
  const started = performance.now()
  const logDirectory = mkdtempSync(join(tmpdir(), 'silkweave-verify-'))
  const state: RunState = {
    started, elapsed: 0, finished: false, cancelled: false, logDirectory,
    tasks: tasks.map((task, i) => ({ ...task, status: 'pending', started: 0, elapsed: 0, lastOutput: 0,
      tail: [], warnings: [], diagnostics: [], log: join(logDirectory, `${String(i + 1).padStart(2, '0')}-${task.id}.log`), exitCode: null, signal: null, cached: false })),
  }
  const update = (): void => { state.elapsed = performance.now() - started; options.onUpdate?.(state) }
  try {
    update()
    for (const task of state.tasks) {
      if (options.signal?.aborted || state.tasks.some(t => t.status === 'cancelled') || blocked(task, state.tasks)) {
        task.status = 'skipped'
        continue
      }
      task.status = 'running'
      task.started = task.lastOutput = performance.now()
      update()
      try { await execute(task, options, update) }
      catch (error) { task.status = 'failed'; task.diagnostics.push((error as Error).message) }
      task.elapsed = performance.now() - task.started
      update()
    }
  } finally {
    state.cancelled = options.signal?.aborted ?? false
    state.finished = true
    update()
  }
  return state
}
