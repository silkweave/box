// Restore points and the restore / switch workflow against real clusters in a throwaway instance
// (PHASE1.md "W7 design"): a round trip with the agent files, refusals before anything changes,
// crash recovery forward and back, the system-agent check, and a cross-engine restore when both
// engines are installed.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { BUILTIN_ROLES, knownAreas } from '../auth/roles.js'
import { agentsDir } from '../agents.js'
import { agentIdentity, ensureBoxConfig } from '../box-config.js'
import type { DatabaseEngine } from '../box-json.js'
import { resetInstanceDir, setInstanceDir } from '../testing.js'
import { readUser, upsertUser } from '../users/state.js'
import { captureAgentFiles, writeAgentFiles } from '../warehouse/agent-snapshot.js'
import { backupWarehouse } from '../warehouse/backup.js'
import { closeExecutor } from '../warehouse/executor.js'
import { withRead } from '../warehouse/db.js'
import { bootDatabase, clearPolicyService } from '../warehouse/pg/boot.js'
import { boxSchemaOwners } from '../warehouse/schema.js'
import { clusterOf, clusterPaths, initCluster, openCluster, postmasterPid, readActive, writeActive, type RunningCluster } from './cluster.js'
import { dbRoot } from './index.js'
import { engineAvailable, testEngine } from './testing.js'
import { readJournal, recoverMaintenance, restoreDatabase, setRollbackCrashForTests } from './switch.js'

const engine = inject('boxDb').engine as DatabaseEngine
const resolveEngine = (e: DatabaseEngine, cache: string) => testEngine(e, cache)
let dir: string
let running: RunningCluster | null = null

async function boot(): Promise<void> {
  const root = dbRoot()
  let active = readActive(root)
  if (!active) {
    const c = clusterOf(root, `${engine}-1`)
    const install = await resolveEngine(engine, clusterPaths(c).cache)
    const id = await initCluster(c, install)
    active = { cluster: c.name, engine, build: id.build, version: id.version, pgvector: id.pgvector, activated: new Date().toISOString() }
    writeActive(root, active)
  }
  const c = clusterOf(root, active.cluster)
  running = await openCluster(c, await resolveEngine(active.engine, clusterPaths(c).cache), 'test')
  const { core, features } = boxSchemaOwners()
  await bootDatabase(running, {
    core, features, checkFiles: false, knownAreas: knownAreas(),
    builtinRoles: BUILTIN_ROLES.map((r) => ({ id: r.id, default: r.default, areas: r.areas })),
  })
}

async function shutdown(): Promise<void> {
  clearPolicyService()
  await closeExecutor()
  await running?.release()
  running = null
}

const agentFile = (id: string, name: string) => {
  mkdirSync(agentsDir(), { recursive: true })
  writeFileSync(join(agentsDir(), `${id}.md`), `---\nname: ${name}\nrole: member\n---\nHi.\n`)
}
const clusters = () => readdirSync(dbRoot()).filter((n) => /^[a-z]+-\d+$/.test(n)).sort()

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-switch-'))
  setInstanceDir(dir)
  ensureBoxConfig()
  const box = JSON.parse(readFileSync(join(dir, 'box.json'), 'utf8')) as Record<string, unknown>
  writeFileSync(join(dir, 'box.json'), JSON.stringify({ ...box, database: { engine } }, null, 2))
  await boot()
}, 120_000)

afterAll(async () => {
  await shutdown().catch(() => {})
  for (const name of existsSync(dbRoot()) ? clusters() : []) {
    const { stopServer } = await import('./cluster.js')
    await stopServer(clusterOf(dbRoot(), name)).catch(() => {})
  }
  rmSync(dir, { recursive: true, force: true })
  resetInstanceDir()
}, 120_000)

