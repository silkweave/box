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
      ['install', '--frozen-lockfile', '--ignore-scripts'],
      ['packages/cli/src/verify.ts', '--plain'],
    ])
    expect(verification.read()).toMatchObject({ status: 'passed', fingerprint: 'current' })
  })

  it('exposes lifecycle status errors through the existing assertion boundary', () => {
    const paths = fixture()
    const verification = createBuilderVerification(paths)
    expect(() => verification.assertPassed('missing')).toThrow(BuilderLifecycleError)
  })
})
