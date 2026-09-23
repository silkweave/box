import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  backupBuilder,
  builderBackupRoot,
  builderControlPath,
  readBuilderControl,
  recordBuilderSession,
  restoreBuilder,
  startBuilder,
  stopBuilder,
  type BuilderLifecyclePaths,
} from './builder-lifecycle.js'

const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()

describe('live Builder lifecycle', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  const fixture = (): BuilderLifecyclePaths => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'builder-live-repo-'))
    const instanceDir = mkdtempSync(join(tmpdir(), 'builder-live-instance-'))
    roots.push(repoRoot, instanceDir)
    git(repoRoot, 'init', '-q')
    git(repoRoot, 'config', 'user.email', 'builder@test.invalid')
    git(repoRoot, 'config', 'user.name', 'Builder Test')
    writeFileSync(join(repoRoot, 'README.md'), 'source\n')
    writeFileSync(join(repoRoot, 'box.json'), '{"name":"fixture-root"}\n')
    writeFileSync(join(repoRoot, '.gitignore'), 'box.local.json\n')
    git(repoRoot, 'add', 'README.md', 'box.json', '.gitignore')
    git(repoRoot, 'commit', '-qm', 'initial')
    writeFileSync(join(repoRoot, 'box.local.json'), '{"local":true}\n')
    mkdirSync(join(instanceDir, 'config'), { recursive: true })
    mkdirSync(join(instanceDir, 'chat-uploads', 'aa'), { recursive: true })
    writeFileSync(join(instanceDir, 'data.db'), 'warehouse-v1\n')
    writeFileSync(join(instanceDir, 'config', 'box.json'), '{"name":"fixture"}\n')
    writeFileSync(join(instanceDir, 'chat-uploads', 'aa', 'upload'), 'attachment-v1\n')
    return { repoRoot, instanceDir }
  }

  const offline = (calls: { count: number }) => async <T>(operation: () => Promise<T> | T): Promise<T> => {
    calls.count += 1
    return await operation()
  }

  it('backs up the full instance, then creates one dedicated branch in the live checkout', async () => {
    const paths = fixture()
    const calls = { count: 0 }
    const result = await startBuilder({ paths, withAppStopped: offline(calls) })

    expect(calls.count).toBe(1)
    expect(result.createdBranch).toBe(true)
    expect(result.state.session).toBeNull()
    expect(result.state.branch).toMatch(/^builder\/live\//)
    expect(git(paths.repoRoot, 'branch', '--show-current')).toBe(result.state.branch)
    expect(result.backup.files.map((file) => file.path)).toEqual(['chat-uploads/aa/upload', 'config/box.json', 'data.db'])
    expect(result.backup.config?.files.map((file) => file.path)).toEqual(['box.json', 'box.local.json'])
    expect(existsSync(builderControlPath(paths))).toBe(true)
    expect(existsSync(join(builderBackupRoot(paths), result.backup.id, 'manifest.json'))).toBe(true)
  })

  it('keeps a completed backup discoverable when restarting the application fails', async () => {
    const paths = fixture()
    await expect(backupBuilder({ paths, withAppStopped: async operation => {
      await operation()
      throw new Error('application failed to restart')
    } })).rejects.toThrow('application failed to restart')
    const state = readBuilderControl(paths)
    expect(state.backups).toHaveLength(1)
    expect(existsSync(join(builderBackupRoot(paths), state.backups[0].id, 'manifest.json'))).toBe(true)
  })

  it('requires a clean checkout and keeps one shared session across administrators', async () => {
    const paths = fixture()
    writeFileSync(join(paths.repoRoot, 'README.md'), 'pending edit\n')
    await expect(startBuilder({ paths, offline: true })).rejects.toThrow(/clean live checkout/)

    writeFileSync(join(paths.repoRoot, 'README.md'), 'source\n')
    const first = await startBuilder({ paths, offline: true })
    await recordBuilderSession({ id: 'session-1', startedAt: new Date().toISOString(), status: 'running' }, { paths, offline: true })
    await expect(startBuilder({ paths, offline: true })).rejects.toThrow(/active shared session/)
    expect(first.state.branch).toBe(readBuilderControl(paths).branch)
  })

  it('records a session, stops it without switching away from the live branch, and can resume it', async () => {
    const paths = fixture()
    const first = await startBuilder({ paths, offline: true })
    await recordBuilderSession({ id: 'session-1', startedAt: new Date().toISOString() }, { paths, offline: true })
    const stopped = await stopBuilder({ paths, offline: true })
    expect(stopped.session).toBeNull()
    expect(stopped.branch).toBeNull()
    expect(stopped.baseRevision).toBeNull()
    expect(git(paths.repoRoot, 'branch', '--show-current')).toBe(first.state.branch)

    const resumed = await startBuilder({ paths, offline: true })
    expect(resumed.createdBranch).toBe(true)
    expect(resumed.state.branch).not.toBe(first.state.branch)
  })

  it('drops a legacy driver while keeping an active session readable', async () => {
    const paths = fixture()
    await startBuilder({ paths, offline: true })
    await recordBuilderSession({ id: 'session-1', startedAt: new Date().toISOString(), status: 'idle' }, { paths, offline: true })
    const current = readBuilderControl(paths)
    const legacy = { ...current, driver: { id: 'alice', display: 'Alice' } }
    writeFileSync(builderControlPath(paths), `${JSON.stringify(legacy)}\n`)
    expect(readBuilderControl(paths).session?.id).toBe('session-1')
    expect(readBuilderControl(paths)).not.toHaveProperty('driver')
  })

  it('restores a verified instance snapshot and records a pre-restore safety backup', async () => {
    const paths = fixture()
    const initial = await backupBuilder('manual', { paths, offline: true })
    writeFileSync(join(paths.instanceDir, 'data.db'), 'warehouse-v2\n')
    writeFileSync(join(paths.instanceDir, 'config', 'box.json'), '{"name":"changed"}\n')
    writeFileSync(join(paths.repoRoot, 'box.local.json'), '{"local":false}\n')

    const restored = await restoreBuilder(initial.id, { paths, offline: true })
    expect(readFileSync(join(paths.instanceDir, 'data.db'), 'utf8')).toBe('warehouse-v1\n')
    expect(readFileSync(join(paths.instanceDir, 'config', 'box.json'), 'utf8')).toBe('{"name":"fixture"}\n')
    expect(readFileSync(join(paths.repoRoot, 'box.json'), 'utf8')).toBe('{"name":"fixture-root"}\n')
    expect(readFileSync(join(paths.repoRoot, 'box.local.json'), 'utf8')).toBe('{"local":true}\n')
    expect(restored.safetyBackup.reason).toBe('pre-restore')
    expect(readBuilderControl(paths).backups.map((backup) => backup.id)).toContain(restored.safetyBackup.id)
  })

  it('rejects a corrupted backup and a backup from another codebase revision', async () => {
    const paths = fixture()
    const initial = await backupBuilder('manual', { paths, offline: true })
    writeFileSync(join(paths.instanceDir, 'data.db'), 'tampered backup source\n')
    writeFileSync(join(builderBackupRoot(paths), initial.id, 'data.db'), 'tampered backup\n')
    await expect(restoreBuilder(initial.id, { paths, offline: true })).rejects.toThrow(/failed validation/)

    const fresh = fixture()
    const backup = await backupBuilder('manual', { paths: fresh, offline: true })
    writeFileSync(join(fresh.repoRoot, 'README.md'), 'source v2\n')
    git(fresh.repoRoot, 'add', 'README.md')
    git(fresh.repoRoot, 'commit', '-qm', 'source change')
    await expect(restoreBuilder(backup.id, { paths: fresh, offline: true })).rejects.toThrow(/does not match the live checkout/)
  })

  it('requires an app-stop callback or explicit offline fixture contract', async () => {
    const paths = fixture()
    await expect(backupBuilder({ paths })).rejects.toThrow(/requires withAppStopped/)
  })

  it('refuses restore when the live checkout became dirty after backup', async () => {
    const paths = fixture()
    const backup = await backupBuilder('manual', { paths, offline: true })
    writeFileSync(join(paths.repoRoot, 'README.md'), 'uncommitted\n')
    await expect(restoreBuilder(backup.id, { paths, offline: true })).rejects.toThrow(/clean live checkout/)
  })

  it('rejects symlinked backup ancestors before restoring files', async () => {
    const paths = fixture()
    const backup = await backupBuilder('manual', { paths, offline: true })
    const backupConfig = join(builderBackupRoot(paths), backup.id, 'root-config')
    const outside = mkdtempSync(join(tmpdir(), 'builder-live-outside-'))
    roots.push(outside)
    rmSync(backupConfig, { recursive: true, force: true })
    symlinkSync(outside, backupConfig)
    await expect(restoreBuilder(backup.id, { paths, offline: true })).rejects.toThrow(/symbolic-link path/)
  })

  it('rolls back the live branch when control state cannot be persisted', async () => {
    const paths = fixture()
    writeFileSync(join(paths.instanceDir, 'builder'), 'control path is blocked')
    const originalBranch = git(paths.repoRoot, 'branch', '--show-current')

    await expect(startBuilder({ paths, offline: true })).rejects.toThrow()
    expect(git(paths.repoRoot, 'branch', '--show-current')).toBe(originalBranch)
    expect(git(paths.repoRoot, 'branch', '--list', 'builder/live/*')).toBe('')
  })
})
