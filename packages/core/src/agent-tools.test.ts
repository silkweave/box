import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setInstanceDir, resetInstanceDir } from './testing.js'
import {
  agentToolset,
  deleteAgentToolset,
  readAgentTools,
  registerBuiltinToolset,
  saveAgentToolset,
  toolsetProblem,
  toolsetSessionOptions,
  toolsetsAttaching,
} from './agent-tools.js'
import { registerMcpConnections } from './mcp-connections.js'

let root: string
let unregister: (() => void) | null = null
const directory = (ids: string[]) =>
  registerMcpConnections('test', {
    list: () => ids.map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) })),
    sessionProblem: async () => null,
    personal: async () => [],
    serve: async () => {},
  })
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'box-agent-tools-'))
  setInstanceDir(root)
  unregister = directory(['google', 'stripe'])
  writeFileSync(
    join(root, 'box.json'),
    JSON.stringify({
      agentMcp: {
        toolsets: {
          team: { label: 'Team chat', servers: ['google'], allow: ['mcp__google__GmailRead'], deny: ['mcp__google__DraftDelete'] },
          external: { servers: [], deny: ['Bash', 'mcp__box'] },
          broken: { servers: ['nope'] },
        },
      },
    }),
  )
})
afterEach(() => {
  unregister?.()
  unregister = null
  resetInstanceDir()
  rmSync(root, { recursive: true, force: true })
})

describe('reading', () => {
  it('lists the connections a toolset can attach, and skips what does not parse with the reason', () => {
    const settings = readAgentTools()
    expect(settings.connections).toEqual([{ id: 'google', label: 'Google' }, { id: 'stripe', label: 'Stripe' }])
    expect(settings.connectionsAvailable).toBe(true)
    expect(settings.toolsets.map((t) => t.id)).toEqual(['external', 'team'])
    expect(settings.problems).toEqual(['toolset "broken": no connection "nope" (Settings > Connections)'])
  })

  it('without a connection directory, toolsets naming a server are skipped and say why', () => {
    unregister?.()
    unregister = null
    const settings = readAgentTools()
    expect(settings.connectionsAvailable).toBe(false)
    expect(settings.connections).toEqual([])
    expect(settings.toolsets.map((t) => t.id)).toEqual(['external'])
    expect(settings.problems).toContain('toolset "team": no connection "google" (Settings > Connections)')
  })

  it('reports a leftover agentMcp.servers instead of reading it', () => {
    writeFileSync(join(root, 'box.local.json'), JSON.stringify({ agentMcp: { servers: { google: { url: 'http://127.0.0.1:8300/mcp', token: 'swd_secret' } } } }))
    const settings = readAgentTools()
    expect(settings.problems.some((p) => p.startsWith('agentMcp.servers is not read'))).toBe(true)
    expect(JSON.stringify(settings)).not.toContain('swd_secret')
  })

  it('reports why a toolset id cannot be used; none is always fine', () => {
    expect(toolsetProblem(null)).toBeNull()
    expect(toolsetProblem('team')).toBeNull()
    expect(toolsetProblem('broken')).toBe('toolset "broken": no connection "nope" (Settings > Connections)')
    expect(toolsetProblem('missing')).toMatch(/no toolset "missing"/)
  })
})

describe('session options', () => {
  it('names the connections and carries allow and deny, never a credential', () => {
    expect(toolsetSessionOptions('team')).toEqual({
      servers: ['google'],
      allowedTools: ['mcp__google__GmailRead'],
      disallowedTools: ['mcp__google__DraftDelete'],
      boxTools: null,
    })
  })

  it('can take built-ins and the Box server away', () => {
    expect(toolsetSessionOptions('external')).toEqual({ servers: [], allowedTools: [], disallowedTools: ['Bash', 'mcp__box'], boxTools: null })
  })

  it('a built-in toolset keeps only its Box tools, cannot be edited or shadowed', () => {
    registerBuiltinToolset({ id: 'drafting', label: 'Drafting', description: '', boxTools: ['notes-draft', 'notes-thread'], deny: ['Bash'] })
    expect(agentToolset('drafting')).toMatchObject({ builtIn: true, servers: [], deny: ['Bash'], boxTools: ['notes-draft', 'notes-thread'] })
    expect(toolsetSessionOptions('drafting')).toEqual({ servers: [], allowedTools: [], disallowedTools: ['Bash'], boxTools: ['NotesDraft', 'NotesThread'] })
    expect(() => saveAgentToolset({ id: 'drafting', servers: [] })).toThrow(/built in/)
    expect(() => deleteAgentToolset('drafting')).toThrow(/built in/)
  })

  it('refuses an unknown toolset', () => {
    expect(() => toolsetSessionOptions('missing')).toThrow(/no toolset "missing"/)
  })
})

describe('writing', () => {
  it('refuses a toolset that names an unknown connection, a tool of an unattached one, or allows a built-in', () => {
    expect(() => saveAgentToolset({ id: 'x', servers: ['nope'] })).toThrow(/no connection "nope"/)
    expect(() => saveAgentToolset({ id: 'x', servers: ['google'], allow: ['mcp__stripe__stripe_api_read'] })).toThrow(/does not attach/)
    expect(() => saveAgentToolset({ id: 'x', servers: ['google'], allow: ['Bash'] })).toThrow(/built-in/)
    expect(() => saveAgentToolset({ id: 'Bad Id' })).toThrow(/lowercase slug/)
    expect(existsSync(join(root, 'box.local.json'))).toBe(false)
  })

  it('saves and removes a toolset in box.local.json', () => {
    saveAgentToolset({ id: 'crm', label: 'CRM sync', servers: ['google', 'stripe'], allow: ['mcp__stripe__stripe_api_read'] })
    expect(agentToolset('crm')).toMatchObject({ label: 'CRM sync', servers: ['google', 'stripe'], allow: ['mcp__stripe__stripe_api_read'], deny: [] })
    expect(readFileSync(join(root, 'box.local.json'), 'utf8')).toContain('"crm"')
    expect(toolsetsAttaching('stripe')).toEqual(['crm'])
    deleteAgentToolset('crm')
    expect(agentToolset('crm')).toBeNull()
    deleteAgentToolset('team')
    expect(agentToolset('team')).toBeNull()
  })
})
