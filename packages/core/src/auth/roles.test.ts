// The role tier, against a throwaway database (docs/core/AUTH.md § 3 and § 4).
//
// Pinned here: the three refusals that keep a Box from reaching "no admins", which are the kind of rule
// that is easy to move into a controller and lose.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { systemUserId } from '../box-config.js'
import { activeAdminCount, assertNotLastAdmin, resolvePrincipalById, setPrincipalRole } from './principal.js'
import { ensureAgentPrincipals, hasHumanUsers } from './bootstrap.js'
import { readUser, upsertUser, deleteUser } from '../users/state.js'
import { resetInstanceDir, setInstanceDir } from '../testing.js'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'box-roles-'))
  setInstanceDir(dir)
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  resetInstanceDir()
})

describe('the admin set', () => {
  it('seeds the configured admin, preserves other profile fields, and does not count it as human', async () => {
    expect(await hasHumanUsers()).toBe(false)
    await ensureAgentPrincipals()
    expect(await hasHumanUsers()).toBe(false) // the agent alone is still a fresh Box
    expect((await readUser(systemUserId()))?.role).toBe('admin')

    await upsertUser({ id: systemUserId(), color: 'indigo' })
    await ensureAgentPrincipals()
    expect((await readUser(systemUserId()))?.color).toBe('indigo') // never rewritten

    await upsertUser({ id: 'alice', nickname: 'alice', role: 'admin' })
    expect(await hasHumanUsers()).toBe(true)
  })

  it('refuses to override the configured machine role through either door', async () => {
    await expect(setPrincipalRole(systemUserId(), 'member')).rejects.toThrow(/system principal/)
    await expect(upsertUser({ id: systemUserId(), role: 'member' })).rejects.toThrow(/system principal/)
    await expect(deleteUser(systemUserId())).rejects.toThrow(/system principal/)
  })

  it('refuses to change your own role', async () => {
    await expect(setPrincipalRole('alice', 'member', 'alice')).rejects.toThrow(/your own role/)
  })

  it('refuses to demote, revoke or delete the last admin', async () => {
    expect(await activeAdminCount()).toBe(1)
    await upsertUser({ id: 'carol', nickname: 'carol' })
    await expect(setPrincipalRole('alice', 'member', 'carol')).rejects.toThrow(/last admin/)
    await expect(assertNotLastAdmin('alice', 'revoking them')).rejects.toThrow(/last admin/)
    // A member is never the last admin, whatever the count says.
    await expect(assertNotLastAdmin('carol', 'deleting them')).resolves.toBeUndefined()

    await setPrincipalRole('carol', 'admin', 'alice')
    expect(await activeAdminCount()).toBe(2)
    await setPrincipalRole('alice', 'member', 'carol') // now allowed: carol is the other admin
    expect((await resolvePrincipalById('alice'))?.role).toBe('member')
  })

  it('keeps a tailscale login unique across users', async () => {
    await upsertUser({ id: 'alice', tailscale_login: 'alice@github' })
    await expect(upsertUser({ id: 'carol', tailscale_login: 'alice@github' })).rejects.toThrow(/already belongs/)
    await expect(upsertUser({ id: 'alice', tailscale_login: 'alice@github' })).resolves.toBeTruthy() // idempotent
  })
})

describe('phone identity', () => {
  it('normalizes typed forms to E.164, refuses others, and keeps one user per number', async () => {
    const { normalizePhone, readUserByPhone } = await import('../users/state.js')
    expect(normalizePhone('+43 (660) 123-4567')).toBe('+436601234567')
    expect(normalizePhone('0043 660 1234567')).toBe('+436601234567')
    expect(normalizePhone('  ')).toBeNull()
    expect(() => normalizePhone('0660 1234567')).toThrow(/international form/)
    await upsertUser({ id: 'phone-a', nickname: 'A', phone: '+43 660 1234567' })
    expect((await readUser('phone-a'))?.phone).toBe('+436601234567')
    expect((await readUserByPhone('0043660 1234567'))?.id).toBe('phone-a')
    await expect(upsertUser({ id: 'phone-b', nickname: 'B', phone: '+436601234567' })).rejects.toThrow(/already belongs to user "phone-a"/)
    await upsertUser({ id: 'phone-a', nickname: 'A2' })
    expect((await readUser('phone-a'))?.phone).toBe('+436601234567')
    await upsertUser({ id: 'phone-a', phone: '' })
    expect((await readUser('phone-a'))?.phone).toBeNull()
  })
})
