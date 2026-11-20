// Delegated credentials (MCP sign-in grants): who may hold them (`resolveDelegatedPrincipal`) and
// the identity version they are bound to (`users.auth_epoch`). A revoke replaces the epoch, so
// restoring access or re-creating the same id never revives a grant approved before; the
// access-ended port tells the feature holding the grants after the change commits.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { deleteUser, systemUserId, upsertUser } from '../users/state.js'
import { registerUserAccessEnded, type UserAccessEndedReason } from '../users/access-ended.js'
import { ensureAgentPrincipals } from './bootstrap.js'
import { issuePrincipalToken, resolveDelegatedPrincipal, revokePrincipalToken } from './principal.js'
import { resetInstanceDir, setInstanceDir } from '../testing.js'

let dir: string
const ended: Array<[string, UserAccessEndedReason]> = []
let unregister: () => void

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-delegated-'))
  setInstanceDir(dir)
  await ensureAgentPrincipals()
  await upsertUser({ id: 'keeper', nickname: 'keeper', role: 'admin' })
  unregister = registerUserAccessEnded('test', (id, reason) => {
    ended.push([id, reason])
  })
})

afterAll(() => {
  unregister()
  rmSync(dir, { recursive: true, force: true })
  resetInstanceDir()
})

describe('resolveDelegatedPrincipal and auth_epoch', () => {
  it('gives every new person their own epoch', async () => {
    await upsertUser({ id: 'dana', nickname: 'dana', role: 'member' })
    await upsertUser({ id: 'eli', nickname: 'eli', role: 'member' })
    const a = await resolveDelegatedPrincipal('dana')
    const b = await resolveDelegatedPrincipal('eli')
    expect(a?.principal.id).toBe('dana')
    expect(a?.epoch).toMatch(/^[0-9a-f-]{36}$/)
    expect(a?.epoch).not.toBe(b?.epoch)
    // Reading twice changes nothing.
    expect((await resolveDelegatedPrincipal('dana'))?.epoch).toBe(a?.epoch)
  })

  it('refuses a revoked person, and restoring access keeps the new epoch', async () => {
    await upsertUser({ id: 'fay', nickname: 'fay', role: 'member' })
    const before = (await resolveDelegatedPrincipal('fay'))!.epoch
    ended.length = 0
    await revokePrincipalToken('fay')
    expect(await resolveDelegatedPrincipal('fay')).toBeNull()
    expect(ended).toEqual([['fay', 'revoked']])
    await issuePrincipalToken('fay')
    const after = await resolveDelegatedPrincipal('fay')
    expect(after?.principal.id).toBe('fay')
    expect(after?.epoch).not.toBe(before)
  })

  it('gives a re-created id a new epoch', async () => {
    await upsertUser({ id: 'gus', nickname: 'gus', role: 'member' })
    const before = (await resolveDelegatedPrincipal('gus'))!.epoch
    ended.length = 0
    await deleteUser('gus')
    expect(ended).toEqual([['gus', 'deleted']])
    expect(await resolveDelegatedPrincipal('gus')).toBeNull()
    await upsertUser({ id: 'gus', nickname: 'gus', role: 'member' })
    expect((await resolveDelegatedPrincipal('gus'))?.epoch).not.toBe(before)
  })

  it('refuses agents, the system principal and unknown ids', async () => {
    expect(await resolveDelegatedPrincipal(systemUserId())).toBeNull()
    expect(await resolveDelegatedPrincipal('nobody')).toBeNull()
    expect(await resolveDelegatedPrincipal('')).toBeNull()
  })

  it('a failing listener does not fail the revoke', async () => {
    const off = registerUserAccessEnded('throws', () => {
      throw new Error('listener down')
    })
    try {
      await upsertUser({ id: 'hal', nickname: 'hal', role: 'member' })
      await expect(revokePrincipalToken('hal')).resolves.toBeUndefined()
      expect(await resolveDelegatedPrincipal('hal')).toBeNull()
    } finally {
      off()
    }
  })
})
