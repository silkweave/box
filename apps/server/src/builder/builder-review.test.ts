import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkpointBuilder, finalizeCheckout, finishBuilder, reviewBuilder } from './builder-review.js'
import { startBuilder, type BuilderLifecyclePaths } from './builder-lifecycle.js'

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()

describe('live Builder Git review', () => {
  const roots: string[] = []
  afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

  const fixture = async (): Promise<{ paths: BuilderLifecyclePaths; target: string }> => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'builder-review-repo-'))
    const instanceDir = mkdtempSync(join(tmpdir(), 'builder-review-instance-'))
    roots.push(repoRoot, instanceDir)
    git(repoRoot, 'init', '-q')
    git(repoRoot, 'config', 'user.email', 'builder@test.invalid')
    git(repoRoot, 'config', 'user.name', 'Builder Test')
    const target = git(repoRoot, 'branch', '--show-current')
    writeFileSync(join(repoRoot, 'README.md'), 'source\n')
    writeFileSync(join(repoRoot, '.gitignore'), 'ignored.txt\n')
    git(repoRoot, 'add', 'README.md', '.gitignore')
    git(repoRoot, 'commit', '-qm', 'initial')
    mkdirSync(join(instanceDir, 'builder'), { recursive: true })
    return { paths: { repoRoot, instanceDir }, target }
  }

  const start = async (paths: BuilderLifecyclePaths) => startBuilder({ paths, offline: true })

  it('reviews committed checkpoints and untracked files while excluding ignored files', async () => {
    const { paths } = await fixture()
    await start(paths)
    const initial = await reviewBuilder(paths)
    expect(initial.files).toEqual([])
    writeFileSync(join(paths.repoRoot, 'README.md'), 'edited\n')
    writeFileSync(join(paths.repoRoot, 'new.ts'), 'export const value = 1\n')
    writeFileSync(join(paths.repoRoot, 'ignored.txt'), 'secret\n')
    const dirty = await reviewBuilder(paths)
    expect(dirty.files.map(file => file.path)).toEqual(['README.md', 'new.ts'])
    expect(dirty.files.find(file => file.path === 'new.ts')?.status).toBe('??')
    expect(dirty.diff).toContain('+edited')
    expect(dirty.diff).toContain('+++ b/new.ts')
    const checkpoint = await checkpointBuilder(paths, { fingerprint: dirty.fingerprint, message: 'Save Builder work' })
    expect(checkpoint.commitSHA).toMatch(/^[0-9a-f]{40}$/)
    expect(checkpoint.review.commits.map(commit => commit.message)).toContain('Save Builder work')
    expect(checkpoint.review.fingerprint).not.toBe(dirty.fingerprint)
  })

  it('rejects stale reviews after a concurrent edit and leaves that edit intact', async () => {
    const { paths } = await fixture()
    await start(paths)
    writeFileSync(join(paths.repoRoot, 'README.md'), 'first\n')
    const review = await reviewBuilder(paths)
    writeFileSync(join(paths.repoRoot, 'README.md'), 'concurrent\n')
    await expect(checkpointBuilder(paths, { fingerprint: review.fingerprint, message: 'stale' })).rejects.toThrow(/stale/)
    expect(git(paths.repoRoot, 'status', '--porcelain')).toContain('README.md')
  })

  it('serializes concurrent review reads with a checkpoint without index-lock races', async () => {
    const { paths } = await fixture()
    await start(paths)
    writeFileSync(join(paths.repoRoot, 'README.md'), 'parallel review\n')
    const review = await reviewBuilder(paths)
    const [checkpoint, readOne, readTwo] = await Promise.all([
      checkpointBuilder(paths, { fingerprint: review.fingerprint, message: 'Parallel checkpoint' }),
      reviewBuilder(paths),
      reviewBuilder(paths),
    ])
    expect(checkpoint.commitSHA).toMatch(/^[0-9a-f]{40}$/)
    expect(readOne.branch).toMatch(/^builder\/live\//)
    expect(readTwo.branch).toBe(readOne.branch)
  })

  it('rejects a review from a different checked out branch', async () => {
    const { paths, target } = await fixture()
    const started = await start(paths)
    git(paths.repoRoot, 'switch', target)
    await expect(reviewBuilder(paths)).rejects.toThrow(/requires .* to be checked out/)
    git(paths.repoRoot, 'switch', started.state.branch!)
  })

  it('captures the real default branch tip when Builder starts detached', async () => {
    const { paths, target } = await fixture()
    git(paths.repoRoot, 'switch', '--detach', 'HEAD')
    const started = await start(paths)
    expect(started.state.integrationBranch).toBe(target)
    expect(started.state.integrationRevision).toBe(git(paths.repoRoot, 'rev-parse', target))
  })

  it('fast forwards the captured target branch without switching away from the live branch', async () => {
    const { paths, target } = await fixture()
    const started = await start(paths)
    writeFileSync(join(paths.repoRoot, 'README.md'), 'integrated\n')
    const checkpoint = await checkpointBuilder(paths, { fingerprint: (await reviewBuilder(paths)).fingerprint, message: 'Integrate Builder work' })
    const finished = await finishBuilder(paths, { fingerprint: checkpoint.review.fingerprint, message: 'unused when clean' })
    expect(finished.targetBranch).toBe(target)
    expect(finished.checkedOutBranch).toBe(started.state.branch)
    expect(git(paths.repoRoot, 'rev-parse', target)).toBe(checkpoint.commitSHA)
    expect(git(paths.repoRoot, 'branch', '--show-current')).toBe(started.state.branch)
    const finalized = await finalizeCheckout(paths, { expectedBranch: started.state.branch!, expectedSHA: checkpoint.commitSHA, targetBranch: target })
    expect(finalized).toEqual({ branch: target, revision: checkpoint.commitSHA })
  })

  it('allows a retry after the target has already advanced to the reviewed SHA', async () => {
    const { paths, target } = await fixture()
    const started = await start(paths)
    writeFileSync(join(paths.repoRoot, 'README.md'), 'integrated\n')
    const checkpoint = await checkpointBuilder(paths, { fingerprint: (await reviewBuilder(paths)).fingerprint, message: 'Retryable integration' })
    const first = await finishBuilder(paths, { fingerprint: checkpoint.review.fingerprint, message: 'unused' })
    const retry = await finishBuilder(paths, { fingerprint: first.review.fingerprint, message: 'unused' })
    expect(retry.integratedSHA).toBe(first.integratedSHA)
    expect(git(paths.repoRoot, 'rev-parse', target)).toBe(first.integratedSHA)
    expect(git(paths.repoRoot, 'branch', '--show-current')).toBe(started.state.branch)
  })

  it('allows a repaired live branch to finish after an earlier target advance', async () => {
    const { paths, target } = await fixture()
    const started = await start(paths)
    writeFileSync(join(paths.repoRoot, 'README.md'), 'first integration\n')
    const checkpoint = await checkpointBuilder(paths, { fingerprint: (await reviewBuilder(paths)).fingerprint, message: 'First integration' })
    const first = await finishBuilder(paths, { fingerprint: checkpoint.review.fingerprint, message: 'unused' })
    writeFileSync(join(paths.repoRoot, 'README.md'), 'health repair\n')
    const repair = await checkpointBuilder(paths, { fingerprint: (await reviewBuilder(paths)).fingerprint, message: 'Health repair' })
    const retry = await finishBuilder(paths, { fingerprint: repair.review.fingerprint, message: 'unused' })
    expect(first.integratedSHA).not.toBe(retry.integratedSHA)
    expect(git(paths.repoRoot, 'rev-parse', target)).toBe(repair.commitSHA)
    expect(git(paths.repoRoot, 'branch', '--show-current')).toBe(started.state.branch)
  })

  it('honors commit hooks and reports source changes made by a hook', async () => {
    const { paths } = await fixture()
    await start(paths)
    writeFileSync(join(paths.repoRoot, 'README.md'), 'before hook\n')
    writeFileSync(join(paths.repoRoot, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nprintf "hook edit\\n" >> README.md\n')
    chmodSync(join(paths.repoRoot, '.git', 'hooks', 'pre-commit'), 0o755)
    const review = await reviewBuilder(paths)
    await expect(checkpointBuilder(paths, { fingerprint: review.fingerprint, message: 'Hooked checkpoint' })).rejects.toThrow(/commit hook changed/)
    expect((await reviewBuilder(paths)).files.map(file => file.path)).toContain('README.md')
  })

  it('rejects a diverged target branch and does not move it', async () => {
    const { paths, target } = await fixture()
    const started = await start(paths)
    writeFileSync(join(paths.repoRoot, 'README.md'), 'Builder change\n')
    const checkpoint = await checkpointBuilder(paths, { fingerprint: (await reviewBuilder(paths)).fingerprint, message: 'Builder change' })
    git(paths.repoRoot, 'switch', target)
    writeFileSync(join(paths.repoRoot, 'README.md'), 'target change\n')
    git(paths.repoRoot, 'add', 'README.md')
    git(paths.repoRoot, 'commit', '-qm', 'target moved')
    const targetRevision = git(paths.repoRoot, 'rev-parse', target)
    git(paths.repoRoot, 'switch', started.state.branch!)
    await expect(finishBuilder(paths, { fingerprint: checkpoint.review.fingerprint, message: 'unused' })).rejects.toThrow(/diverged|moved/)
    expect(git(paths.repoRoot, 'rev-parse', target)).toBe(targetRevision)
    expect(git(paths.repoRoot, 'branch', '--show-current')).toBe(started.state.branch)
  })

  it('rejects integration when the target branch is checked out in another worktree', async () => {
    const { paths, target } = await fixture()
    const started = await start(paths)
    writeFileSync(join(paths.repoRoot, 'README.md'), 'Builder change\n')
    const checkpoint = await checkpointBuilder(paths, { fingerprint: (await reviewBuilder(paths)).fingerprint, message: 'Builder change' })
    const other = mkdtempSync(join(tmpdir(), 'builder-review-worktree-'))
    roots.push(other)
    rmSync(other, { recursive: true, force: true })
    git(paths.repoRoot, 'worktree', 'add', '-q', other, target)
    await expect(finishBuilder(paths, { fingerprint: checkpoint.review.fingerprint, message: 'unused' })).rejects.toThrow(/another worktree/)
    expect(git(paths.repoRoot, 'rev-parse', target)).toBe(checkpoint.review.baseRevision)
    expect(git(paths.repoRoot, 'branch', '--show-current')).toBe(started.state.branch)
    git(paths.repoRoot, 'worktree', 'remove', '--force', other)
  })
})
