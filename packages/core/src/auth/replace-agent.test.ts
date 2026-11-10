// `box auth replace`: a new agent takes over an agent's configuration and the old one retires, with
// its history kept. Covers the system principal (box.json, identity lock, instructions file, profile
// keys) and a file agent, and the refusals.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { agentFileText, agentsDir } from '../agents.js'
import { readReplaceIntent, writeReplaceIntent } from '../warehouse/agent-snapshot.js'
import { agentIdentity } from '../box-config.js'
import { recordEvent } from '../events.js'
import { readUser, upsertUser } from '../users/state.js'
import { ensureAgentPrincipals } from './bootstrap.js'
import { replaceAgent } from './replace-agent.js'
import { resetInstanceDir, setInstanceDir } from '../testing.js'

// One warehouse for the file: tests run in order (refusals, a file agent, then the system principal).
let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-replace-agent-'))
  setInstanceDir(dir)
  writeFileSync(join(dir, 'box.json'), `${JSON.stringify({
    agent: { id: 'nova', name: 'Nova', role: 'admin' },
    agentProfiles: { nova: { claude: 'a' } },
    browsers: { users: { nova: 'nova-browser' } },
  }, null, 2)}\n`)
  await ensureAgentPrincipals()
  await upsertUser({ id: 'toby', first_name: 'Toby', role: 'admin' })
  await recordEvent({ kind: 'demo.run', dedup_key: 'r1', actor: 'nova', fields: {}, areas: ['ops'] })
  await recordEvent({ kind: 'demo.run', dedup_key: 'r2', actor: 'toby', fields: {}, areas: ['ops'] })
})

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true })
  resetInstanceDir()
})

it('refuses a person, an existing id and a bad id', async () => {
  await expect(replaceAgent({ from: 'toby', to: 'x' })).rejects.toThrow(/not an active agent/)
  await expect(replaceAgent({ from: 'nova', to: 'toby' })).rejects.toThrow(/exists already/)
  await expect(replaceAgent({ from: 'nova', to: 'Bad Id' })).rejects.toThrow(/not a valid agent id/)
  expect(agentIdentity().id).toBe('nova')
})

it('moves a file agent to a new file', async () => {
  mkdirSync(agentsDir(), { recursive: true })
  writeFileSync(join(agentsDir(), 'stella.md'), '---\nname: Stella\nrole: member\n---\nResearch.\n')
  await ensureAgentPrincipals()
  const result = await replaceAgent({ from: 'stella', to: 'vega' })
  expect(result.system).toBe(false)
  expect(readFileSync(join(agentsDir(), 'vega.md'), 'utf8')).toContain('name: "Stella"')
  expect(existsSync(join(agentsDir(), 'stella.md'))).toBe(false)
  expect((await readUser('vega'))).toMatchObject({ kind: 'agent', status: 'active', role: 'member' })
  expect((await readUser('stella'))).toMatchObject({ status: 'revoked' })
  expect(agentIdentity().id).toBe('nova')
})

it('refuses to boot after an interrupted replacement and completes it on a re-run', async () => {
  writeFileSync(join(agentsDir(), 'rigel.md'), '---\nname: Rigel\nrole: member\n---\nWatch.\n')
  await ensureAgentPrincipals()
  // What a run that died between writing the new file and removing the old one leaves behind.
  const fileText = agentFileText({ name: 'Rigel', role: 'member', instructions: 'Watch.\n' })
  writeReplaceIntent({ from: 'rigel', to: 'deneb', step: 'files', system: false, name: 'Rigel', role: 'member', fileText })
  writeFileSync(join(agentsDir(), 'deneb.md'), fileText)
  await expect(ensureAgentPrincipals()).rejects.toThrow(/replacement \(rigel -> deneb\) was interrupted/)
  await expect(replaceAgent({ from: 'rigel', to: 'other' })).rejects.toThrow(/was interrupted/)
  const result = await replaceAgent({ from: 'rigel', to: 'deneb' })
  expect(result.system).toBe(false)
  expect(existsSync(join(agentsDir(), 'rigel.md'))).toBe(false)
  expect(readReplaceIntent()).toBeNull()
  expect(await readUser('deneb')).toMatchObject({ kind: 'agent', status: 'active' })
  expect(await readUser('rigel')).toMatchObject({ status: 'revoked' })
})

it('moves the system principal to a new agent and retires the old one, keeping its history', async () => {
  mkdirSync(agentsDir(), { recursive: true })
  writeFileSync(join(agentsDir(), 'nova.md'), 'You are the team agent.\n')
  const result = await replaceAgent({ from: 'nova', to: 'astromon', name: 'Astromon' })
  expect(result.system).toBe(true)
  expect(agentIdentity()).toEqual({ id: 'astromon', name: 'Astromon', role: 'admin' })
  expect(JSON.parse(readFileSync(join(dir, 'config/agent-identity.lock.json'), 'utf8'))).toEqual({ id: 'astromon' })
  const box = JSON.parse(readFileSync(join(dir, 'box.json'), 'utf8'))
  expect(box.agentProfiles).toEqual({ astromon: { claude: 'a' } })
  expect(box.browsers.users).toEqual({ astromon: 'nova-browser' })
  expect(existsSync(join(agentsDir(), 'astromon.md'))).toBe(true)
  expect(existsSync(join(agentsDir(), 'nova.md'))).toBe(false)
  expect((await readUser('astromon'))).toMatchObject({ kind: 'agent', status: 'active', role: 'admin', nickname: 'Astromon' })
  expect((await readUser('nova'))).toMatchObject({ kind: 'agent', status: 'revoked' })
  expect(result.references).toEqual(['events.actor: 1'])
  // A boot afterwards is clean, and a last name set on the new agent survives it.
  await upsertUser({ id: 'astromon', last_name: 'AI' })
  await ensureAgentPrincipals()
  expect((await readUser('astromon'))).toMatchObject({ status: 'active', last_name: 'AI' })
})
