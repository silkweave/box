// Agent principals against a real warehouse: core:007 on a populated table, boot reconciliation
// (create, human-id refusal, retire, restore), the eligibility predicate in authentication and
// session tokens, the invariants keyed on `kind = 'agent'`, and agent files in backup and restore.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DuckDBInstance } from '@duckdb/node-api'
import { applySchema, type MigrationConn } from '../warehouse/schema.js'
import { CORE_MODELS } from '../warehouse/core-models.js'
import { createTableSql } from '../warehouse/model.js'
import { ensureSchema, withRead } from '../warehouse/db.js'
import { backupWarehouse, restoreWarehouse } from '../warehouse/backup.js'
import { captureAgentFiles } from '../warehouse/agent-snapshot.js'
import { SESSION_COOKIE, mintSession } from './session.js'
import { mintSigninGrant } from './link.js'
import { agentsDir } from '../agents.js'
import { clearMaintenanceOverride, setMaintenanceOverride } from '../box-config.js'
import { deleteUser, readUser, readUsers, upsertUser } from '../users/state.js'
import { createAgent, ensureAgentPrincipals, hasHumanUsers } from './bootstrap.js'
import {
  activeAdminCount,
  activeAgentPrincipals,
  authenticatePrincipal,
  consumeSigninGrant,
  resolveSessionPrincipal,
  issuePrincipalToken,
  issueSigninLink,
  resolvePrincipalById,
  sessionPrincipalToken,
  setPrincipalRole,
} from './principal.js'
import { resetInstanceDir, setInstanceDir } from '../testing.js'

let dir: string

const agentFile = (id: string, name: string, role: 'admin' | 'member', body = ''): void => {
  mkdirSync(agentsDir(), { recursive: true })
  writeFileSync(join(agentsDir(), `${id}.md`), `---\nname: ${name}\nrole: ${role}\n---\n${body}`)
}
const removeAgentFile = (id: string): void => rmSync(join(agentsDir(), `${id}.md`), { force: true })
const row = async (id: string) =>
  (await withRead<{ kind: string; status: string; role: string; token_ciphertext: string | null; sort: number }>(
    `SELECT kind, status, role, token_ciphertext, sort FROM users WHERE id = ?`,
    [id],
  ))[0]

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-agent-lifecycle-'))
  setInstanceDir(dir)
  await ensureSchema()
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  resetInstanceDir()
})

describe('core:007-users-kind on a POPULATED users table', () => {
  it('adds kind = human to every row and marks only the locked system id an agent', async () => {
    const file = join(dir, 'upgrade.db')
    const instance = await DuckDBInstance.create(file)
    const conn = await instance.connect()
    const spec = CORE_MODELS.find((m) => m.table === 'users')!
    const legacy = { ...spec, columns: Object.fromEntries(Object.entries(spec.columns).filter(([name]) => name !== 'kind')) }
    await conn.run(createTableSql(legacy))
    for (const id of ['alice', 'nova', 'stella']) {
      await conn.run(`INSERT INTO users (id, first_name, last_name, nickname) VALUES (?, '', '', ?)`, [id, id])
    }
    await applySchema(conn as unknown as MigrationConn, [])
    const rows = (await conn.runAndReadAll(`SELECT id, kind FROM users ORDER BY id`)).getRowObjectsJson()
    expect(rows).toEqual([
      { id: 'alice', kind: 'human' },
      { id: 'nova', kind: 'agent' },
      // An existing account is never converted by the migration, whatever files exist later.
      { id: 'stella', kind: 'human' },
    ])
    conn.disconnectSync()
    instance.closeSync()
  })
})

