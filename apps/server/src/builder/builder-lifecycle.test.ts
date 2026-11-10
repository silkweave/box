import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
  readBuilderPendingChanges,
  stopBuilder,
  type BuilderDatabasePort,
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
    writeFileSync(join(instanceDir, 'store.db'), 'warehouse-v1\n')
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
    expect(result.backup.files.map((file) => file.path)).toEqual(['chat-uploads/aa/upload', 'config/box.json', 'store.db'])
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

  it('keeps the newest three backups per reason on disk and sweeps unlisted directories', async () => {
    const paths = fixture()
    let tick = 0
    const now = () => new Date(Date.UTC(2026, 9, 16, 12, 0, tick++))
    const starts: string[] = []
    for (let index = 0; index < 4; index++) {
      starts.push((await startBuilder({ paths, offline: true, now })).backup.id)
      await stopBuilder({ paths, offline: true })
    }
    const manual = (await backupBuilder('manual', { paths, offline: true, now })).id
    const root = builderBackupRoot(paths)
    expect(existsSync(join(root, starts[0]))).toBe(false)
    expect(readBuilderControl(paths).backups.map((backup) => backup.id)).toEqual([...starts.slice(1), manual])

    // A completed backup directory the control state lost (older unbounded history) is swept too.
    const orphan = 'orphan-start'
    mkdirSync(join(root, orphan))
    writeFileSync(join(root, orphan, 'manifest.json'), JSON.stringify({ id: orphan, createdAt: '2026-01-01T00:00:00.000Z', reason: 'start' }))
    mkdirSync(join(root, 'not-a-backup'))
    await backupBuilder('manual', { paths, offline: true, now })
    expect(existsSync(join(root, orphan))).toBe(false)
    expect(existsSync(join(root, 'not-a-backup'))).toBe(true)
    expect(existsSync(join(root, manual))).toBe(true)
  })

  it('adopts confirmed uncommitted changes onto the new live branch', async () => {
    const paths = fixture()
    const integration = git(paths.repoRoot, 'branch', '--show-current')
    const base = git(paths.repoRoot, 'rev-parse', 'HEAD')
    expect(readBuilderPendingChanges(paths)).toEqual({ fingerprint: null, files: [], truncated: false })

    writeFileSync(join(paths.repoRoot, 'README.md'), 'pending edit\n')
    writeFileSync(join(paths.repoRoot, 'draft.ts'), 'export {}\n')
    const pending = readBuilderPendingChanges(paths)
    expect(pending.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(pending.files).toEqual([{ path: 'README.md', status: 'M' }, { path: 'draft.ts', status: '??' }])
    await expect(startBuilder({ paths, offline: true })).rejects.toThrow(/confirm adopting them/)

    writeFileSync(join(paths.repoRoot, 'other.ts'), 'export {}\n')
    await expect(startBuilder({ paths, offline: true, adoptChanges: pending.fingerprint! })).rejects.toThrow(/changed since they were confirmed/)
    expect(git(paths.repoRoot, 'branch', '--show-current')).toBe(integration)

    const confirmed = readBuilderPendingChanges(paths)
    const result = await startBuilder({ paths, offline: true, adoptChanges: confirmed.fingerprint! })
    expect(git(paths.repoRoot, 'branch', '--show-current')).toBe(result.state.branch)
    expect(result.state.baseRevision).toBe(base)
    expect(result.state.integrationBranch).toBe(integration)
    expect(readFileSync(join(paths.repoRoot, 'README.md'), 'utf8')).toBe('pending edit\n')
    expect(readBuilderPendingChanges(paths).files.map(file => file.path)).toEqual(['README.md', 'draft.ts', 'other.ts'])
  })

  it('keeps one shared session across administrators', async () => {
    const paths = fixture()
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
    writeFileSync(join(paths.instanceDir, 'store.db'), 'warehouse-v2\n')
    writeFileSync(join(paths.instanceDir, 'config', 'box.json'), '{"name":"changed"}\n')
    writeFileSync(join(paths.repoRoot, 'box.local.json'), '{"local":false}\n')

    const restored = await restoreBuilder(initial.id, { paths, offline: true })
    expect(readFileSync(join(paths.instanceDir, 'store.db'), 'utf8')).toBe('warehouse-v1\n')
    expect(readFileSync(join(paths.instanceDir, 'config', 'box.json'), 'utf8')).toBe('{"name":"fixture"}\n')
    expect(readFileSync(join(paths.repoRoot, 'box.json'), 'utf8')).toBe('{"name":"fixture-root"}\n')
    expect(readFileSync(join(paths.repoRoot, 'box.local.json'), 'utf8')).toBe('{"local":true}\n')
    expect(restored.safetyBackup.reason).toBe('pre-restore')
    expect(readBuilderControl(paths).backups.map((backup) => backup.id)).toContain(restored.safetyBackup.id)
  })

  it('never copies or removes the database clusters and engines', async () => {
    const paths = fixture()
    for (const dir of ['db/pgrust-1/base', 'engines/pgrust']) mkdirSync(join(paths.instanceDir, dir), { recursive: true })
    writeFileSync(join(paths.instanceDir, 'db', 'pgrust-1', 'base', 'page'), 'cluster-v1\n')
    writeFileSync(join(paths.instanceDir, 'engines', 'pgrust', 'postgres'), 'binary\n')
    const initial = await backupBuilder('manual', { paths, offline: true })
    expect(initial.files.map((file) => file.path).filter((path) => /^(db|engines)\//.test(path))).toEqual([])

    writeFileSync(join(paths.instanceDir, 'db', 'pgrust-1', 'base', 'page'), 'cluster-v2\n')
    await restoreBuilder(initial.id, { paths, offline: true })
    expect(readFileSync(join(paths.instanceDir, 'db', 'pgrust-1', 'base', 'page'), 'utf8')).toBe('cluster-v2\n')
    expect(existsSync(join(paths.instanceDir, 'engines', 'pgrust', 'postgres'))).toBe(true)
  })

  // A database port that writes a restore point's three files and, on restore, applies the staged
  // swaps the way core's journal does (live -> parked, staged -> live).
  const fakeDatabase = (log: string[]): BuilderDatabasePort => ({
    async dump(dir) {
      log.push('dump')
      mkdirSync(dir, { recursive: true })
      for (const name of ['box.dump', 'agents.json', 'manifest.json']) writeFileSync(join(dir, name), `${name}\n`)
    },
    async restore({ point, engine, stageFiles }) {
      log.push(`restore ${engine} ${existsSync(join(point, 'box.dump'))}`)
      for (const w of stageFiles('t1')) {
        if (w.hadLive && existsSync(w.live)) renameSync(w.live, w.parked)
        if (existsSync(w.staged)) renameSync(w.staged, w.live)
        rmSync(w.parked, { recursive: true, force: true })
      }
    },
  })

  it('carries the database in a Builder backup and restores files, config and database together', async () => {
    const paths = fixture()
    const log: string[] = []
    const database = fakeDatabase(log)
    writeFileSync(join(paths.repoRoot, 'box.local.json'), '{"local":true,"database":{"engine":"native"}}\n')
    const initial = await backupBuilder('manual', { paths, offline: true, database })
    expect(initial.database?.files.map((file) => file.path)).toEqual(['box.dump', 'agents.json', 'manifest.json'])

    writeFileSync(join(paths.instanceDir, 'store.db'), 'warehouse-v2\n')
    writeFileSync(join(paths.instanceDir, 'stray.txt'), 'created after the backup\n')
    writeFileSync(join(paths.repoRoot, 'box.local.json'), '{"local":false}\n')
    const restored = await restoreBuilder(initial.id, { paths, offline: true, database })
    expect(log).toEqual(['dump', 'dump', 'restore native true'])
    expect(readFileSync(join(paths.instanceDir, 'store.db'), 'utf8')).toBe('warehouse-v1\n')
    expect(existsSync(join(paths.instanceDir, 'stray.txt'))).toBe(false)
    expect(readFileSync(join(paths.repoRoot, 'box.local.json'), 'utf8')).toContain('"engine":"native"')
    expect(restored.safetyBackup.database).toBeDefined()
    expect(readdirSync(paths.instanceDir).filter((name) => name.startsWith('.builder-'))).toEqual([])
  })

  it('keeps every staged and parked path while the database journal is unsettled', async () => {
    const paths = fixture()
    const database = fakeDatabase([])
    const initial = await backupBuilder('manual', { paths, offline: true, database })
    writeFileSync(join(paths.instanceDir, 'store.db'), 'warehouse-v2\n')
    // A restore whose rollback failed: half the swaps applied, the journal left for the next start.
    const failing: BuilderDatabasePort = {
      dump: database.dump,
      async restore({ stageFiles }) {
        const [first] = stageFiles('t2')
        if (first?.hadLive) renameSync(first.live, first.parked)
        mkdirSync(join(paths.instanceDir, 'db'), { recursive: true })
        writeFileSync(join(paths.instanceDir, 'db', 'switch.json'), '{"format":"box-db-operation/1"}\n')
        throw new Error('restore failed and rolling back also failed')
      },
    }
    await expect(restoreBuilder(initial.id, { paths, offline: true, database: failing })).rejects.toThrow(/rolling back also failed/)
    expect(readdirSync(paths.instanceDir).filter((name) => name.startsWith('.builder-')).sort()).toEqual(['.builder-parked-t2', '.builder-restore-t2'])
    expect(readdirSync(join(paths.instanceDir, '.builder-parked-t2')).length).toBe(1)
    // The next start settles the journal (rollback: parked back, staged root config removed); the
    // next restore then clears the instance staging roots that are left.
    const parked = readdirSync(join(paths.instanceDir, '.builder-parked-t2'))[0]!
    renameSync(join(paths.instanceDir, '.builder-parked-t2', parked), join(paths.instanceDir, parked))
    for (const name of readdirSync(paths.repoRoot)) if (name.startsWith('.builder-')) rmSync(join(paths.repoRoot, name), { force: true })
    rmSync(join(paths.instanceDir, 'db', 'switch.json'))
    await restoreBuilder(initial.id, { paths, offline: true, database })
    expect(readdirSync(paths.instanceDir).filter((name) => name.startsWith('.builder-'))).toEqual([])
  })

  it('refuses to restore a Builder backup without a database when the database is managed', async () => {
    const paths = fixture()
    const initial = await backupBuilder('manual', { paths, offline: true })
    await expect(restoreBuilder(initial.id, { paths, offline: true, database: fakeDatabase([]) })).rejects.toThrow(/carries no database/)
  })

  it('refuses a Builder backup while a SQLite store is still open', async () => {
    const paths = fixture()
    writeFileSync(join(paths.instanceDir, 'chat.db-wal'), 'uncheckpointed')
    await expect(backupBuilder('manual', { paths, offline: true })).rejects.toThrow(/SQLite stores still open/)
  })

  it('rejects a corrupted backup and a backup from another codebase revision', async () => {
    const paths = fixture()
    const initial = await backupBuilder('manual', { paths, offline: true })
    writeFileSync(join(paths.instanceDir, 'store.db'), 'tampered backup source\n')
    writeFileSync(join(builderBackupRoot(paths), initial.id, 'store.db'), 'tampered backup\n')
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
