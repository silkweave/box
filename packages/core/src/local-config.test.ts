import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { setInstanceDir, resetInstanceDir } from './testing.js'
import { authSecret } from './auth/secrets.js'
import { credential, writeCredentials } from './credentials.js'
import { boxJson } from './box-config.js'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'box-local-')); setInstanceDir(root) })
afterEach(() => { resetInstanceDir(); rmSync(root, { recursive: true, force: true }) })

test('generated keys persist locally without changing shared configuration or unrelated overrides', () => {
  const shared = JSON.stringify({ server: { port: 8198 } })
  writeFileSync(join(root, 'box.json'), shared)
  writeFileSync(join(root, 'box.local.json'), JSON.stringify({ server: { vitePort: 5198 } }))
  const session = authSecret('AUTH_SESSION_SECRET')
  const token = authSecret('AUTH_TOKEN_SECRET')
  expect(session).not.toBe(token)
  expect(authSecret('AUTH_SESSION_SECRET')).toBe(session)
  expect(readFileSync(join(root, 'box.json'), 'utf8')).toBe(shared)
  expect(boxJson().server).toMatchObject({ port: 8198, vitePort: 5198 })
  expect(statSync(join(root, 'box.local.json')).mode & 0o777).toBe(0o600)
})

test('credential rotation overrides only its own keys and preserves channel defaults and other settings', () => {
  writeFileSync(join(root, 'box.json'), JSON.stringify({ credentials: { example: { '*': { CLIENT_ID: 'shared' }, alice: { TOKEN: 'old', KEEP: 'yes' } } } }))
  writeFileSync(join(root, 'box.local.json'), JSON.stringify({ mcp: { url: 'http://localhost:8199/mcp' }, credentials: { other: { bob: { TOKEN: 'other' } } } }))
  writeCredentials('example', 'alice', { TOKEN: 'new' })
  expect(credential('example', 'alice', 'TOKEN')).toBe('new')
  expect(credential('example', 'alice', 'CLIENT_ID')).toBe('shared')
  expect(credential('example', 'alice', 'KEEP')).toBe('yes')
  expect(credential('other', 'bob', 'TOKEN')).toBe('other')
  expect(boxJson().mcp.url).toBe('http://localhost:8199/mcp')
})

test('unsafe explicit signing keys fail instead of being silently regenerated', () => {
  writeFileSync(join(root, 'box.local.json'), JSON.stringify({ auth: { sessionSecret: 'CHANGE_ME' } }))
  expect(() => authSecret('AUTH_SESSION_SECRET')).toThrow(/non-placeholder secret/)
})