describe('boot reconciliation', () => {
  it('creates the system principal and each file agent as kind = agent, name and role from config', async () => {
    agentFile('stella', 'Stella', 'member', 'You are Stella.')
    const result = await ensureAgentPrincipals()
    expect(result.created.sort()).toEqual(['nova', 'stella'])
    expect(await row('nova')).toMatchObject({ kind: 'agent', role: 'admin', sort: 99 })
    expect(await row('stella')).toMatchObject({ kind: 'agent', role: 'member', sort: 99 })
    expect(await readUser('stella')).toMatchObject({ first_name: 'Stella', nickname: 'Stella' })
    expect(await hasHumanUsers()).toBe(false)
    expect((await activeAgentPrincipals()).map((p) => p.id)).toEqual(['nova', 'stella'])
  })

  it('follows a role or name change in the file on the next boot, and reads role at call time before that', async () => {
    const token = await sessionPrincipalToken('stella')
    agentFile('stella', 'Stella R.', 'admin')
    expect(await authenticatePrincipal(token)).toMatchObject({ id: 'stella', display: 'Stella R.', role: 'admin', kind: 'agent' })
    await ensureAgentPrincipals()
    expect(await row('stella')).toMatchObject({ role: 'admin' })
    agentFile('stella', 'Stella', 'member')
    await ensureAgentPrincipals()
  })

  it('keeps a nickname a person set across boots', async () => {
    await upsertUser({ id: 'stella', nickname: 'Stel' })
    await ensureAgentPrincipals()
    expect((await readUser('stella'))?.nickname).toBe('Stel')
    await upsertUser({ id: 'stella', nickname: 'Stella' })
  })

  it('refuses to boot, before any write, when an agent file names a person', async () => {
    await upsertUser({ id: 'alice', nickname: 'alice', role: 'admin' })
    agentFile('alice', 'Alice Bot', 'member')
    agentFile('newbie', 'Newbie', 'member')
    await expect(ensureAgentPrincipals()).rejects.toThrow(/alice\.md names an existing person/)
    expect(await readUser('newbie')).toBeNull()
    expect((await readUser('alice'))?.kind).toBe('human')
    removeAgentFile('alice')
    removeAgentFile('newbie')
  })

  it('refuses to boot while an agent file does not parse', async () => {
    agentFile('broken', 'Broken', 'member')
    writeFileSync(join(agentsDir(), 'broken.md'), '---\nname: Broken\nrole: member\nengine: codex\n---\n')
    await expect(ensureAgentPrincipals()).rejects.toThrow(/unknown key "engine"/)
    removeAgentFile('broken')
  })

  it('refuses to create a person under an agent id', async () => {
    agentFile('scout', 'Scout', 'member')
    await expect(upsertUser({ id: 'scout', nickname: 'scout' })).rejects.toThrow(/is an agent id/)
    removeAgentFile('scout')
  })
})

describe('retire and restore', () => {
  it('stops a deleted file at once, retires the row at boot, and keeps it as a tombstone', async () => {
    agentFile('scribe', 'Scribe', 'member')
    await ensureAgentPrincipals()
    const token = await sessionPrincipalToken('scribe')
    expect((await authenticatePrincipal(token))?.id).toBe('scribe')

    removeAgentFile('scribe')
    expect((await activeAgentPrincipals()).map((p) => p.id)).not.toContain('scribe')
    // Runtime: the predicate reads the file now, without a boot, and the retirement it observed
    // is persisted at once.
    expect(await authenticatePrincipal(token)).toBeNull()
    expect(await row('scribe')).toMatchObject({ kind: 'agent', status: 'revoked' })
    expect(await resolvePrincipalById('scribe')).toBeNull()
    await expect(sessionPrincipalToken('scribe')).rejects.toThrow(/retired/)
    expect((await ensureAgentPrincipals()).retired).toEqual([])
    await expect(deleteUser('scribe')).rejects.toThrow(/never deleted/)
    await expect(issuePrincipalToken('scribe')).rejects.toThrow(/restored by restoring its file/)
    expect((await row('scribe'))?.status).toBe('revoked')
  })

  it('does not revive the old token when a file is deleted and put back between two boots', async () => {
    agentFile('echo', 'Echo', 'member')
    await ensureAgentPrincipals()
    const token = await sessionPrincipalToken('echo')
    removeAgentFile('echo')
    await expect(sessionPrincipalToken('echo')).rejects.toThrow(/retired/)
    agentFile('echo', 'Echo', 'member')
    expect(await authenticatePrincipal(token)).toBeNull()
    expect((await ensureAgentPrincipals()).restored).toEqual(['echo'])
    expect(await authenticatePrincipal(token)).toBeNull()
  })

  it('retires an unobserved deletion at boot, except on a maintenance boot', async () => {
    agentFile('quiet', 'Quiet', 'member')
    await ensureAgentPrincipals()
    removeAgentFile('quiet')
    setMaintenanceOverride(true)
    try {
      expect((await ensureAgentPrincipals()).retired).toEqual([])
    } finally {
      clearMaintenanceOverride()
    }
    expect((await row('quiet'))?.status).toBe('active')
    expect((await ensureAgentPrincipals()).retired).toEqual(['quiet'])
  })

  it('restores a retired agent whose file is back, with its old token dead', async () => {
    const old = (await row('scribe'))!.token_ciphertext
    expect(old).not.toBeNull()
    agentFile('scribe', 'Scribe', 'member')
    // Back on disk is not enough: the row stays retired until boot restores it.
    expect(await resolvePrincipalById('scribe')).toBeNull()
    const result = await ensureAgentPrincipals()
    expect(result.restored).toEqual(['scribe'])
    expect(await row('scribe')).toMatchObject({ status: 'active', token_ciphertext: null })
    const fresh = await sessionPrincipalToken('scribe')
    expect((await authenticatePrincipal(fresh))?.id).toBe('scribe')
  })
})

