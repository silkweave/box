// The policy service on a booted database (PERMISSIONS 11.3, 9.2; PHASE1.md W8 P and BOX-Review
// findings 2 and 9): a role change, its login memberships and the revision commit together or not
// at all; only box_policy writes policy rows; role assignment keeps its refusals under concurrency.
// Runs on the run's engine (the second engine suite covers the other).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { bumpPolicyRevision, policyRevision } from '../../auth/policy-revision.js'
import { BUILTIN_ROLES, deleteRole, getRole, knownAreas, upsertRole } from '../../auth/roles.js'
import { issuePrincipalToken, issueSigninLink, resolvePrincipalById, revokePrincipalToken, sessionPrincipalToken, setPrincipalRole } from '../../auth/principal.js'
import { ensureBoxConfig } from '../../box-config.js'
import type { DatabaseEngine } from '../../box-json.js'
import { clusterOf, clusterPaths, initCluster, openCluster, type RunningCluster } from '../../db/cluster.js'
import { dbRoot } from '../../db/index.js'
import { testEngine } from '../../db/testing.js'
import { resetInstanceDir, setInstanceDir } from '../../testing.js'
import { deleteUser, readUser, setBeforeWriteHoldForTests, setProvisioningHoldForTests, upsertUser } from '../../users/state.js'
import { closeExecutor, executor } from '../executor.js'
import { policySnapshot } from '../policy-snapshot.js'
import { accessOf, AreaAccessError } from '../../auth/access.js'
import { asSystem, fillRequest, freshRequestFrame, runInFrame, runInRequest, type ContextFrame } from '../../request-context.js'
import type { Principal } from '../../auth/principal.js'
import { withRead, withWrite } from '../db.js'
import { coreCommand } from '../core-command.js'
import { requireAccess } from '../../request-context.js'
import { bumpRevisionInTransaction, lockPolicy, reconcileInTransaction } from './policy.js'
import { rolePolicies } from './boot.js'
import { boxSchemaOwners } from '../schema.js'
import { bootDatabase, clearPolicyService, policyCommand, policyLaneState, POLICY_QUEUE_MAX, policyListenerState, refreshPolicy, setPolicyTestHooks, startPolicyListener, stopPolicyListener } from './boot.js'
import { BOX_DATABASE } from './policy.js'

const engine = inject('boxDb').engine as DatabaseEngine
const asSystemForTest = <T>(fn: () => Promise<T>) => asSystem('test: core command', fn)
let dir: string
let running: RunningCluster
let owner: pg.Client

const connect = async (user: string): Promise<pg.Client> => {
  const c = new pg.Client({ host: running.socket, port: running.port, user, database: BOX_DATABASE })
  c.on('error', () => {})
  await c.connect()
  return c
}
const dbRevision = async () => Number((await owner.query<{ revision: string }>('select revision from core.policy_state')).rows[0]!.revision)
const loginOf = async (role: string) => (await owner.query<{ login: string }>('select login from core.role_logins where role_id = $1 and retired_at is null', [role])).rows[0]?.login
/** Another process's policy commit: a raw box_policy session with the same steps as policyCommand. */
const outside = async (write: (c: pg.Client) => Promise<unknown>): Promise<number> => {
  const other = await connect('box_policy')
  try {
    await other.query('begin')
    await lockPolicy(other)
    await write(other)
    const builtins = BUILTIN_ROLES.map((r) => ({ id: r.id, default: r.default, areas: r.areas }))
    await reconcileInTransaction(other, await rolePolicies(other, builtins), knownAreas().filter((a) => a !== 'signals' && a !== 'ops'))
    const revision = await bumpRevisionInTransaction(other)
    await other.query('commit')
    return revision
  } finally {
    await other.end()
  }
}
/** A request frame filled now for `id` (resolved like a transport does), kept to run work in later. */
const frameOf = async (id: string): Promise<ContextFrame> => {
  const principal = (await resolvePrincipalById(id))!
  const access = await accessOf(principal)
  const frame = freshRequestFrame()
  runInFrame(frame, () => fillRequest({ principal, access }))
  return frame
}
const inFrame = <T>(frame: ContextFrame, fn: () => Promise<T>) => runInFrame(frame, fn)
const loginIn = (frame: ContextFrame) => inFrame(frame, async () => (await withRead<{ u: string }>('select current_user u'))[0]!.u)
const areasIn = (frame: ContextFrame) => inFrame(frame, async () => (await withRead<{ a: string }>(`select current_setting('box.read_areas') a`, [], { reach: 'core' }))[0]!.a)
/** A promise and its release, for holding one side of an interleaving. */
const gate = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r }); return { p, open } }
const until = async (ok: () => boolean | Promise<boolean>, ms = 10_000) => {
  const end = Date.now() + ms
  while (!(await ok())) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 25)) }
}
const groupsOf = async (login: string) => (await owner.query<{ g: string }>(
  `select g.rolname g from pg_auth_members am join pg_roles m on m.oid = am.member join pg_roles g on g.oid = am.roleid where m.rolname = $1 order by 1`, [login])).rows.map((r) => r.g)

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-policy-'))
  setInstanceDir(dir)
  ensureBoxConfig()
  const box = JSON.parse(readFileSync(join(dir, 'box.json'), 'utf8')) as Record<string, unknown>
  writeFileSync(join(dir, 'box.json'), JSON.stringify({ ...box, database: { engine } }, null, 2))
  const c = clusterOf(dbRoot(), `${engine}-1`)
  await initCluster(c, await testEngine(engine, clusterPaths(c).cache))
  running = await openCluster(c, await testEngine(engine, clusterPaths(c).cache), 'test')
  const { core, features } = boxSchemaOwners()
  await bootDatabase(running, { core, features, checkFiles: false, knownAreas: knownAreas(), builtinRoles: BUILTIN_ROLES.map((r) => ({ id: r.id, default: r.default, areas: r.areas })) })
  owner = await connect('box_owner')
}, 180_000)

