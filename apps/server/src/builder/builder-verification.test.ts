import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuilderReview } from './builder-review.js'
import type { BuilderLifecyclePaths } from './builder-lifecycle.js'
import { BuilderLifecycleError } from './builder-lifecycle.js'
import { createBuilderVerification } from './builder-verification.js'

describe('Builder verification', () => {
  const roots: string[] = []
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

  const fixture = (): BuilderLifecyclePaths => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'builder-verification-repo-'))
    const instanceDir = mkdtempSync(join(tmpdir(), 'builder-verification-instance-'))
    roots.push(repoRoot, instanceDir)
    mkdirSync(join(instanceDir, 'builder'), { recursive: true })
    return { repoRoot, instanceDir }
  }

  const review = (fingerprint: string, files: BuilderReview['files'] = []): BuilderReview => ({
    version: 1,
    fingerprint,
    branch: 'builder/live/test',
    targetBranch: 'main',
    baseRevision: 'a'.repeat(40),
    headRevision: 'b'.repeat(40),
    files,
    commits: [],
    diff: '',
    truncated: false,
  })

  const offline = async <T>(operation: () => Promise<T>): Promise<T> => operation()

  it('rejects a stale fingerprint before recording or running verification', async () => {
    const paths = fixture()
    let commands = 0
    const verification = createBuilderVerification(paths, {
      review: async () => review('fresh'),
      run: async () => { commands += 1 },
    })

    await expect(verification.verify('stale', offline)).rejects.toMatchObject({ statusCode: 409, message: 'Source changed; refresh the review before verifying' })
    expect(commands).toBe(0)
    expect(verification.read()).toBeNull()
  })

  it('fails and persists when source changes after the verification command starts', async () => {
    const paths = fixture()
    let reviews = 0
    const verification = createBuilderVerification(paths, {
      review: async () => review(reviews++ === 0 ? 'current' : 'changed'),
      run: async (_root, _args, options) => options?.onOutput?.('verify output\n'),
    })

    await expect(verification.verify('current', offline)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Source changed during verification; review and verify again',
    })
    expect(verification.read()).toMatchObject({ status: 'failed', fingerprint: 'current' })
    expect(verification.read()?.output).toContain('verify output')
  })

  it('keeps verify progress snapshots as steps, even split across chunks, and the rest as output', async () => {
    const paths = fixture()
    const step = { id: 'core-tests', name: 'Core tests', phase: 'Validate', command: 'bun run test:core', status: 'running', elapsed: 900, progress: { done: 172, total: 244, unit: 'tests' }, cached: false, warnings: ['WARN slow'], diagnostics: [], exitCode: null, log: '/tmp/x.log' }
    const line = JSON.stringify({ verify: 1, elapsed: 1200, finished: false, cancelled: false, logDirectory: '/tmp', tasks: [step] })
    const verification = createBuilderVerification(paths, {
      review: async () => review('current'),
      run: async (_root, _args, options) => {
        options?.onOutput?.(line.slice(0, 40))
        options?.onOutput?.(line.slice(40) + '\n  All checks passed\n')
      },
    })

    await verification.verify('current', offline)
    expect(verification.read()).toMatchObject({ status: 'passed', elapsed: 1200, warnings: true, steps: [{ id: 'core-tests', progress: { done: 172, total: 244 } }] })
    expect(verification.read()?.output).toBe('  All checks passed\n')
  })

  it('shows every check queued before the first snapshot: listed on a first run, reset from the last run after', async () => {
    const paths = fixture()
    const listed = [{ id: 'build', name: 'Build workspace', phase: 'Build', command: 'bun run build', expected: 2000 }]
    const seen: unknown[] = []
    const verification = createBuilderVerification(paths, {
      review: async () => review('current'),
      run: async (_root, args, options) => {
        if (args.includes('--list')) { options?.onOutput?.(JSON.stringify(listed) + '\n'); return }
        seen.push(structuredClone(verification.read()?.steps))
        options?.onOutput?.(JSON.stringify({ verify: 1, elapsed: 5, tasks: [{ ...listed[0], status: 'passed', elapsed: 2500, cached: false, warnings: [], diagnostics: [], exitCode: 0, log: '/tmp/b.log' }] }) + '\n')
      },
    })
    await verification.verify('current', offline)
    await verification.verify('current', offline)
    expect(seen[0]).toMatchObject([{ id: 'build', status: 'pending', expected: 2000 }])
    expect(seen[1]).toMatchObject([{ id: 'build', status: 'pending', elapsed: 0, expected: 2500 }])
  })

  it('records command failures as failed verification with command output', async () => {
    const paths = fixture()
    const verification = createBuilderVerification(paths, {
      review: async () => review('current'),
      run: async (_root, _args, options) => {
        options?.onOutput?.('\u001b[31mverify failed\u001b[0m\n')
        throw new Error('verify command failed')
      },
    })

    await expect(verification.verify('current', offline)).rejects.toThrow('verify command failed')
    expect(verification.read()).toMatchObject({ status: 'failed' })
    expect(verification.read()?.output).toContain('verify failed')
    expect(verification.read()?.output).not.toContain('\u001b')
  })

  it('turns an interrupted persisted run into a failed record on startup', () => {
    const paths = fixture()
    const file = join(paths.instanceDir, 'builder', 'verification.json')
    writeFileSync(file, JSON.stringify({
      fingerprint: 'interrupted',
      status: 'running',
      output: 'last output',
      checkedAt: '2026-09-20T00:00:00.000Z',
      warnings: false,
    }))

    const verification = createBuilderVerification(paths)
    expect(verification.read()).toMatchObject({ status: 'failed' })
    expect(verification.read()?.output).toContain('Verification interrupted by supervisor restart.')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ status: 'failed' })
  })

  it('runs a frozen lockfile install through the stopped-app boundary for dependency changes', async () => {
    const paths = fixture()
    writeFileSync(join(paths.repoRoot, 'bun.lock'), 'lockfile\n')
    const calls: string[][] = []
    let stoppedCalls = 0
    const verification = createBuilderVerification(paths, {
      review: async () => review('current', [{ path: 'package.json', status: ' M' }]),
      run: async (_root, args, options) => {
        calls.push(args)
        options?.onOutput?.(`${args.join(' ')}\n`)
      },
    })

    await verification.verify('current', async operation => {
      stoppedCalls += 1
      return operation()
    })
    expect(stoppedCalls).toBe(1)
    expect(calls).toEqual([
      ['packages/cli/src/verify.ts', '--list'],
      ['install', '--frozen-lockfile', '--ignore-scripts'],
      ['packages/cli/src/verify.ts', '--json'],
    ])
    expect(verification.read()).toMatchObject({ status: 'passed', fingerprint: 'current' })
  })

  it('exposes lifecycle status errors through the existing assertion boundary', () => {
    const paths = fixture()
    const verification = createBuilderVerification(paths)
    expect(() => verification.assertPassed('missing')).toThrow(BuilderLifecycleError)
  })
})
