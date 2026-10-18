import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { agentIdentity, boxJson, clearMaintenanceOverride, ensureBoxConfig, setMaintenanceOverride, systemUserId } from './box-config.js'
import { configRoot } from './io.js'
import { resetInstanceDir, setInstanceDir } from './testing.js'

let dir: string
beforeEach(() => { dir = mkdtempSync('/tmp/box-identity-'); setInstanceDir(dir); clearMaintenanceOverride() })
afterEach(() => { clearMaintenanceOverride(); resetInstanceDir(); rmSync(dir, { recursive: true, force: true }) })
const write = (value: unknown) => writeFileSync(join(dir, 'box.json'), JSON.stringify(value))
test('ensureBoxConfig writes root defaults and binds identity', () => {
  ensureBoxConfig()
  expect(boxJson().agent).toEqual({ id: 'nova', name: 'Nova', role: 'admin' })
  expect(existsSync(join(dir, 'config', 'agent-identity.lock.json'))).toBe(true)
  expect(readFileSync(join(dir, 'box.json'), 'utf8')).toContain('"$schema": "./packages/core/box.schema.json"')
})
test('identity ID is locked while name and role remain editable', () => {
  ensureBoxConfig(); write({ agent: { id: 'nova', name: 'Renamed', role: 'member' } })
  expect(agentIdentity()).toEqual({ id: 'nova', name: 'Renamed', role: 'member' })
  write({ agent: { id: 'other', name: 'Other', role: 'admin' } })
  expect(agentIdentity).toThrow(/renaming an existing agent/)
  expect(systemUserId).toThrow(/renaming an existing agent/)
})
test('identity checks stay focused on agent while full reads validate settings', () => {
  ensureBoxConfig(); write({ agent: { id: 'nova', name: 'Nova', role: 'admin' }, server: { port: 'bad' } })
  expect(agentIdentity().id).toBe('nova'); expect(boxJson).toThrow(/port must be a port number/)
})
test('setInstanceDir redirects configRoot and ignores environment paths', () => {
  process.env.BOX_DATA_DIR = '/invalid'
  try { expect(configRoot()).toBe(dir); expect(boxJson().agent.id).toBe('nova') } finally { delete process.env.BOX_DATA_DIR }
})
test('maintenance override disables background work without changing configuration', () => {
  write({ background: { automation: true, chatAgent: true, relay: true, whatsapp: true } })
  setMaintenanceOverride(true)
  expect(boxJson().background).toEqual({ automation: false, chatAgent: false, relay: false, whatsapp: false })
  clearMaintenanceOverride()
  expect(boxJson().background).toEqual({ automation: true, chatAgent: true, relay: true, whatsapp: true })
  expect(readFileSync(join(dir, 'box.json'), 'utf8')).toContain('"automation":true')
})