describe('invariants keyed on kind = agent', () => {
  it('keeps agent admins out of the human admin count and the last-admin rule', async () => {
    agentFile('chief', 'Chief', 'admin')
    await ensureAgentPrincipals()
    const before = await activeAdminCount()
    expect(before).toBe(1) // alice
    expect((await readUsers()).filter((u) => u.kind === 'agent').map((u) => u.id).sort()).toEqual(['chief', 'echo', 'nova', 'quiet', 'scribe', 'stella'])
  })

  it('takes every agent role from config', async () => {
    await expect(setPrincipalRole('chief', 'member', 'alice')).rejects.toThrow(/controlled by data\/config\/agents\/chief\.md/)
    await setPrincipalRole('chief', 'admin', 'alice') // what the file says: accepted, a no-op
    await expect(upsertUser({ id: 'chief', role: 'member' })).rejects.toThrow(/controlled by/)
    await expect(setPrincipalRole('nova', 'member', 'alice')).rejects.toThrow(/box\.json/)
  })

  it('gives no agent a sign-in link and deletes none', async () => {
    await expect(issueSigninLink('chief')).rejects.toThrow(/bearer token, not a link/)
    await expect(issueSigninLink('nova')).rejects.toThrow(/bearer token, not a link/)
    await expect(deleteUser('chief')).rejects.toThrow(/never deleted/)
    await expect(deleteUser('nova')).rejects.toThrow(/cannot be deleted/)
  })

  it('rotates an active agent token on the host', async () => {
    const first = await sessionPrincipalToken('chief')
    const rotated = await issuePrincipalToken('chief')
    expect(rotated).not.toBe(first)
    expect(await authenticatePrincipal(first)).toBeNull()
    expect(await authenticatePrincipal(rotated)).toMatchObject({ id: 'chief', kind: 'agent', role: 'admin' })
  })

  it('marks a person human', async () => {
    const token = await issuePrincipalToken('alice')
    expect(await authenticatePrincipal(token)).toMatchObject({ id: 'alice', kind: 'human', role: 'admin' })
  })

  it('never resolves a session cookie or a sign-in grant to an agent', async () => {
    expect(await resolveSessionPrincipal(`${SESSION_COOKIE}=${mintSession('alice')}`)).toMatchObject({ id: 'alice', kind: 'human' })
    // A cookie or grant issued before (or while the account was a person's) is refused all the same.
    expect(await resolveSessionPrincipal(`${SESSION_COOKIE}=${mintSession('chief')}`)).toBeNull()
    expect(await resolveSessionPrincipal(`${SESSION_COOKIE}=${mintSession('nova')}`)).toBeNull()
    for (const id of ['chief', 'nova']) {
      expect(await consumeSigninGrant(mintSigninGrant(id).grant)).toEqual({ ok: false, reason: 'revoked' })
    }
  })
})

