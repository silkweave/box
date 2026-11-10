// Matrix A5 (PHASE1.md W8 A, BOX-Review's tightening): a policy command whose PROCESS dies before
// and after its commit, on the run's engine. Another process (policy-crash-child.ts) boots the
// policy service on this test's cluster, stops at the point and is killed with SIGKILL; then a
// fresh process boots, and the role rows, logins, memberships, retirement and revision are
// compared, and admission is exercised from this (other) process.

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { Access } from '../../auth/access.js'
import { policyRevision } from '../../auth/policy-revision.js'
import { BUILTIN_ROLES, knownAreas, upsertRole } from '../../auth/roles.js'
import type { Principal } from '../../auth/principal.js'
import { ensureBoxConfig } from '../../box-config.js'
import type { DatabaseEngine } from '../../box-json.js'
import { clusterOf, clusterPaths, initCluster, openCluster, type RunningCluster } from '../../db/cluster.js'
import { dbRoot } from '../../db/index.js'
import { testEngine } from '../../db/testing.js'
import { fillRequest, runInRequest } from '../../request-context.js'
import { resetInstanceDir, setInstanceDir } from '../../testing.js'
import { withRead } from '../db.js'
import { closeExecutor } from '../executor.js'
import { boxSchemaOwners } from '../schema.js'
import { bootDatabase, clearPolicyService, refreshPolicy } from './boot.js'
import { BOX_DATABASE } from './policy.js'

const engine = inject('boxDb').engine as DatabaseEngine
const child = fileURLToPath(new URL('./policy-crash-child.ts', import.meta.url))
const preload = fileURLToPath(new URL('./policy-crash-preload.ts', import.meta.url))
const coreDir = fileURLToPath(new URL('../../../', import.meta.url))
let dir: string
let running: RunningCluster
let owner: pg.Client

interface PolicyState {
  roles: string[]
  logins: Array<{ role: string | null; login: string; retired: boolean }>
  members: Record<string, string[]>
  pgLogins: string[]
  revision: number
}

async function state(): Promise<PolicyState> {
  const q = async <T extends pg.QueryResultRow>(sql: string) => (await owner.query<T>(sql)).rows
  const logins = (await q<{ role: string | null; login: string; retired: boolean }>(`select role_id role, login, retired_at is not null retired from core.role_logins order by login`))
  const members: Record<string, string[]> = {}
  for (const r of await q<{ m: string; g: string }>(`select m.rolname m, g.rolname g from pg_auth_members am join pg_roles m on m.oid = am.member
      join pg_roles g on g.oid = am.roleid where m.rolname like 'box\\_role\\_%' order by 1, 2`)) (members[r.m] ??= []).push(r.g)
  return {
    roles: (await q<{ id: string }>(`select id from core.roles order by id`)).map((r) => r.id),
    logins,
    members,
    pgLogins: (await q<{ n: string }>(`select rolname n from pg_roles where rolname like 'box\\_role\\_%' order by 1`)).map((r) => r.n),
    revision: Number((await q<{ r: string }>(`select revision r from core.policy_state`))[0]!.r),
  }
}

/** Run the child in `mode`; crash modes are killed (SIGKILL) once they print READY. */
function runChild(mode: string): Promise<{ code: number | null; signal: NodeJS.Signals | null; out: string }> {
  const bun = process.versions.bun ? process.execPath : 'bun'
  const p = spawn(bun, ['--no-env-file', '--conditions=@silkweave/box-source', '--preload', preload, child, dir, running.socket, String(running.port), mode], { cwd: coreDir, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`child ${mode} timed out: ${out}`)) }, 60_000)
    const onData = (d: Buffer) => {
      out += d.toString()
      if (mode !== 'boot' && out.includes('READY')) p.kill('SIGKILL')
    }
    p.stdout.on('data', onData)
    p.stderr.on('data', (d: Buffer) => { out += d.toString() })
    p.on('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, out }) })
  })
}

const until = async (ok: () => Promise<boolean>, ms = 10_000) => {
  const end = Date.now() + ms
  while (!(await ok())) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 50)) }
}
/** No session of the killed child's policy transaction is left (the server rolled it back). */
const noOpenPolicyTx = () => until(async () => (await owner.query(`select 1 from pg_stat_activity where usename = 'box_policy' and state like 'idle in transaction%'`)).rowCount === 0)

