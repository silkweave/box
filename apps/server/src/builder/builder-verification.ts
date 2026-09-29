import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { BuilderLifecycleError, type BuilderLifecyclePaths } from './builder-lifecycle.js'
import { reviewBuilder } from './builder-review.js'
import { runBuilderCommand } from './builder-ui-snapshot.js'

/** One `box verify --json` check, as the Wrap Up task list renders it. */
export interface BuilderVerificationStep {
  id: string
  name: string
  phase: string
  command: string
  status: 'pending' | 'running' | 'passed' | 'failed' | 'cancelled' | 'skipped'
  elapsed: number
  /** Duration of the last passing run, for a time-based progress estimate. */
  expected?: number
  progress?: { done: number; total?: number; unit: string }
  cached: boolean
  warnings: string[]
  diagnostics: string[]
  exitCode: number | null
  log: string
}

export interface BuilderVerification {
  fingerprint: string
  status: 'running' | 'passed' | 'failed'
  /** Human-readable output: preparation lines, the verify receipt and supervisor errors. */
  output: string
  checkedAt: string
  warnings: boolean
  /** Structured progress; absent on records written before the task list existed. */
  steps?: BuilderVerificationStep[]
  elapsed?: number
}

// A queued row, so the task list is complete before the first check starts.
const queued = (step: Pick<BuilderVerificationStep, 'id' | 'name' | 'phase' | 'command' | 'expected'>): BuilderVerificationStep => ({
  id: step.id, name: step.name, phase: step.phase, command: step.command, expected: step.expected,
  status: 'pending', elapsed: 0, cached: false, warnings: [], diagnostics: [], exitCode: null, log: '',
})

// A progress snapshot line from `verify.ts --json`. Anything else is plain output.
function readSnapshot(line: string): { tasks: BuilderVerificationStep[]; elapsed: number } | undefined {
  if (!line.startsWith('{"verify":')) return undefined
  try {
    const value = JSON.parse(line) as { tasks?: unknown; elapsed?: unknown }
    return Array.isArray(value.tasks) ? { tasks: value.tasks as BuilderVerificationStep[], elapsed: Number(value.elapsed) || 0 } : undefined
  } catch { return undefined }
}

export interface BuilderVerificationDependencies {
  /** Injectable seams for the supervisor's source review and command runner. */
  review?: typeof reviewBuilder
  run?: typeof runBuilderCommand
  now?: () => Date
}

export function createBuilderVerification(paths: BuilderLifecyclePaths, dependencies: BuilderVerificationDependencies = {}) {
  const file = join(paths.instanceDir, 'builder', 'verification.json')
  let current: BuilderVerification | null = null
  let interrupted = false
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as BuilderVerification
    if (typeof value.fingerprint === 'string' && typeof value.output === 'string' && ['running', 'passed', 'failed'].includes(value.status)) {
      if (value.status === 'running') {
        current = { ...value, status: 'failed', output: value.output + '\nVerification interrupted by supervisor restart.' }
        interrupted = true
      } else current = value
    }
  } catch { /* First verification has no prior record. */ }
  const save = (): void => { writeFileSync(file, JSON.stringify(current, null, 2) + '\n', { mode: 0o600 }) }
  if (interrupted) save()
  return {
    read: (): BuilderVerification | null => current,
    assertPassed(fingerprint: string): void {
      if (current?.status !== 'passed' || current.fingerprint !== fingerprint) throw new BuilderLifecycleError(409, 'Verify the current reviewed changes before finishing')
    },
    async verify(fingerprint: string, offline: <T>(operation: () => Promise<T>) => Promise<T>): Promise<void> {
      const reviewBuilderImpl = dependencies.review ?? reviewBuilder
      const runBuilderCommandImpl = dependencies.run ?? runBuilderCommand
      const review = await reviewBuilderImpl(paths)
      if (review.fingerprint !== fingerprint) throw new BuilderLifecycleError(409, 'Source changed; refresh the review before verifying')
      const previous = current?.steps ?? []
      current = { fingerprint, status: 'running', output: '', checkedAt: (dependencies.now ?? (() => new Date()))().toISOString(), warnings: false, steps: previous.map(step => queued({ ...step, expected: step.status === 'passed' && !step.cached ? step.elapsed : step.expected })), elapsed: 0 }
      save()
      if (!previous.length) {
        // First run: ask verify for its checks; the list is cosmetic, so a failure leaves it empty.
        let listing = ''
        try {
          await runBuilderCommandImpl(paths.repoRoot, ['packages/cli/src/verify.ts', '--list'], { onOutput: text => { listing += text } })
          const steps = (JSON.parse(listing) as Parameters<typeof queued>[0][]).map(queued)
          if (current.status === 'running' && !current.steps?.some(step => step.status !== 'pending')) { current.steps = steps; save() }
        } catch { /* The first snapshot fills the list instead. */ }
      }
      let pending = ''
      const onOutput = (text: string): void => {
        if (!current) return
        const lines = (pending + stripVTControlCharacters(text)).split('\n')
        pending = lines.pop()!
        // A snapshot can arrive split across chunks; hold a partial one back until it completes.
        if (pending && !'{"verify":'.startsWith(pending.slice(0, 10))) { lines.push(pending); pending = '' }
        let plain = ''
        for (const line of lines) {
          const snapshot = readSnapshot(line)
          if (snapshot) {
            current.steps = snapshot.tasks
            current.elapsed = snapshot.elapsed
            current.warnings ||= snapshot.tasks.some(step => step.warnings.length > 0)
          } else plain += line + '\n'
        }
        if (plain) {
          current.output = (current.output + plain).slice(-64_000)
          current.warnings ||= /\bwarn(?:ing)?\b/i.test(plain) && !current.steps?.length
        }
        save()
      }
      try {
        if (review.files.some(f => f.path === 'bun.lock' || /(^|\/)package\.json$/.test(f.path))) {
          if (!existsSync(join(paths.repoRoot, 'bun.lock'))) throw new BuilderLifecycleError(409, 'Update and review the Bun lockfile before verification')
          onOutput('Installing reviewed dependencies from the frozen lockfile while the application is stopped.\n')
          await offline(() => runBuilderCommandImpl(paths.repoRoot, ['install', '--frozen-lockfile', '--ignore-scripts'], { onOutput }))
        }
        await runBuilderCommandImpl(paths.repoRoot, ['packages/cli/src/verify.ts', '--json'], { onOutput })
        if ((await reviewBuilderImpl(paths)).fingerprint !== fingerprint) throw new BuilderLifecycleError(409, 'Source changed during verification; review and verify again')
        current.status = 'passed'
      } catch (error) {
        current.status = 'failed'
        onOutput(`\n${error instanceof Error ? error.message : String(error)}\n`)
        throw error
      } finally { current.checkedAt = new Date().toISOString(); save() }
    },
  }
}