describe('backup and restore', () => {
  let point = ''

  it('takes an online restore point with the agent files and a manifest', async () => {
    agentFile('scribe', 'Scribe')
    // As boot reconciliation leaves a real Box: the system agent's row exists before any person.
    await upsertUser({ id: agentIdentity().id, first_name: agentIdentity().name }, { kind: 'agent' })
    await upsertUser({ id: 'alice', nickname: 'Alice' })
    const backup = await backupWarehouse({ remote: false })
    point = backup.local!.path
    expect(readdirSync(point).sort()).toEqual(['agents.json', 'box.dump', 'manifest.json'])
    const m = JSON.parse(readFileSync(join(point, 'manifest.json'), 'utf8'))
    expect(m.snapshot.tables['core.users'].rows).toBeGreaterThan(0)
    expect(m.agents.count).toBe(1)
    expect(m.source.engine).toBe(engine)
  }, 120_000)

  it('refuses a damaged dump before anything changes', async () => {
    await shutdown()
    const copy = join(dir, 'backups', 'db', 'manual-2026-01-01t00-00-00-000z-deadbeef')
    mkdirSync(copy, { recursive: true })
    for (const f of readdirSync(point)) writeFileSync(join(copy, f), readFileSync(join(point, f)))
    const dump = readFileSync(join(copy, 'box.dump'))
    dump[dump.length - 10] ^= 0xff
    writeFileSync(join(copy, 'box.dump'), dump)
    const before = { active: readActive(dbRoot()), clusters: clusters() }
    await expect(restoreDatabase(dbRoot(), { point: copy, resolveEngine })).rejects.toThrow(/does not match its manifest/)
    expect(readActive(dbRoot())).toEqual(before.active)
    expect(clusters()).toEqual(before.clusters)
    rmSync(copy, { recursive: true, force: true })
  }, 120_000)

  it('restores into a fresh cluster, puts the agent files back and retires the old cluster', async () => {
    await boot()
    await upsertUser({ id: 'marker', nickname: 'after the backup' })
    rmSync(join(agentsDir(), 'scribe.md'))
    agentFile('intruder', 'Intruder')
    await shutdown()
    const old = readActive(dbRoot())!
    const result = await restoreDatabase(dbRoot(), { point, resolveEngine })
    const active = readActive(dbRoot())!
    expect(active.cluster).not.toBe(old.cluster)
    expect(active.previous?.cluster).toBe(old.cluster)
    expect(readJournal(dbRoot())).toBeNull()
    expect(Object.keys(captureAgentFiles()).sort()).toEqual(['scribe.md'])
    expect(result.parked).toMatch(/^pre-restore-/)
    await boot()
    expect(await readUser('alice')).not.toBeNull()
    expect(await readUser('marker')).toBeNull()
    // Sequences continue above restored ids: a new row inserts.
    const [{ n }] = await withRead<{ n: number }>(`select count(*)::int n from core.users`, [], { reach: 'core' })
    expect(n).toBeGreaterThan(0)
  }, 240_000)

  it('rolls back a restore that died after swapping the agent files', async () => {
    agentFile('later', 'Later')
    await shutdown()
    const before = { active: readActive(dbRoot()), files: Object.keys(captureAgentFiles()).sort(), clusters: clusters() }
    await expect(restoreDatabase(dbRoot(), { point, resolveEngine, crashAfter: 'swap' })).rejects.toThrow(/injected crash/)
    expect(readJournal(dbRoot())?.step).toBe('commit')
    const r = await recoverMaintenance(dbRoot())
    expect(r.outcome).toBe('rolled-back')
    expect(readActive(dbRoot())).toEqual(before.active)
    expect(Object.keys(captureAgentFiles()).sort()).toEqual(before.files)
    expect(clusters()).toEqual(before.clusters)
  }, 240_000)

  it('repeats an interrupted rollback without losing the original agent files', async () => {
    agentFile('original', 'Original')
    await shutdown()
    const before = { active: readActive(dbRoot()), files: captureAgentFiles(), clusters: clusters() }
    // Swapped, then a rollback interrupted right after undoing the swap; recovered twice more.
    await expect(restoreDatabase(dbRoot(), { point, resolveEngine, crashAfter: 'swap' })).rejects.toThrow(/injected crash/)
    setRollbackCrashForTests(1)
    try { await expect(recoverMaintenance(dbRoot())).rejects.toThrow(/injected crash after undoing/) }
    finally { setRollbackCrashForTests(null) }
    expect(readJournal(dbRoot())?.step).toBe('rollback')
    expect(captureAgentFiles()).toEqual(before.files)
    expect((await recoverMaintenance(dbRoot())).outcome).toBe('rolled-back')
    expect((await recoverMaintenance(dbRoot())).outcome).toBe('none')
    expect(captureAgentFiles()).toEqual(before.files)
    expect(readActive(dbRoot())).toEqual(before.active)
    expect(clusters()).toEqual(before.clusters)
    // Never applied: staged, then a rollback interrupted after removing the staged copy.
    await expect(restoreDatabase(dbRoot(), { point, resolveEngine, crashAfter: 'stage' })).rejects.toThrow(/injected crash/)
    setRollbackCrashForTests(1)
    try { await expect(recoverMaintenance(dbRoot())).rejects.toThrow(/injected crash after undoing/) }
    finally { setRollbackCrashForTests(null) }
    expect((await recoverMaintenance(dbRoot())).outcome).toBe('rolled-back')
    expect(captureAgentFiles()).toEqual(before.files)
    expect(clusters()).toEqual(before.clusters)
    rmSync(join(agentsDir(), 'original.md'))
  }, 480_000)

  it('finishes forward a restore that died right after activation', async () => {
    const old = readActive(dbRoot())!
    await expect(restoreDatabase(dbRoot(), { point, resolveEngine, crashAfter: 'activate' })).rejects.toThrow(/injected crash/)
    const r = await recoverMaintenance(dbRoot())
    expect(r.outcome).toBe('forward')
    expect(readActive(dbRoot())!.previous?.cluster).toBe(old.cluster)
    expect(Object.keys(captureAgentFiles()).sort()).toEqual(['scribe.md'])
    expect(readJournal(dbRoot())).toBeNull()
  }, 240_000)

  it('finishes forward from cleanup without touching the restored live files (crash after parked removal)', async () => {
    for (const step of ['cleanup-partial', 'cleanup']) {
      agentFile('extra', 'Extra')
      const old = readActive(dbRoot())!
      await expect(restoreDatabase(dbRoot(), { point, resolveEngine, crashAfter: step })).rejects.toThrow(/injected crash/)
      expect(readJournal(dbRoot())?.step).toBe('cleanup')
      // Recovery twice: the second finds nothing to do; the restored files stay live either way.
      expect((await recoverMaintenance(dbRoot())).outcome).toBe('forward')
      expect((await recoverMaintenance(dbRoot())).outcome).toBe('none')
      expect(readActive(dbRoot())!.previous?.cluster).toBe(old.cluster)
      expect(Object.keys(captureAgentFiles()).sort()).toEqual(['scribe.md'])
      expect(readFileSync(join(agentsDir(), 'scribe.md'), 'utf8')).toContain('name: Scribe')
      expect(readdirSync(dirname(agentsDir())).filter((n) => n.startsWith('agents.'))).toEqual([])
    }
  }, 480_000)

  const copyPoint = (name: string, edit: (dir: string, manifest: Record<string, any>) => void) => {
    const copy = join(dir, 'seeds', name)
    mkdirSync(copy, { recursive: true })
    for (const f of readdirSync(point)) writeFileSync(join(copy, f), readFileSync(join(point, f)))
    const m = JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf8'))
    edit(copy, m)
    writeFileSync(join(copy, 'manifest.json'), JSON.stringify(m))
    return copy
  }

  it('refuses agent files that would not boot, before anything live changes', async () => {
    const cases: [string, Record<string, string>, RegExp][] = [
      ['unknown-role', { 'ghost.md': '---\nname: Ghost\nrole: no-such-role\n---\nHi.\n' }, /no role "no-such-role"/],
      ['no-front-matter', { 'broken.md': 'just text\n' }, /needs front matter/],
      ['names-a-person', { 'alice.md': '---\nname: Alice\nrole: member\n---\nHi.\n' }, /names an existing person/],
    ]
    for (const [name, files, why] of cases) {
      const copy = copyPoint(`bad-agents-${name}`, (d, m) => {
        m.agents.sha256 = writeAgentFiles(join(d, 'agents.json'), files)
        m.agents.count = Object.keys(files).length
      })
      const before = { active: readActive(dbRoot()), files: captureAgentFiles(), clusters: clusters() }
      await expect(restoreDatabase(dbRoot(), { point: copy, resolveEngine })).rejects.toThrow(why)
      expect(readActive(dbRoot())).toEqual(before.active)
      expect(captureAgentFiles()).toEqual(before.files)
      expect(clusters()).toEqual(before.clusters)
      expect(readJournal(dbRoot())).toBeNull()
    }
  }, 480_000)

  it('admits the restored configuration as startup reads it (box.local.json overrides included)', async () => {
    const live = join(dir, 'box.json')
    const system = agentIdentity()
    const stageWith = (local: string | null, root?: string) => (id: string) => {
      const rootStaged = join(dir, `.stage-${id}-box.json`)
      writeFileSync(rootStaged, root ?? readFileSync(live, 'utf8'))
      const localStaged = join(dir, `.stage-${id}-box.local.json`)
      if (local !== null) writeFileSync(localStaged, local)
      return [
        { live, staged: rootStaged, parked: join(dir, `.parked-${id}-box.json`), hadLive: true },
        { live: join(dir, 'box.local.json'), staged: localStaged, parked: join(dir, `.parked-${id}-box.local.json`), hadLive: existsSync(join(dir, 'box.local.json')) },
      ]
    }
    const cases: [string | null, string | undefined, RegExp][] = [
      [JSON.stringify({ agent: { id: system.id, name: system.name, role: 'no-such-role' } }), undefined, /no role "no-such-role"/],
      [JSON.stringify({ agent: { id: 'someone-else', name: 'Else', role: 'member' } }), undefined, /would not start: agent\.id changed/],
      [null, '{ not json', /would not start/],
    ]
    for (const [local, root, why] of cases) {
      const before = { config: readFileSync(live, 'utf8'), active: readActive(dbRoot()), clusters: clusters() }
      await expect(restoreDatabase(dbRoot(), { point, resolveEngine, stageFiles: stageWith(local, root) })).rejects.toThrow(why)
      expect(readFileSync(live, 'utf8')).toBe(before.config)
      expect(existsSync(join(dir, 'box.local.json'))).toBe(false)
      expect(readActive(dbRoot())).toEqual(before.active)
      expect(clusters()).toEqual(before.clusters)
      expect(readdirSync(dir).filter((n) => n.startsWith('.stage-') || n.startsWith('.parked-'))).toEqual([])
    }
  }, 480_000)

  it('refuses a restore point taken under another identity lock', async () => {
    const copy = copyPoint('other-lock', (_d, m) => { m.systemAgent.identityLock = '{"id":"someone-else"}\n' })
    const before = clusters()
    await expect(restoreDatabase(dbRoot(), { point: copy, resolveEngine })).rejects.toThrow(/identity lock/)
    expect(clusters()).toEqual(before)
  }, 120_000)

  /** Restore in a child Bun that SIGKILLs itself in the park step, with or without Bun's
   *  no-orphans mode. `box` runs everything under `--no-orphans`, which reaches child Bun processes
   *  as BUN_FEATURE_FLAG_NO_ORPHANS; on Linux it then kills every descendant with the process,
   *  the detached database server included. On macOS the server survives either way. */
  function killInPark(noOrphans: boolean) {
    const src = (f: string) => JSON.stringify(fileURLToPath(new URL(`../${f}`, import.meta.url)))
    const script = join(dir, 'kill-in-park.ts')
    writeFileSync(script, [
      `import { setInstanceDir } from ${src('testing.ts')}`,
      `import { restoreDatabase } from ${src('db/switch.ts')}`,
      `import { testEngine } from ${src('db/testing.ts')}`,
      `setInstanceDir(process.argv[2])`,
      `await restoreDatabase(process.argv[3], { point: process.argv[4], resolveEngine: testEngine, crashAfter: 'kill-in-park' })`,
    ].join('\n'))
    const { BUN_FEATURE_FLAG_NO_ORPHANS: _inherited, ...env } = process.env
    const r = spawnSync(process.execPath, [script, dir, dbRoot(), point], {
      encoding: 'utf8', timeout: 120_000, env: noOrphans ? { ...env, BUN_FEATURE_FLAG_NO_ORPHANS: '1' } : env,
    })
    expect(r.signal, r.stderr).toBe('SIGKILL')
    return clusterOf(dbRoot(), readActive(dbRoot())!.cluster)
  }

  async function recoversAfterKill() {
    expect(readJournal(dbRoot())?.step).toBe('park')
    expect((await recoverMaintenance(dbRoot())).outcome).toBe('rolled-back')
    // The next open (re)starts the server with the normal HBA; runtime logins work again.
    await boot()
    expect(existsSync(join(clusterOf(dbRoot(), readActive(dbRoot())!.cluster).dir, 'maintenance_hba.conf'))).toBe(false)
    expect(await readUser('alice')).not.toBeNull()
    await shutdown()
  }

  it('recovers from process death while the source runs under the maintenance HBA', async () => {
    const source = killInPark(false)
    expect(postmasterPid(source)).not.toBeNull()
    expect(existsSync(join(source.dir, 'maintenance_hba.conf'))).toBe(true)
    await recoversAfterKill()
  }, 240_000)

  it('recovers when the database server died with the process (no-orphans on Linux)', async () => {
    const source = killInPark(true)
    expect(existsSync(join(source.dir, 'maintenance_hba.conf'))).toBe(true)
    await recoversAfterKill()
  }, 240_000)

  it('refuses tampered agent files before anything changes', async () => {
    const copy = join(dir, 'seeds', 'tampered-agents')
    mkdirSync(copy, { recursive: true })
    for (const f of readdirSync(point)) writeFileSync(join(copy, f), readFileSync(join(point, f)))
    writeFileSync(join(copy, 'agents.json'), '{"format":"box-agent-files/1","files":{"../evil.md":"x"}}')
    const before = { files: captureAgentFiles(), clusters: clusters() }
    await expect(restoreDatabase(dbRoot(), { point: copy, resolveEngine })).rejects.toThrow(/agents\.json does not match/)
    expect(captureAgentFiles()).toEqual(before.files)
    expect(clusters()).toEqual(before.clusters)
  }, 120_000)

  it('refuses a restore point taken under another system principal', async () => {
    const copy = join(dir, 'seeds', 'other-system')
    mkdirSync(copy, { recursive: true })
    for (const f of readdirSync(point)) writeFileSync(join(copy, f), readFileSync(join(point, f)))
    const m = JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf8'))
    m.systemAgent.id = 'someone-else'
    writeFileSync(join(copy, 'manifest.json'), JSON.stringify(m))
    const before = clusters()
    await expect(restoreDatabase(dbRoot(), { point: copy, resolveEngine })).rejects.toThrow(/replaced since/)
    expect(clusters()).toEqual(before)
  }, 120_000)

  it.runIf(engineAvailable('native') && engineAvailable('pgrust'))('restores a dump into the other engine', async () => {
    const other: DatabaseEngine = engine === 'pgrust' ? 'native' : 'pgrust'
    const result = await restoreDatabase(dbRoot(), { point, resolveEngine, engine: other })
    expect(result.activated.engine).toBe(other)
    expect(readActive(dbRoot())!.engine).toBe(other)
    // Back to this run's engine for whatever runs after.
    await restoreDatabase(dbRoot(), { point, resolveEngine, engine })
    expect(readActive(dbRoot())!.engine).toBe(engine)
  }, 480_000)
})