describe('backup and restore carry the agent files', () => {
  it('snapshots data/config/agents/ beside the restore point and puts it back on restore', async () => {
    const backup = await backupWarehouse({ label: 'manual', remote: false })
    const snapshot = backup.local!.path.replace(/\.db$/, '.agents.json')
    expect(existsSync(snapshot)).toBe(true)
    const names = Object.keys((JSON.parse(readFileSync(snapshot, 'utf8')) as { files: object }).files).sort()
    expect(names).toEqual(['chief.md', 'echo.md', 'scribe.md', 'stella.md'])

    removeAgentFile('chief')
    agentFile('intruder', 'Intruder', 'admin')
    const restored = await restoreWarehouse(backup.local!.name)
    expect(restored.summary).toMatch(/agents\/ restored \(4 files\)/)
    expect(existsSync(join(agentsDir(), 'chief.md'))).toBe(true)
    expect(existsSync(join(agentsDir(), 'intruder.md'))).toBe(false)
    // The parked state carries the files as they were before the restore.
    const parked = JSON.parse(readFileSync(restored.parked!.replace(/\.db$/, '.agents.json'), 'utf8')) as { files: object }
    expect(Object.keys(parked.files).sort()).toEqual(['echo.md', 'intruder.md', 'scribe.md', 'stella.md'])
  })

  it('refuses a damaged sidecar before touching the warehouse or the files', async () => {
    const backup = await backupWarehouse({ label: 'manual', remote: false })
    const sidecar = backup.local!.path.replace(/\.db$/, '.agents.json')
    await upsertUser({ id: 'marker', nickname: 'marker' })
    const before = Object.keys(captureAgentFiles()).sort()
    for (const bad of ['{"format":"box-agent-files/1","files":{"x', '[]', 'null', '{"format":"box-agent-files/1","files":{"../evil.md":"x"}}', '{"stella.md":"x"}']) {
      writeFileSync(sidecar, bad)
      await expect(restoreWarehouse(backup.local!.name)).rejects.toThrow(/agents\.json/)
      expect(await readUser('marker')).not.toBeNull()
      expect(Object.keys(captureAgentFiles()).sort()).toEqual(before)
    }
  })

  it('refuses to boot after a restore died between the file swap and the database swap, until restored again', async () => {
    const backup = await backupWarehouse({ label: 'manual', remote: false })
    // What a process that died after swapping the files leaves behind.
    writeFileSync(join(agentsDir(), '..', 'agents.restore-in-progress.json'), JSON.stringify({ restorePoint: backup.local!.name, previous: null }))
    await expect(ensureAgentPrincipals()).rejects.toThrow(/restore was interrupted/)
    await restoreWarehouse(backup.local!.name)
    await expect(ensureAgentPrincipals()).resolves.toBeDefined()
  })

  it('refuses a backup without agent files unless told to keep the live ones', async () => {
    const backup = await backupWarehouse({ label: 'manual', remote: false })
    rmSync(backup.local!.path.replace(/\.db$/, '.agents.json'))
    await expect(restoreWarehouse(backup.local!.name)).rejects.toThrow(/--keep-agent-files/)
    const before = captureAgentFiles()
    const restored = await restoreWarehouse(backup.local!.name, { keepAgentFiles: true })
    expect(restored.summary).toMatch(/carries no agent files/)
    expect(captureAgentFiles()).toEqual(before)
  })
})

describe('createAgent (Settings > Users > New agent)', () => {
  it('writes the file and creates the agent row at once, without a boot', async () => {
    const user = await createAgent({ id: 'runtime-ana', name: 'Ana Runtime', role: 'member', instructions: 'You answer partner questions.' })
    expect(user).toMatchObject({ id: 'runtime-ana', kind: 'agent', role: 'member', first_name: 'Ana Runtime', status: 'active' })
    expect(readFileSync(join(agentsDir(), 'runtime-ana.md'), 'utf8')).toBe('---\nname: "Ana Runtime"\nrole: member\n---\nYou answer partner questions.\n')
    await expect(createAgent({ id: 'runtime-ana', name: 'Again', role: 'member' })).rejects.toThrow(/exists already/)
  })

  it("refuses a person's id, the system principal's id, a bad id and a bad name, writing nothing", async () => {
    await upsertUser({ id: 'runtime-person', nickname: 'runtime-person' })
    await expect(createAgent({ id: 'runtime-person', name: 'P', role: 'member' })).rejects.toThrow(/person's id/)
    await expect(createAgent({ id: 'Bad Id', name: 'B', role: 'member' })).rejects.toThrow(/lowercase slug/)
    await expect(createAgent({ id: 'runtime-quote', name: 'A "quoted" name', role: 'member' })).rejects.toThrow(/double quotes/)
    expect(existsSync(join(agentsDir(), 'runtime-person.md'))).toBe(false)
    expect(existsSync(join(agentsDir(), 'runtime-quote.md'))).toBe(false)
  })

  it('brings a retired agent back under its id', async () => {
    await createAgent({ id: 'runtime-bo', name: 'Bo', role: 'member' })
    removeAgentFile('runtime-bo')
    await ensureAgentPrincipals()
    expect((await row('runtime-bo'))?.status).toBe('revoked')
    expect(await createAgent({ id: 'runtime-bo', name: 'Bo', role: 'admin' })).toMatchObject({ status: 'active', role: 'admin', kind: 'agent' })
  })
})
