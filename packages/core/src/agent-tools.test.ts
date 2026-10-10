import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setInstanceDir, resetInstanceDir } from './testing.js'
import {
  agentToolset,
  deleteAgentMcpServer,
  deleteAgentToolset,
  readAgentTools,
  saveAgentMcpServer,
  saveAgentToolset,
  toolsetProblem,
  toolsetSessionOptions,
} from './agent-tools.js'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'box-agent-tools-'))
  setInstanceDir(root)
  writeFileSync(
    join(root, 'box.json'),
    JSON.stringify({
      agentMcp: {
        servers: { google: { url: 'http://127.0.0.1:8300/mcp', label: 'Google' }, stripe: { url: 'https://mcp.stripe.com', type: 'sse' } },
        toolsets: {
          team: { label: 'Team chat', servers: ['google'], allow: ['mcp__google__GmailRead'], deny: ['mcp__google__DraftDelete'] },
          external: { servers: [], deny: ['Bash', 'mcp__box'] },
          broken: { servers: ['nope'] },
        },
      },
    }),
  )
  writeFileSync(join(root, 'box.local.json'), JSON.stringify({ agentMcp: { servers: { google: { token: 'swd_secret' } } } }))
})
afterEach(() => {
  resetInstanceDir()
  rmSync(root, { recursive: true, force: true })
})

describe('reading', () => {
  it('lists servers without their tokens, and skips what does not parse with the reason', () => {
    const settings = readAgentTools()
    expect(settings.servers).toEqual([
      { id: 'google', url: 'http://127.0.0.1:8300/mcp', type: 'http', label: 'Google', hasToken: true },
      { id: 'stripe', url: 'https://mcp.stripe.com', type: 'sse', label: 'stripe', hasToken: false },
    ])
    expect(JSON.stringify(settings)).not.toContain('swd_secret')
    expect(settings.toolsets.map((t) => t.id)).toEqual(['external', 'team'])
    expect(settings.problems).toEqual(['toolset "broken": no server "nope"'])
  })

  it('reports why a toolset id cannot be used; none is always fine', () => {
    expect(toolsetProblem(null)).toBeNull()
    expect(toolsetProblem('team')).toBeNull()
    expect(toolsetProblem('broken')).toBe('toolset "broken": no server "nope"')
    expect(toolsetProblem('missing')).toMatch(/no toolset "missing"/)
  })
})

describe('session options', () => {
  it('attaches the servers with their tokens and carries allow and deny', () => {
    expect(toolsetSessionOptions('team')).toEqual({
      mcpServers: { google: { type: 'http', url: 'http://127.0.0.1:8300/mcp', headers: { Authorization: 'Bearer swd_secret' } } },
      allowedTools: ['mcp__google__GmailRead'],
      disallowedTools: ['mcp__google__DraftDelete'],
    })
  })

  it('can take built-ins and the Box server away', () => {
    expect(toolsetSessionOptions('external')).toEqual({ mcpServers: {}, allowedTools: [], disallowedTools: ['Bash', 'mcp__box'] })
  })

  it('refuses an unknown toolset', () => {
    expect(() => toolsetSessionOptions('missing')).toThrow(/no toolset "missing"/)
  })
})

describe('writing', () => {
  it('refuses a toolset that names an unknown server, a tool of an unattached server, or allows a built-in', () => {
    expect(() => saveAgentToolset({ id: 'x', servers: ['nope'] })).toThrow(/no server "nope"/)
    expect(() => saveAgentToolset({ id: 'x', servers: ['google'], allow: ['mcp__stripe__Charges'] })).toThrow(/does not attach/)
    expect(() => saveAgentToolset({ id: 'x', servers: ['google'], allow: ['Bash'] })).toThrow(/built-in/)
    expect(() => saveAgentToolset({ id: 'Bad Id' })).toThrow(/lowercase slug/)
    expect(readFileSync(join(root, 'box.local.json'), 'utf8')).not.toContain('"x"')
  })

  it('saves and removes a toolset in box.local.json', () => {
    saveAgentToolset({ id: 'crm', label: 'CRM sync', servers: ['google', 'stripe'], allow: ['mcp__stripe'] })
    expect(agentToolset('crm')).toMatchObject({ label: 'CRM sync', servers: ['google', 'stripe'], allow: ['mcp__stripe'], deny: [] })
    deleteAgentToolset('crm')
    expect(agentToolset('crm')).toBeNull()
    deleteAgentToolset('team')
    expect(agentToolset('team')).toBeNull()
  })

  it('keeps a server token across a save, and refuses to delete a server a toolset attaches', () => {
    saveAgentMcpServer({ id: 'google', url: 'http://127.0.0.1:8301/mcp', label: 'Workspace' })
    expect(toolsetSessionOptions('team').mcpServers.google).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:8301/mcp',
      headers: { Authorization: 'Bearer swd_secret' },
    })
    expect(() => saveAgentMcpServer({ id: 'box', url: 'http://x' })).toThrow(/Box's own server/)
    expect(() => deleteAgentMcpServer('google')).toThrow(/attached by toolset "team"/)
    deleteAgentMcpServer('stripe')
    expect(readAgentTools().servers.map((s) => s.id)).toEqual(['google'])
  })
})
