import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '@silkweave/core'

const PEOPLE: Record<string, { id: string; display: string; role: string; kind: 'human' }> = {
  'ana-token': { id: 'ana', display: 'Ana', role: 'member', kind: 'human' },
  'sam-token': { id: 'sam', display: 'Sam', role: 'sales', kind: 'human' },
  'boss-token': { id: 'boss', display: 'Boss', role: 'admin', kind: 'human' },
}

vi.mock('@silkweave/box-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@silkweave/box-core')>()),
  authenticatePrincipal: async (token: string) => PEOPLE[token] ?? null,
  // `sales`: crm read, nothing else (mcp none).
  accessOf: async (p: { role: string }) => p.role === 'sales'
    ? { role: 'sales', areas: new Map([['crm', 'read']]), fallback: 'none', admin: false, revision: 1 }
    : { role: p.role, areas: new Map(), fallback: 'write', admin: p.role === 'admin', revision: 1 },
}))

const { filterMcpActions, passthroughOff, registerMcpActionSource } = await import('./mcp-passthrough.js')
const { installHandlerPolicies } = await import('../auth/handler-map.js')
type Policy = import('../auth/handler-map.js').HandlerPolicy

const action = (name: string): Action => ({ name, description: name, input: {} as Action['input'], run: async () => ({}) })
const BOX = [action('notes-send'), action('crm-deals'), action('crm-deal-upsert'), action('user-delete'), action('unmapped-tool')]
const POLICIES: Policy[] = [
  { key: 'Notes.send', owner: 'notes', category: { kind: 'area', area: 'notes' }, read: false, admin: false, mcp: 'notes-send' },
  { key: 'Crm.deals', owner: 'crm', category: { kind: 'area', area: 'crm' }, read: true, admin: false, mcp: 'crm-deals' },
  { key: 'Crm.dealUpsert', owner: 'crm', category: { kind: 'area', area: 'crm' }, read: false, admin: false, mcp: 'crm-deal-upsert' },
  { key: 'Users.delete', owner: 'core', category: { kind: 'admin' }, read: false, admin: true, mcp: 'user-delete' },
]
const request = (over: Partial<{ url: string; method: string; toolName: string; headers: Record<string, string> }> = {}) => ({
  url: over.url ?? '/mcp',
  method: over.method ?? 'tools/list',
  ...(over.toolName ? { toolName: over.toolName } : {}),
  headers: over.headers ?? { authorization: 'Bearer ana-token' },
})
const names = (actions: Action[]) => actions.map((a) => a.name)
const as = (token: string, over: Parameters<typeof request>[0] = {}) => request({ ...over, headers: { authorization: `Bearer ${token}`, ...over.headers } })

let off: (() => void) | null = null
beforeEach(() => installHandlerPolicies(new Map(POLICIES.map((p) => [function handler() {}, p]))))
afterEach(() => {
  off?.()
  off = null
  installHandlerPolicies(null)
})

describe('the Box tools on /mcp', () => {
  it('lists what the role reaches: member everything but admin tools, admin all, never an unmapped tool', async () => {
    expect(names(await filterMcpActions(BOX, as('ana-token')))).toEqual(['notes-send', 'crm-deals', 'crm-deal-upsert'])
    expect(names(await filterMcpActions(BOX, as('boss-token')))).toEqual(['notes-send', 'crm-deals', 'crm-deal-upsert', 'user-delete'])
  })

  it('a read role lists only the read tools of its areas, on list and call alike', async () => {
    expect(names(await filterMcpActions(BOX, as('sam-token')))).toEqual(['crm-deals'])
    expect(names(await filterMcpActions(BOX, as('sam-token', { method: 'tools/call', toolName: 'CrmDealUpsert' })))).toEqual(['crm-deals'])
  })

  it('filters with no source, with ?passthrough=0, and gives a missing or invalid bearer nothing', async () => {
    expect(names(await filterMcpActions(BOX, as('sam-token', { url: '/mcp?passthrough=0' })))).toEqual(['crm-deals'])
    expect(await filterMcpActions(BOX, request({ headers: {} }))).toEqual([])
    expect(await filterMcpActions(BOX, request({ headers: { authorization: 'Bearer nope' } }))).toEqual([])
  })

  it('leaves initialize and ping alone (they list no tools)', async () => {
    expect(await filterMcpActions(BOX, request({ method: 'initialize', headers: {} }))).toBe(BOX)
  })
})

describe('the passthrough hook', () => {
  it('adds the source actions for the authenticated person, dropping any that would shadow a Box tool, listed or not', async () => {
    const seen: string[] = []
    off = registerMcpActionSource('test', async ({ principal, surface }) => {
      seen.push(`${principal.id}:${surface}`)
      return [action('stripe-stripe-api-read'), action('notes-send'), action('user-delete')]
    })
    const out = await filterMcpActions(BOX, request({ headers: { authorization: 'Bearer ana-token', 'x-box-surface': 'cli' } }))
    expect(names(out)).toEqual(['notes-send', 'crm-deals', 'crm-deal-upsert', 'stripe-stripe-api-read'])
    expect(seen).toEqual(['ana:cli'])
  })

  it('never asks for initialize, a session (?passthrough=0), a Box tool call, an unknown token or a role without mcp', async () => {
    let asked = 0
    off = registerMcpActionSource('test', async () => {
      asked++
      return [action('stripe-stripe-api-read')]
    })
    await filterMcpActions(BOX, request({ method: 'initialize' }))
    await filterMcpActions(BOX, request({ url: '/mcp?passthrough=0' }))
    await filterMcpActions(BOX, request({ method: 'tools/call', toolName: 'NotesSend' }))
    await filterMcpActions(BOX, request({ headers: { authorization: 'Bearer nope' } }))
    expect(names(await filterMcpActions(BOX, as('sam-token')))).toEqual(['crm-deals'])
    expect(asked).toBe(0)
    expect(passthroughOff('/mcp?passthrough=0')).toBe(true)
    expect(passthroughOff('/mcp')).toBe(false)
  })

  it('keeps the Box tools when the source fails', async () => {
    off = registerMcpActionSource('test', async () => {
      throw new Error('boom')
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(names(await filterMcpActions(BOX, request()))).toEqual(['notes-send', 'crm-deals', 'crm-deal-upsert'])
    spy.mockRestore()
  })
})
