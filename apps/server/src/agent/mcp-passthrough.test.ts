import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Action } from '@silkweave/core'

vi.mock('@silkweave/box-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@silkweave/box-core')>()),
  authenticatePrincipal: async (token: string) => (token === 'ana-token' ? { id: 'ana', display: 'Ana', role: 'member', kind: 'human' } : null),
}))

const { filterMcpActions, passthroughOff, registerMcpActionSource } = await import('./mcp-passthrough.js')

const action = (name: string): Action => ({ name, description: name, input: {} as Action['input'], run: async () => ({}) })
const BOX = [action('comms-send'), action('crm-deals')]
const request = (over: Partial<{ url: string; method: string; toolName: string; headers: Record<string, string> }> = {}) => ({
  url: over.url ?? '/mcp',
  method: over.method ?? 'tools/list',
  ...(over.toolName ? { toolName: over.toolName } : {}),
  headers: over.headers ?? { authorization: 'Bearer ana-token' },
})

let off: (() => void) | null = null
afterEach(() => {
  off?.()
  off = null
})

describe('the /mcp passthrough hook', () => {
  it('is the Box actions unchanged without a source', async () => {
    expect(await filterMcpActions(BOX, request())).toBe(BOX)
  })

  it('adds the source actions for the authenticated person, dropping any that would shadow a Box tool', async () => {
    const seen: string[] = []
    off = registerMcpActionSource('test', async ({ principal, surface }) => {
      seen.push(`${principal.id}:${surface}`)
      return [action('stripe-stripe-api-read'), action('comms-send')]
    })
    const out = await filterMcpActions(BOX, request({ headers: { authorization: 'Bearer ana-token', 'x-box-surface': 'cli' } }))
    expect(out.map((a) => a.name)).toEqual(['comms-send', 'crm-deals', 'stripe-stripe-api-read'])
    expect(seen).toEqual(['ana:cli'])
  })

  it('never asks for initialize, a session (?passthrough=0), a Box tool call or an unknown token', async () => {
    let asked = 0
    off = registerMcpActionSource('test', async () => {
      asked++
      return [action('stripe-stripe-api-read')]
    })
    expect(await filterMcpActions(BOX, request({ method: 'initialize' }))).toBe(BOX)
    expect(await filterMcpActions(BOX, request({ url: '/mcp?passthrough=0' }))).toBe(BOX)
    expect(await filterMcpActions(BOX, request({ method: 'tools/call', toolName: 'CommsSend' }))).toBe(BOX)
    expect(await filterMcpActions(BOX, request({ headers: { authorization: 'Bearer nope' } }))).toBe(BOX)
    expect(asked).toBe(0)
    expect(passthroughOff('/mcp?passthrough=0')).toBe(true)
    expect(passthroughOff('/mcp')).toBe(false)
  })

  it('keeps the Box tools when the source fails', async () => {
    off = registerMcpActionSource('test', async () => {
      throw new Error('boom')
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await filterMcpActions(BOX, request())).toBe(BOX)
    spy.mockRestore()
  })
})
