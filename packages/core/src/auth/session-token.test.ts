// The token a server-owned session carries (`sessionPrincipalToken`), against a real warehouse.
// It replaced reveal-or-issue in the session path, which had two defects (review 2026-10-11):
// issuing for a revoked principal reactivated them, and two sessions starting at once each issued
// a token, so one overwrote the other's.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensureSchema, withRead } from '../warehouse/db.js'
import { upsertUser } from '../users/state.js'
import { ensureAgentPrincipals } from './bootstrap.js'
import { authenticatePrincipal, issuePrincipalToken, resolvePrincipalById, revokePrincipalToken, sessionPrincipalToken } from './principal.js'
import { resetInstanceDir, setInstanceDir } from '../testing.js'

let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-session-token-'))
  setInstanceDir(dir)
  await ensureSchema()
  await ensureAgentPrincipals()
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  resetInstanceDir()
})

describe('sessionPrincipalToken', () => {
  it('returns the existing token without rotating it', async () => {
    await upsertUser({ id: 'erin', nickname: 'erin', role: 'admin' })
    const issued = await issuePrincipalToken('erin')
    expect(await sessionPrincipalToken('erin')).toBe(issued)
    expect((await authenticatePrincipal(issued))?.id).toBe('erin')
  })

  it('issues one token when none exists, shared by concurrent first sessions', async () => {
    await upsertUser({ id: 'frank', nickname: 'frank', role: 'admin' })
    const tokens = await Promise.all([sessionPrincipalToken('frank'), sessionPrincipalToken('frank'), sessionPrincipalToken('frank')])
    expect(new Set(tokens).size).toBe(1)
    expect((await authenticatePrincipal(tokens[0]!))?.id).toBe('frank')
  })

  it('refuses a revoked principal and leaves them revoked', async () => {
    await upsertUser({ id: 'gail', nickname: 'gail', role: 'admin' })
    await issuePrincipalToken('gail')
    await revokePrincipalToken('gail')
    await expect(sessionPrincipalToken('gail')).rejects.toThrow(/revoked/)
    expect(await resolvePrincipalById('gail')).toBeNull()
    const rows = await withRead<{ status: string }>(`SELECT status FROM users WHERE id = ?`, ['gail'])
    expect(rows[0]?.status).toBe('revoked')
  })

  it('refuses an unknown user', async () => {
    await expect(sessionPrincipalToken('nobody')).rejects.toThrow(/no user/)
  })
})
