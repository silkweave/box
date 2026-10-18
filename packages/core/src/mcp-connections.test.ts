import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { setInstanceDir } from './testing.js'
import { mcpConnectionGrant, verifyMcpConnectionGrant } from './mcp-connections.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'box-mcp-grant-'))
  setInstanceDir(root)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

test('a connection grant is bound to its principal and connection', () => {
  const grant = mcpConnectionGrant('ana', 'stripe')
  expect(verifyMcpConnectionGrant(grant, 'ana', 'stripe')).toBe(true)
  expect(verifyMcpConnectionGrant(grant, 'ben', 'stripe')).toBe(false)
  expect(verifyMcpConnectionGrant(grant, 'ana', 'google')).toBe(false)
  expect(verifyMcpConnectionGrant(null, 'ana', 'stripe')).toBe(false)
  expect(verifyMcpConnectionGrant(`${grant}x`, 'ana', 'stripe')).toBe(false)
})