afterAll(async () => {
  await owner?.end().catch(() => {})
  clearPolicyService()
  await closeExecutor()
  await running?.release()
  resetInstanceDir()
  rmSync(dir, { recursive: true, force: true })
})

describe('policy commands', { timeout: 60_000 }, () => {
  it('creates and retires a role login with the role row, in one transaction with the revision', async () => {
    const before = await dbRevision()
    await upsertRole({ id: 'helpdesk', label: 'Helpdesk', default: 'none', areas: { support: 'write', crm: 'read' } })
    const login = (await loginOf('helpdesk'))!
    expect(login).toMatch(/^box_role_\d+$/)
    expect(await groupsOf(login)).toEqual(['area_crm_read', 'area_support_write'])
    const afterCreate = await dbRevision()
    expect(afterCreate).toBeGreaterThan(before)
    expect(policyRevision()).toBeGreaterThanOrEqual(afterCreate)

    await upsertRole({ id: 'helpdesk', label: 'Helpdesk', default: 'none', areas: { support: 'write' } })
    expect(await groupsOf(login)).toEqual(['area_support_write'])

    await deleteRole('helpdesk')
    expect(await loginOf('helpdesk')).toBeUndefined()
    // Retired and cleaned up: the login is gone and its row with it.
    expect((await owner.query('select 1 from pg_roles where rolname = $1', [login])).rowCount).toBe(0)
    expect((await owner.query('select 1 from core.role_logins where login = $1', [login])).rowCount).toBe(0)
    expect(await dbRevision()).toBeGreaterThan(afterCreate)
  })

  it('changes nothing when the command fails after writing (no login, no revision)', async () => {
    const before = await dbRevision()
    await expect(policyCommand('test: failing role write', async (tx) => {
      await tx.run(`insert into core.roles (id, label, default_level, areas, created_at, updated_at) values ('ghost', 'Ghost', 'write', '{}'::jsonb, now(), now())`)
      throw new Error('boom after the write')
    })).rejects.toThrow(/boom after the write/)
    expect((await owner.query(`select 1 from core.roles where id = 'ghost'`)).rowCount).toBe(0)
    expect(await loginOf('ghost')).toBeUndefined()
    expect(await dbRevision()).toBe(before)
  })

  it('refuses policy row writes from every other runtime login', async () => {
    for (const login of ['box_core', 'box_system']) {
      const c = await connect(login)
      try {
        await expect(c.query(`update core.users set role = 'admin' where false`)).rejects.toThrow(/permission denied/)
        await expect(c.query(`insert into core.users (id, role) values ('x-${login}', 'admin')`)).rejects.toThrow(/permission denied/)
        await expect(c.query(`insert into core.roles (id, label) values ('x', 'X')`)).rejects.toThrow(/permission denied/)
        await expect(c.query(`delete from core.roles where false`)).rejects.toThrow(/permission denied/)
        // Everything else on users stays writable for them.
        await c.query(`update core.users set nickname = nickname where false`)
      } finally {
        await c.end()
      }
    }
  })

  it('assigns roles only through the policy service, keeping the last-admin rule under concurrency', async () => {
    await upsertUser({ id: 'ada', first_name: 'Ada' })
    await upsertUser({ id: 'bo', first_name: 'Bo' })
    expect((await readUser('ada'))!.role).toBe('member')
    await setPrincipalRole('ada', 'admin')
    await setPrincipalRole('bo', 'admin')
    const results = await Promise.allSettled([setPrincipalRole('ada', 'member', 'bo'), setPrincipalRole('bo', 'member', 'ada')])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(String((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/last admin/)
    const admins = (await owner.query(`select id from core.users where role = 'admin' and coalesce(kind, 'human') <> 'agent'`)).rows
    expect(admins).toHaveLength(1)
  })

  it('never leaves a user on a deleted role (assignment against deletion)', async () => {
    await upsertRole({ id: 'temp', label: 'Temp', default: 'read', areas: {} })
    await upsertUser({ id: 'cy', first_name: 'Cy' })
    const results = await Promise.allSettled([setPrincipalRole('cy', 'temp'), deleteRole('temp')])
    const role = (await readUser('cy'))!.role
    const exists = (await owner.query(`select 1 from core.roles where id = 'temp'`)).rowCount === 1
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true)
    if (role === 'temp') expect(exists).toBe(true)
    if (exists) await deleteRole('temp').catch(() => {})
  })

  it('upsertUser sets a role through the policy service, never through its own write', async () => {
    await upsertRole({ id: 'reader', label: 'Reader', default: 'read', areas: {} })
    const u = await upsertUser({ id: 'dee', first_name: 'Dee', role: 'reader' })
    expect(u.role).toBe('reader')
    expect((await readUser('dee'))!.role).toBe('reader')
    await upsertUser({ id: 'dee', nickname: 'D' })
    expect((await readUser('dee'))!.role).toBe('reader')
  })

  it('admits the next transaction on a policy another process committed (downgrade and reassignment)', async () => {
    await upsertRole({ id: 'desk', label: 'Desk', default: 'none', areas: { support: 'write', crm: 'read' } })
    await upsertRole({ id: 'narrow', label: 'Narrow', default: 'none', areas: { support: 'read' } })
    await upsertUser({ id: 'eve', first_name: 'Eve', role: 'desk' })
    const eve = { ...(await readUser('eve'))!, kind: 'human' } as unknown as Principal
    const staleAccess = await accessOf(eve)
    const asEve = <T>(fn: () => Promise<T>) => runInRequest(() => { fillRequest({ principal: eve, access: staleAccess }); return fn() })
    const coreAreas = () => asEve(async () => (await withRead<{ a: string }>(`select current_setting('box.read_areas') a`, [], { reach: 'core' }))[0]!.a)
    const areaLogin = () => asEve(async () => (await withRead<{ u: string }>('select current_user u'))[0]!.u)
    expect((await coreAreas()).split(',')).toContain('crm')
    const deskLogin = await areaLogin()
    // A named (prepared) statement on the role login reads crm now (matrix A8).
    const namedCrm = () => asEve(() => withRead<{ pid: number }>({ name: 'a8-crm', text: 'select pg_backend_pid() pid from crm.crm_accounts union all select pg_backend_pid()' }))
    const pidBefore = (await namedCrm()).at(-1)!.pid

    // Another process (a raw box_policy session, not this process's policy service) drops crm from
    // the role: this process holds the old routing, definitions and the frame's old access.
    {
      await outside((c) => c.query(`update core.roles set areas = '{"support":"write"}'::jsonb where id = 'desk'`))
      expect((await coreAreas()).split(',')).not.toContain('crm')
      expect(await areaLogin()).toBe(deskLogin)
      // Same login, membership revoked at that commit: the named statement is denied, on the same
      // pooled session too (privileges are checked per statement).
      const pidNow = (await asEve(() => withRead<{ pid: number }>('select pg_backend_pid() pid')))[0]!.pid
      await expect(namedCrm()).rejects.toMatchObject({ code: '42501' })
      expect(pidNow).toBe(pidBefore)

      // Reassignment elsewhere: the next transaction runs on the new role's login and access.
      await outside((c) => c.query(`update core.users set role = 'narrow' where id = 'eve'`))
      const narrowLogin = (await loginOf('narrow'))!
      // One request frame filled before the change: its first transaction refreshes it.
      const seen = await asEve(async () => ({
        login: (await withRead<{ u: string }>('select current_user u'))[0]!.u,
        areas: (await withRead<{ a: string }>(`select current_setting('box.read_areas') a`, [], { reach: 'core' }))[0]!.a,
      }))
      expect(seen).toEqual({ login: narrowLogin, areas: 'support' })
    }
  })
})

// BOX-Review's review of P (PHASE1.md Progress 2026-11-07): frame generations, one publish path,
// definitions in the snapshot, atomic provisioning, last-admin inside the lock, the committed
// generation as the only tag, the listener's generation guard. Interleavings are held with test
// seams, not timing.
describe('admission against the frame generation', { timeout: 60_000 }, () => {
  it('re-resolves every frame filled before a commit elsewhere, also once the process is current (old login still privileged)', async () => {
    await upsertRole({ id: 'wide2', label: 'Wide', default: 'none', areas: { support: 'write', crm: 'read' } })
    await upsertRole({ id: 'thin2', label: 'Thin', default: 'none', areas: { support: 'read' } })
    await upsertUser({ id: 'fay', first_name: 'Fay', role: 'wide2' })
    const first = await frameOf('fay')
    const second = await frameOf('fay')
    const wideLogin = (await loginOf('wide2'))!
    expect(await loginIn(first)).toBe(wideLogin)
    await outside((c) => c.query(`update core.users set role = 'thin2' where id = 'fay'`))
    const thinLogin = (await loginOf('thin2'))!
    // The old role's login still reads crm; neither frame may use it.
    expect(await groupsOf(wideLogin)).toContain('area_crm_read')
    expect(await loginIn(first)).toBe(thinLogin)
    // The process is current now; the second frame still carries the old generation.
    expect(policyRevision()).toBe(await dbRevision())
    expect(await loginIn(second)).toBe(thinLogin)
    expect(await areasIn(second)).toBe('support')
    await expect(inFrame(second, () => withRead('select 1 from crm.crm_deals limit 1'))).rejects.toMatchObject({ code: '42501' })
  })

  it('a core command authorizes again when the policy moved between its check and its system transaction', async () => {
    await upsertRole({ id: 'cc-w', label: 'W', default: 'none', areas: { signals: 'write' } })
    await upsertRole({ id: 'cc-r', label: 'R', default: 'none', areas: { signals: 'read' } })
    await upsertUser({ id: 'ike', first_name: 'Ike', role: 'cc-w' })
    const frame = await frameOf('ike')
    const insert = (id: string) => coreCommand('test: core command', authorize, (tx) => tx.run(
      `insert into core.signals (id, label, channel, area) values ($1, $1, 'business', 'signals')`, [id]))
    const exists = async (id: string) => (await owner.query('select 1 from core.signals where id = $1', [id])).rowCount === 1
    let calls = 0
    const held = gate()
    let hold = false
    const authorize = async () => {
      calls++
      requireAccess('signals', 'write')
      if (hold) { hold = false; await held.p }
    }
    // Unchanged policy: authorized once, written by box_system.
    await inFrame(frame, () => insert('cc-ok'))
    expect(await exists('cc-ok')).toBe(true)
    expect(calls).toBe(1)
    // Pause after the check, commit a downgrade elsewhere, resume: authorized again and refused.
    calls = 0
    hold = true
    const pending = inFrame(frame, () => insert('cc-late'))
    await until(() => calls === 1)
    await outside((c) => c.query(`update core.users set role = 'cc-r' where id = 'ike'`))
    held.open()
    await expect(pending).rejects.toBeInstanceOf(AreaAccessError)
    expect(calls).toBe(2)
    expect(await exists('cc-late')).toBe(false)
    // The same with this process already current (its listener or another command refreshed it):
    // only the requester's generation shows the change.
    await setPrincipalRole('ike', 'cc-w')
    const again = await frameOf('ike')
    calls = 0
    const held2 = gate()
    const authorize2 = async () => { calls++; requireAccess('signals', 'write'); if (calls === 1) await held2.p }
    const pending2 = inFrame(again, () => coreCommand('test: core command', authorize2, (tx) => tx.run(
      `insert into core.signals (id, label, channel, area) values ('cc-late2', 'x', 'business', 'signals')`)))
    await until(() => calls === 1)
    const committed = await outside((c) => c.query(`update core.users set role = 'cc-r' where id = 'ike'`))
    await refreshPolicy(committed)
    expect(policyRevision()).toBe(committed)
    held2.open()
    await expect(pending2).rejects.toBeInstanceOf(AreaAccessError)
    expect(await exists('cc-late2')).toBe(false)
    // The downgrade lands between the check and a read inside authorize; that read re-resolves the
    // frame (newer access), so admission alone would accept the older check (BOX-Review slice 2, 1).
    await setPrincipalRole('ike', 'cc-w')
    const third = await frameOf('ike')
    calls = 0
    const held3 = gate()
    const authorize3 = async () => {
      calls++
      requireAccess('signals', 'write')
      if (calls === 1) await held3.p
      await withRead('select 1', [], { reach: 'core' })
    }
    const pending3 = inFrame(third, () => coreCommand('test: core command', authorize3, (tx) => tx.run(
      `insert into core.signals (id, label, channel, area) values ('cc-late3', 'x', 'business', 'signals')`)))
    await until(() => calls === 1)
    await outside((c) => c.query(`update core.users set role = 'cc-r' where id = 'ike'`))
    held3.open()
    await expect(pending3).rejects.toBeInstanceOf(AreaAccessError)
    expect(calls).toBe(2)
    expect(await exists('cc-late3')).toBe(false)
    // A core command inside another one's system work is refused, never authorized as system.
    await setPrincipalRole('ike', 'cc-w')
    const fourth = await frameOf('ike')
    await expect(inFrame(fourth, () => coreCommand('test: core command', () => requireAccess('signals', 'write'), () =>
      coreCommand('test: core command', () => {}, (tx) => tx.run(`delete from core.signals where id = 'cc-ok'`))))).rejects.toMatchObject({ code: 'NESTED_LOGIN' })
    expect(await exists('cc-ok')).toBe(true)
    // Without a requester (system code) the command runs as before.
    await asSystemForTest(() => coreCommand('test: core command', () => {}, (tx) => tx.run(`delete from core.signals where id = 'cc-ok'`)))
    expect(await exists('cc-ok')).toBe(false)
  })

  it('re-resolves a stale frame after the listener refreshed first, and after a change in this process', async () => {
    await upsertRole({ id: 'lis-a', label: 'A', default: 'none', areas: { support: 'write' } })
    await upsertRole({ id: 'lis-b', label: 'B', default: 'none', areas: { crm: 'read' } })
    await upsertUser({ id: 'gil', first_name: 'Gil', role: 'lis-a' })
    const frame = await frameOf('gil')
    await startPolicyListener()
    try {
      const committed = await outside((c) => c.query(`update core.users set role = 'lis-b' where id = 'gil'`))
      await until(() => policyRevision() >= committed)
      expect(await areasIn(frame)).toBe('crm')
      // Same process: a role assignment through this process's own policy service.
      const again = await frameOf('gil')
      await setPrincipalRole('gil', 'lis-a')
      expect(await areasIn(again)).toBe('support')
    } finally {
      stopPolicyListener()
    }
  })

  it('moves a frame off a retired role, and refuses a principal that no longer resolves', async () => {
    await upsertRole({ id: 'brief', label: 'Brief', default: 'none', areas: { support: 'write' } })
    await upsertUser({ id: 'hob', first_name: 'Hob', role: 'brief' })
    const frame = await frameOf('hob')
    const briefLogin = (await loginOf('brief'))!
    expect(await loginIn(frame)).toBe(briefLogin)
    await setPrincipalRole('hob', 'member')
    await deleteRole('brief')
    expect(await loginIn(frame)).toBe(policySnapshot()!.logins.get('member'))

    await upsertUser({ id: 'ida', first_name: 'Ida' })
    const gone = await frameOf('ida')
    await outside((c) => c.query(`update core.users set status = 'revoked' where id = 'ida'`))
    await expect(loginIn(gone)).rejects.toMatchObject({ code: 'NO_PRINCIPAL' })
    // The holder is emptied: later work in that frame has no context at all.
    await expect(loginIn(gone)).rejects.toMatchObject({ code: 'NO_CONTEXT' })
  })

  it('refuses every transaction while the policy row is missing', async () => {
    const row = (await owner.query<{ revision: string; next_login: string }>('select revision, next_login from core.policy_state')).rows[0]!
    await owner.query('delete from core.policy_state')
    try {
      await expect(withRead('select 1', [], { reach: 'core' })).rejects.toMatchObject({ code: 'NO_POLICY' })
    } finally {
      await owner.query('insert into core.policy_state (id, revision, next_login) values (1, $1, $2)', [row.revision, row.next_login])
    }
    expect(await withRead('select 1 as one', [], { reach: 'core' })).toEqual([{ one: 1 }])
  })
})

describe('one serialized, monotonic publication', { timeout: 60_000 }, () => {
  it('never lets a command publish an older snapshot over a newer one', async () => {
    const held = gate()
    const reached = gate()
    let once = true
    setPolicyTestHooks({ beforeCommandPublish: async () => { if (once) { once = false; reached.open(); await held.p } } })
    try {
      const a = upsertRole({ id: 'ord-a', label: 'A', default: 'read', areas: {} })
      await reached.p
      await upsertRole({ id: 'ord-b', label: 'B', default: 'read', areas: {} })
      const newer = policyRevision()
      expect(newer).toBe(await dbRevision())
      held.open()
      await a
      expect(policyRevision()).toBe(newer)
      // The newer snapshot holds both roles and both logins; A's older one never replaced it.
      expect(await getRole('ord-a')).not.toBeNull()
      expect(await getRole('ord-b')).not.toBeNull()
      expect(policySnapshot()!.logins.get('ord-b')).toBe(await loginOf('ord-b'))
    } finally {
      setPolicyTestHooks({})
    }
  })

  it('ignores a refresh read before a newer commit was published (definitions included)', async () => {
    const committed = await outside((c) => c.query(`insert into core.roles (id, label, default_level, areas, created_at, updated_at) values ('ref-old', 'Old', 'read', '{}'::jsonb, now(), now())`))
    const held = gate()
    const reached = gate()
    setPolicyTestHooks({ beforeRefreshPublish: async (generation) => { if (generation === committed) { reached.open(); await held.p } } })
    try {
      const refresh = refreshPolicy(committed)
      await reached.p
      await upsertRole({ id: 'ref-new', label: 'New', default: 'read', areas: {} })
      const newer = policyRevision()
      held.open()
      await refresh
      expect(policyRevision()).toBe(newer)
      expect(await getRole('ref-new')).not.toBeNull()
      expect(await getRole('ref-old')).not.toBeNull()
      // Access computed now is tagged with the published generation and its definitions.
      expect((await accessOf({ id: 'x', display: 'x', role: 'ref-new', kind: 'human' })).revision).toBe(newer)
    } finally {
      setPolicyTestHooks({})
    }
  })

  it('tags access no newer than the generation before the identity was read', async () => {
    await upsertUser({ id: 'jo', first_name: 'Jo' })
    const principal = (await resolvePrincipalById('jo'))!
    await upsertRole({ id: 'later', label: 'Later', default: 'read', areas: {} })
    const access = await accessOf(principal)
    expect(access.revision).toBe(principal.resolvedAt)
    expect(access.revision).toBeLessThan(policyRevision())
  })

  it('commits a file-policy bump before reporting it', async () => {
    const revision = await bumpPolicyRevision('test: file policy')
    expect(revision).toBe(await dbRevision())
    expect(policyRevision()).toBe(revision)
  })
})

describe('provisioning and the last-admin rule', { timeout: 60_000 }, () => {
  it('a new user is never authenticatable before it holds its role, and a failed assignment leaves it unusable', async () => {
    await upsertRole({ id: 'prov', label: 'Prov', default: 'read', areas: {} })
    let during: unknown = 'unset'
    setProvisioningHoldForTests(async (id) => {
      during = { principal: await resolvePrincipalById(id), status: (await readUser(id))!.status }
    })
    try {
      const u = await upsertUser({ id: 'kai', first_name: 'Kai', role: 'prov' })
      expect(during).toEqual({ principal: null, status: 'pending' })
      expect(u).toMatchObject({ role: 'prov', status: 'active' })
      expect((await resolvePrincipalById('kai'))!.role).toBe('prov')

      // The role goes away between the insert and the assignment: the assignment fails.
      await upsertRole({ id: 'prov-gone', label: 'Gone', default: 'read', areas: {} })
      setProvisioningHoldForTests(async () => { await deleteRole('prov-gone') })
      await expect(upsertUser({ id: 'lee', first_name: 'Lee', role: 'prov-gone' })).rejects.toThrow(/no role "prov-gone"/)
      expect((await readUser('lee'))!.status).toBe('pending')
      expect(await resolvePrincipalById('lee')).toBeNull()
    } finally {
      setProvisioningHoldForTests(null)
    }
    // A profile-only save never activates it (no default role creeps in).
    expect(await upsertUser({ id: 'lee', nickname: 'Lee' })).toMatchObject({ status: 'pending' })
    expect(await resolvePrincipalById('lee')).toBeNull()
    // Only an explicit role does.
    expect(await upsertUser({ id: 'lee', role: 'prov' })).toMatchObject({ role: 'prov', status: 'active' })
  })

  it('a profile-only save during provisioning neither activates the row nor breaks the restricted activation', async () => {
    const held = gate()
    const reached = gate()
    setProvisioningHoldForTests(async () => { reached.open(); await held.p })
    try {
      const creating = upsertUser({ id: 'max', first_name: 'Max', role: 'prov' })
      await reached.p
      expect(await upsertUser({ id: 'max', nickname: 'M' })).toMatchObject({ status: 'pending' })
      // No credential for an unprovisioned identity, on any entry path.
      await expect(issuePrincipalToken('max')).rejects.toThrow(/not provisioned/)
      await expect(issueSigninLink('max')).rejects.toThrow(/not provisioned/)
      await expect(sessionPrincipalToken('max')).rejects.toThrow(/not provisioned/)
      expect(await resolvePrincipalById('max')).toBeNull()
      held.open()
      expect(await creating).toMatchObject({ role: 'prov', status: 'active' })
      expect(await readUser('max')).toMatchObject({ role: 'prov', status: 'active', nickname: 'M' })
    } finally {
      held.open()
      setProvisioningHoldForTests(null)
    }
  })

  it('refuses a role change that rides with an identity change, before either write', async () => {
    await upsertUser({ id: 'rae', first_name: 'Rae', email: 'rae@example.test' })
    const before = (await owner.query('select * from core.users where id = $1', ['rae'])).rows[0]
    await expect(upsertUser({ id: 'rae', email: 'rae2@example.test', role: 'admin' })).rejects.toThrow(/separately/)
    await expect(upsertUser({ id: 'rae', tailscale_login: 'rae@ts', role: 'admin' })).rejects.toThrow(/separately/)
    expect((await owner.query('select * from core.users where id = $1', ['rae'])).rows[0]).toEqual(before)
    // Categorical: even an unchanged identity value cannot ride with a role change.
    await expect(upsertUser({ id: 'rae', email: 'rae@example.test', role: 'prov' })).rejects.toThrow(/separately/)
    expect((await owner.query('select * from core.users where id = $1', ['rae'])).rows[0]).toEqual(before)
    await upsertUser({ id: 'rae', role: 'prov' })
    expect(await readUser('rae')).toMatchObject({ role: 'prov', email: 'rae@example.test' })
  })

  it('a role change never puts back an identity changed after its read', async () => {
    await upsertUser({ id: 'tam', first_name: 'Tam', email: 'tam@example.test', phone: '+43 660 1000001' })
    await upsertUser({ id: 'uli', first_name: 'Uli' })
    const held = gate()
    const reached = gate()
    let once = true
    setBeforeWriteHoldForTests(async (who) => { if (who === 'tam' && once) { once = false; reached.open(); await held.p } })
    try {
      const promote = upsertUser({ id: 'tam', role: 'admin', nickname: 'T' })
      await reached.p
      setBeforeWriteHoldForTests(null)
      await upsertUser({ id: 'tam', email: 'tam.new@example.test' })
      // The old phone is free now and someone takes it: the role write must not clash on it.
      await upsertUser({ id: 'tam', phone: '+43 660 1000002' })
      await upsertUser({ id: 'uli', phone: '+43 660 1000001' })
      held.open()
      await promote
      expect(await readUser('tam')).toMatchObject({ role: 'admin', nickname: 'T', email: 'tam.new@example.test', phone: '+436601000002' })
      expect((await readUser('uli'))!.phone).toBe('+436601000001')
    } finally {
      held.open()
      setBeforeWriteHoldForTests(null)
    }
    // Demote again (the last-admin tests below expect one admin).
    await setPrincipalRole('tam', 'member')
  })

  it('a create never touches a row created (or revoked) after it read the id as absent', async () => {
    for (const revokeMeanwhile of [false, true]) {
      const id = revokeMeanwhile ? 'sol-r' : 'sol'
      const held = gate()
      const reached = gate()
      let once = true
      setBeforeWriteHoldForTests(async (who) => { if (who === id && once) { once = false; reached.open(); await held.p } })
      try {
        const late = upsertUser({ id, first_name: 'Late' })
        await reached.p
        setBeforeWriteHoldForTests(null)
        await upsertUser({ id, first_name: 'First', role: 'prov' })
        await issuePrincipalToken(id)
        if (revokeMeanwhile) await revokePrincipalToken(id)
        const before = (await owner.query('select * from core.users where id = $1', [id])).rows[0]
        held.open()
        await expect(late).rejects.toThrow(/already exists/)
        expect((await owner.query('select * from core.users where id = $1', [id])).rows[0]).toEqual(before)
      } finally {
        held.open()
        setBeforeWriteHoldForTests(null)
      }
    }
  })

  it('applies the last-admin rule inside the command, on every role write path', async () => {
    const admins = (await owner.query<{ id: string }>(`select id from core.users where role = 'admin' and coalesce(kind, 'human') <> 'agent' and status in ('active', 'invited')`)).rows
    expect(admins).toHaveLength(1)
    await expect(upsertUser({ id: admins[0]!.id, role: 'member' })).rejects.toThrow(/last admin/)
    expect((await readUser(admins[0]!.id))!.role).toBe('admin')
  })
})

describe('revoke and delete are policy changes', { timeout: 60_000 }, () => {
  it('refuses a frame resolved before a revoke or a delete at its next transaction (no other policy change)', async () => {
    await upsertUser({ id: 'nat', first_name: 'Nat' })
    await upsertUser({ id: 'oz', first_name: 'Oz' })
    const natFrame = await frameOf('nat')
    const ozFrame = await frameOf('oz')
    expect(await loginIn(natFrame)).toBe(policySnapshot()!.logins.get('member'))
    await revokePrincipalToken('nat')
    await expect(loginIn(natFrame)).rejects.toMatchObject({ code: 'NO_PRINCIPAL' })
    await deleteUser('oz')
    await expect(loginIn(ozFrame)).rejects.toMatchObject({ code: 'NO_PRINCIPAL' })
  })

  it('never removes the last admin when a revoke, a delete and a demotion race', async () => {
    const [only] = (await owner.query<{ id: string }>(`select id from core.users where role = 'admin' and coalesce(kind, 'human') <> 'agent' and status in ('active', 'invited')`)).rows
    await upsertUser({ id: 'pia', first_name: 'Pia', role: 'admin' })
    await upsertUser({ id: 'quin', first_name: 'Quin', role: 'admin' })
    const results = await Promise.allSettled([revokePrincipalToken(only!.id), deleteUser('pia'), setPrincipalRole('quin', 'member')])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
    expect(String((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/last admin/)
    const left = (await owner.query(`select id from core.users where role = 'admin' and coalesce(kind, 'human') <> 'agent' and status in ('active', 'invited')`)).rows
    expect(left).toHaveLength(1)
  })
})

describe('the listener', { timeout: 60_000 }, () => {
  const listening = async () => Number((await owner.query<{ n: number }>(`select count(*)::int n from pg_stat_activity where usename = 'box_core' and query ilike 'listen%'`)).rows[0]!.n)

  it('restarts once after its session dies (error and end both fire)', async () => {
    await startPolicyListener()
    try {
      expect(policyListenerState().connected).toBe(true)
      const before = policyListenerState().attempts
      await owner.query(`select pg_terminate_backend(pid) from pg_stat_activity where usename = 'box_core' and query ilike 'listen%'`)
      await until(() => policyListenerState().connected && policyListenerState().attempts > before)
      await new Promise((r) => setTimeout(r, 1500))
      expect(policyListenerState().attempts).toBe(before + 1)
      expect(await listening()).toBe(1)
    } finally {
      stopPolicyListener()
    }
  })

  it('keeps retrying failed connects, and a stop during a connect leaves nothing behind', async () => {
    let failures = 2
    setPolicyTestHooks({ beforeListenerConnect: async () => { if (failures-- > 0) throw new Error('test: connect refused') } })
    try {
      await expect(startPolicyListener()).rejects.toThrow(/connect refused/)
      await until(() => policyListenerState().connected, 8000)
      expect(await listening()).toBe(1)
      stopPolicyListener()
      await until(async () => (await listening()) === 0)

      const held = gate()
      const reached = gate()
      setPolicyTestHooks({ beforeListenerConnect: async () => { reached.open(); await held.p } })
      const starting = startPolicyListener()
      await reached.p
      stopPolicyListener()
      held.open()
      await starting
      await new Promise((r) => setTimeout(r, 1500))
      expect(policyListenerState()).toMatchObject({ connected: false, retryScheduled: false })
      expect(await listening()).toBe(0)
    } finally {
      setPolicyTestHooks({})
      stopPolicyListener()
    }
  })
})

describe('the listener after a stop', { timeout: 60_000 }, () => {
  it('a start after a stop never joins the stopped start (its refresh still held)', async () => {
    const held = gate()
    let holding = true
    setPolicyTestHooks({ beforeRefreshPublish: async () => { if (holding) { holding = false; await held.p } } })
    try {
      const first = startPolicyListener()
      await until(() => policyListenerState().connected)
      stopPolicyListener()
      const attempts = policyListenerState().attempts
      const second = startPolicyListener()
      await until(() => policyListenerState().connected)
      expect(policyListenerState().attempts).toBe(attempts + 1)
      held.open()
      await first
      await second
    } finally {
      held.open()
      setPolicyTestHooks({})
      stopPolicyListener()
    }
  })
})

// Matrix A7 (BOX-Review W9 review): the connection bound of a booted process with the listener up.
// Bound per process: the executor budget (24, 4 of them reserved for box_core; idle and closing
// connections count), plus the LISTEN session (box_core), plus the policy lane (one box_policy
// session), plus at most one policy snapshot read (refreshes are one at a time).
describe('A7 connection budget with the listener', () => {
  it('with every ordinary slot held: core still reads, a policy change commits, and the connections stay inside the bound', { timeout: 60_000 }, async () => {
    await upsertRole({ id: 'budget', label: 'Budget', default: 'none', areas: { support: 'write' } })
    const login = (await loginOf('budget'))!
    await startPolicyListener()
    await until(() => policyListenerState().connected)
    const asBudget = <T>(fn: () => Promise<T>) => runInRequest(() => {
      fillRequest({ principal: { id: 'budget-probe', display: 'budget-probe', role: 'budget', kind: 'human' } as Principal,
        access: { role: 'budget', areas: new Map([['support', 'write']]), fallback: 'none', admin: false, revision: policyRevision() } })
      return fn()
    })
    const sessions = async () => Object.fromEntries((await owner.query<{ u: string; n: number }>(
      `select usename u, count(*)::int n from pg_stat_activity where datname = $1 and pid <> pg_backend_pid() group by 1`, [BOX_DATABASE])).rows.map((r) => [r.u, r.n]))
    const held = gate()
    const holders = Array.from({ length: 20 }, () => asBudget(() => withWrite(async (tx) => { await tx.query('select 1'); await held.p })))
    try {
      await until(async () => ((await sessions())[login] ?? 0) === 20)
      // A 21st ordinary transaction queues (it is not served beside the 20).
      let queuedDone = false
      const queued = asBudget(() => withRead('select 1')).finally(() => { queuedDone = true })
      queued.catch(() => {})
      await new Promise((r) => setTimeout(r, 300))
      expect(queuedDone).toBe(false)
      // Core work (sign-in, identity) is served from the reserve.
      const [core] = await asBudget(() => withRead<{ u: string }>('select current_user u', [], { reach: 'core' }))
      expect(core!.u).toBe('box_core')
      // A policy change commits on its own session while every ordinary slot is taken.
      await upsertRole({ id: 'budget-two', label: 'Budget two', default: 'none', areas: { support: 'read' } })
      const now = await sessions()
      expect(now[login]).toBe(20)
      expect(now.box_policy ?? 0).toBe(0)
      // box_core: the pooled reserve (at most 4) + the listener + at most one snapshot read.
      expect(now.box_core ?? 0).toBeGreaterThanOrEqual(1)
      expect(now.box_core ?? 0).toBeLessThanOrEqual(4 + 1 + 1)
      // Open connections, idle pools of earlier work included, never exceed the budget.
      expect(executor().openConnections()).toBeLessThanOrEqual(24)
      const runtime = Object.entries(now).filter(([u]) => u !== 'box_owner').reduce((n, [, c]) => n + c, 0)
      expect(runtime).toBeLessThanOrEqual(24 + 1 + 1)
      expect(policyListenerState().connected).toBe(true)
      held.open()
      await Promise.all(holders)
      await queued.catch(() => {})
    } finally {
      held.open()
      stopPolicyListener()
      await deleteRole('budget-two').catch(() => {})
      await deleteRole('budget').catch(() => {})
    }
  })
})

describe('A7 the policy lane', () => {
  it('holds at most one box_policy session: further commands queue before connecting, the queue is bounded, core work goes on, a failed command passes the lane on', { timeout: 60_000 }, async () => {
    const policySessions = async () => Number((await owner.query(`select count(*) n from pg_stat_activity where usename = 'box_policy' and datname = $1`, [BOX_DATABASE])).rows[0]!.n)
    const inside = gate()
    const release = gate()
    const first = policyCommand('test: lane holder', async (tx) => { await tx.query('select 1'); inside.open(); await release.p })
    await inside.p
    const queued = Array.from({ length: POLICY_QUEUE_MAX }, (_, i) => policyCommand(`test: lane queued ${i}`, async (tx) => { await tx.query('select 1') }))
    await until(async () => policyLaneState().waiting === POLICY_QUEUE_MAX)
    expect(await policySessions()).toBe(1)
    await expect(policyCommand('test: lane overflow', async () => undefined)).rejects.toMatchObject({ code: 'BUDGET' })
    // Core work is not behind the lane.
    expect((await withRead<{ n: number }>('select count(*)::int n from core.roles', [], { reach: 'core' }))[0]!.n).toBeGreaterThanOrEqual(0)
    release.open()
    await first
    await Promise.all(queued)
    expect(policyLaneState()).toEqual({ busy: false, waiting: 0 })
    // A failing command hands the lane on and leaves no session.
    const failing = policyCommand('test: lane failure', async () => { throw new Error('boom in the lane') })
    const after = policyCommand('test: lane after failure', async (tx) => (await tx.query<{ x: number }>('select 1 x'))[0]!.x)
    await expect(failing).rejects.toThrow(/boom in the lane/)
    expect(await after).toBe(1)
    expect(policyLaneState()).toEqual({ busy: false, waiting: 0 })
    await until(async () => (await policySessions()) === 0)
    // Nested use is refused instead of deadlocking.
    await expect(policyCommand('test: outer', () => policyCommand('test: inner', async () => undefined))).rejects.toMatchObject({ code: 'NESTED_LOGIN' })
  })
})

// Last: it takes the policy service away from the rest of this file.
describe('without a policy service', () => {
  it('refuses policy commands and file-policy bumps', async () => {
    clearPolicyService()
    await expect(policyCommand('test: unconfigured', async () => undefined)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' })
    await expect(bumpPolicyRevision('test: unconfigured')).rejects.toThrow(/not configured/)
  })
})
