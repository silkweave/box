// Custom roles and the access they grant (docs/AUTH.md "Roles and areas"), against a throwaway
// warehouse: built-ins are reserved, an unknown role grants nothing, assignment needs an existing
// role, deletion is refused while a user or an agent config references the role.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '../testing.js'
import { accessOf, levelOf, policyRevision } from './access.js'
import { deleteRole, explainLevels, getRole, knownAreas, listRoles, roleReferences, upsertRole } from './roles.js'
import { resolvePrincipalById, setPrincipalRole } from './principal.js'
import { ensureAgentPrincipals } from './bootstrap.js'
import { upsertUser } from '../users/state.js'
import { configPath } from '../io.js'

let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-access-'))
  setInstanceDir(dir)
  await ensureAgentPrincipals()
  await upsertUser({ id: 'boss', first_name: 'Boss', role: 'admin' })
  await upsertUser({ id: 'ana', first_name: 'Ana', role: 'member' })
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  resetInstanceDir()
})

const sales = { id: 'sales', label: 'Sales', default: 'none' as const, areas: { crm: 'write' as const, planning: 'read' as const } }

describe('roles', () => {
  it('lists the built-ins, and refuses to store, change or delete them', async () => {
    expect((await listRoles()).map((r) => r.id).slice(0, 2)).toEqual(['admin', 'member'])
    await expect(upsertRole({ ...sales, id: 'admin' })).rejects.toThrow(/built-in/)
    await expect(upsertRole({ ...sales, id: 'member' })).rejects.toThrow(/built-in/)
    await expect(deleteRole('member')).rejects.toThrow(/built-in/)
  })

  it('validates ids, labels, levels and area names', async () => {
    await expect(upsertRole({ ...sales, id: 'Sales!' })).rejects.toThrow(/slug/)
    await expect(upsertRole({ ...sales, label: ' ' })).rejects.toThrow(/label/)
    await expect(upsertRole({ ...sales, default: 'all' as never })).rejects.toThrow(/default/)
    await expect(upsertRole({ ...sales, areas: { nope: 'read' } })).rejects.toThrow(/not an area/)
    await expect(upsertRole({ ...sales, areas: { crm: 'admin' as never } })).rejects.toThrow(/level/)
    expect(knownAreas()).toEqual(expect.arrayContaining(['crm', 'signals', 'ops']))
  })

  it('a custom role grants its levels, its default for the rest, and never admin authority', async () => {
    const before = policyRevision()
    await upsertRole(sales, 'boss')
    expect(policyRevision()).toBeGreaterThan(before)
    expect(await getRole('sales')).toMatchObject({ label: 'Sales', default: 'none', areas: { crm: 'write', planning: 'read' } })
    const access = await accessOf({ id: 'x', display: 'x', role: 'sales', kind: 'human' })
    expect(levelOf(access, 'crm')).toBe('write')
    expect(levelOf(access, 'planning')).toBe('read')
    expect(levelOf(access, 'sink')).toBe('none')
    expect(access.admin).toBe(false)
    expect(explainLevels(access).find((l) => l.area === 'crm')).toEqual({ area: 'crm', level: 'write' })
  })

  it('built-ins: admin and member write everywhere; only admin has authority', async () => {
    const admin = await accessOf({ id: 'boss', display: 'b', role: 'admin', kind: 'human' })
    const member = await accessOf({ id: 'ana', display: 'a', role: 'member', kind: 'human' })
    expect([levelOf(admin, 'crm'), admin.admin]).toEqual(['write', true])
    expect([levelOf(member, 'crm'), member.admin]).toEqual(['write', false])
  })

  it('an unknown role id grants nothing, and is kept as written rather than narrowed to member', async () => {
    const ghost = await accessOf({ id: 'g', display: 'g', role: 'ghost', kind: 'human' })
    expect([levelOf(ghost, 'crm'), ghost.admin, ghost.fallback]).toEqual(['none', false, 'none'])
  })

  it('assignment needs an existing role; deletion waits until nobody references it', async () => {
    await expect(setPrincipalRole('ana', 'nope', 'boss')).rejects.toThrow(/no role "nope"/)
    await setPrincipalRole('ana', 'sales', 'boss')
    expect((await resolvePrincipalById('ana'))?.role).toBe('sales')
    expect(await roleReferences('sales')).toEqual({ users: ['ana'], agents: [] })
    await expect(deleteRole('sales')).rejects.toThrow(/still assigned to ana/)
    await setPrincipalRole('ana', 'member', 'boss')
    await deleteRole('sales')
    expect(await getRole('sales')).toBeNull()
    await expect(deleteRole('sales')).rejects.toThrow(/no role/)
  })

  it('an agent file may name a custom role; deletion and boot both see it', async () => {
    await upsertRole({ ...sales, id: 'helper', label: 'Helper' }, 'boss')
    mkdirSync(configPath('agents'), { recursive: true })
    writeFileSync(configPath('agents/scout.md'), '---\nname: Scout\nrole: helper\n---\nHelps.\n')
    await ensureAgentPrincipals()
    expect((await resolvePrincipalById('scout'))?.role).toBe('helper')
    await expect(deleteRole('helper')).rejects.toThrow(/agent scout/)
    writeFileSync(configPath('agents/scout.md'), '---\nname: Scout\nrole: missing-role\n---\nHelps.\n')
    await expect(ensureAgentPrincipals()).rejects.toThrow(/no role "missing-role"/)
    rmSync(configPath('agents/scout.md'))
  })
})
