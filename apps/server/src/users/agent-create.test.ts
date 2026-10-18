// `usersAgentCreate` (Settings > Users > New agent): only a person at a browser session creates an
// agent; an agent (the admin system principal included) and a bearer token are refused, and a
// refusal from core (a person's id) is a 400 naming the reason.

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '@silkweave/box-core/testing'
import { agentsDir, ensureAgentPrincipals, upsertUser } from '@silkweave/box-core'
import { UsersController } from './users.controller.js'

let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-agent-create-'))
  setInstanceDir(dir)
  await ensureAgentPrincipals()
  await upsertUser({ id: 'root', nickname: 'root', role: 'admin' })
})

afterAll(() => {
  resetInstanceDir()
  rmSync(dir, { recursive: true, force: true })
})

const body = { id: 'stella', name: 'Stella', role: 'member' as const }

describe('usersAgentCreate', () => {
  it('refuses an agent and a bearer token, creating nothing', async () => {
    const c = new UsersController()
    await expect(c.agentCreate(body, { principal: { id: 'nova', role: 'admin', kind: 'agent' }, credential: 'session' })).rejects.toThrow(/an agent cannot create agents/)
    await expect(c.agentCreate(body, { principal: { id: 'root', role: 'admin', kind: 'human' }, credential: 'bearer' })).rejects.toThrow(/not with an API token/)
    expect(existsSync(join(agentsDir(), 'stella.md'))).toBe(false)
  })

  it("creates the agent for a person at a session, and refuses a person's id", async () => {
    const c = new UsersController()
    const user = await c.agentCreate(body, { principal: { id: 'root', role: 'admin', kind: 'human' }, credential: 'session' })
    expect(user).toMatchObject({ id: 'stella', kind: 'agent', role: 'member', status: 'active' })
    await expect(c.agentCreate({ ...body, id: 'root' }, { principal: { id: 'root', role: 'admin', kind: 'human' }, credential: 'session' })).rejects.toThrow(/person's id/)
  })
})
