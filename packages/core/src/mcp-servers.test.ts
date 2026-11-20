import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { setInstanceDir } from './testing.js'
import { mcpServerGrant, verifyMcpServerGrant } from './mcp-servers.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'box-mcp-grant-'))
  setInstanceDir(root)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

test('a server grant is bound to its principal and server', () => {
  const grant = mcpServerGrant('ana', 'stripe')
  expect(verifyMcpServerGrant(grant, 'ana', 'stripe')).toBe(true)
  expect(verifyMcpServerGrant(grant, 'ben', 'stripe')).toBe(false)
  expect(verifyMcpServerGrant(grant, 'ana', 'google')).toBe(false)
  expect(verifyMcpServerGrant(null, 'ana', 'stripe')).toBe(false)
  expect(verifyMcpServerGrant(`${grant}x`, 'ana', 'stripe')).toBe(false)
})