/** A request on `role`'s login in this process, after it adopted the committed policy. */
async function asRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await refreshPolicy((await state()).revision)
  return runInRequest(() => {
    const access: Access = { role, areas: new Map([['support', 'write']]), fallback: 'none', admin: false, revision: policyRevision() }
    fillRequest({ principal: { id: 'crash-probe', display: 'crash-probe', role, kind: 'human' } as Principal, access })
    return fn()
  })
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-policy-crash-'))
  setInstanceDir(dir)
  ensureBoxConfig()
  const box = JSON.parse(readFileSync(join(dir, 'box.json'), 'utf8')) as Record<string, unknown>
  writeFileSync(join(dir, 'box.json'), JSON.stringify({ ...box, database: { engine } }, null, 2))
  const c = clusterOf(dbRoot(), `${engine}-1`)
  await initCluster(c, await testEngine(engine, clusterPaths(c).cache))
  running = await openCluster(c, await testEngine(engine, clusterPaths(c).cache), 'test')
  const { core, features } = boxSchemaOwners()
  await bootDatabase(running, { core, features, checkFiles: false, knownAreas: knownAreas(), builtinRoles: BUILTIN_ROLES.map((r) => ({ id: r.id, default: r.default, areas: r.areas })) })
  owner = new pg.Client({ host: running.socket, port: running.port, user: 'box_owner', database: BOX_DATABASE })
  await owner.connect()
}, 180_000)

afterAll(async () => {
  await owner?.end().catch(() => {})
  clearPolicyService()
  await closeExecutor()
  await running?.release()
  resetInstanceDir()
  rmSync(dir, { recursive: true, force: true })
})

describe('A5 a policy command whose process dies', { timeout: 120_000 }, () => {
  it('before its commit: nothing of it survives, a fresh boot changes nothing, the next command runs', async () => {
    const before = await state()
    const crashed = await runChild('before-commit')
    expect(crashed.signal, crashed.out).toBe('SIGKILL')
    await noOpenPolicyTx()
    expect(await state()).toEqual(before)
    const booted = await runChild('boot')
    expect(booted.code, booted.out).toBe(0)
    expect(await state()).toEqual(before)
    // The policy lock went with the dead session: this process commits the next change.
    await upsertRole({ id: 'crash-next', label: 'Next', default: 'none', areas: { support: 'read' } })
    expect((await state()).revision).toBeGreaterThan(before.revision)
  })

  it('after its commit (before publish): the role, its login and grants and the revision are there; a fresh boot keeps them; another process admits on them', async () => {
    const before = await state()
    const crashed = await runChild('create-after-commit')
    expect(crashed.signal, crashed.out).toBe('SIGKILL')
    const after = await state()
    expect(after.revision).toBeGreaterThan(before.revision)
    expect(after.roles).toEqual([...before.roles, 'crash-post'].sort())
    const login = after.logins.find((l) => l.role === 'crash-post' && !l.retired)!.login
    expect(after.members[login]).toEqual(['area_support_write'])
    const booted = await runChild('boot')
    expect(booted.code, booted.out).toBe(0)
    expect(await state()).toEqual(after)
    const seen = await asRole('crash-post', () => withRead<{ u: string; n: number }>(`select current_user u, (select count(*)::int from support.support_tickets) n`))
    expect(seen[0]).toEqual({ u: login, n: 0 })
  })

  it('after a retiring commit (before cleanup): the login holds nothing and cannot connect; a fresh boot drops it', async () => {
    await upsertRole({ id: 'crash-gone', label: 'Gone', default: 'none', areas: { support: 'write' } })
    const before = await state()
    const login = before.logins.find((l) => l.role === 'crash-gone' && !l.retired)!.login
    const crashed = await runChild('retire-after-commit')
    expect(crashed.signal, crashed.out).toBe('SIGKILL')
    const after = await state()
    expect(after.revision).toBeGreaterThan(before.revision)
    expect(after.roles).not.toContain('crash-gone')
    expect(after.logins.find((l) => l.login === login)).toEqual({ role: null, login, retired: true })
    expect(after.members[login]).toBeUndefined()
    const c = new pg.Client({ host: running.socket, port: running.port, user: login, database: BOX_DATABASE })
    c.on('error', () => {})
    await expect(c.connect()).rejects.toBeDefined()
    await c.end().catch(() => {})
    const booted = await runChild('boot')
    expect(booted.code, booted.out).toBe(0)
    const cleaned = await state()
    expect(cleaned.pgLogins).not.toContain(login)
    expect(cleaned.logins.find((l) => l.login === login)).toBeUndefined()
    expect(cleaned.revision).toBe(after.revision)
    expect(cleaned.roles).toEqual(after.roles)
  })
})
