import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { BuilderLifecycleError, type BuilderLifecyclePaths } from './builder-lifecycle.js'
import { reviewBuilder } from './builder-review.js'
import { runBuilderCommand } from './builder-ui-snapshot.js'

export interface BuilderVerification {
  fingerprint: string
  status: 'running' | 'passed' | 'failed'
  output: string
  checkedAt: string
  warnings: boolean
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
      current = { fingerprint, status: 'running', output: '', checkedAt: (dependencies.now ?? (() => new Date()))().toISOString(), warnings: false }
      save()
      const onOutput = (text: string): void => {
        if (!current) return
        current.output = (current.output + stripVTControlCharacters(text)).slice(-64_000)
        current.warnings ||= /\bwarn(?:ing)?\b/i.test(text)
        save()
      }
      try {
        if (review.files.some(f => f.path === 'bun.lock' || /(^|\/)package\.json$/.test(f.path))) {
          if (!existsSync(join(paths.repoRoot, 'bun.lock'))) throw new BuilderLifecycleError(409, 'Update and review the Bun lockfile before verification')
          onOutput('Installing reviewed dependencies from the frozen lockfile while the application is stopped.\n')
          await offline(() => runBuilderCommandImpl(paths.repoRoot, ['install', '--frozen-lockfile', '--ignore-scripts'], { onOutput }))
        }
        await runBuilderCommandImpl(paths.repoRoot, ['packages/cli/src/verify.ts', '--plain'], { onOutput })
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
