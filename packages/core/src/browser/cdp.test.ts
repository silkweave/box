import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '../testing.js'
import { BROWSER_URL, browserTool, sweepStaleLeases } from './cdp.js'

let root: string
let calls: { url: string; headers: Record<string, string>; body: any }[]

function respond(handler: (name: string, args: any) => Response) {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    calls.push({ url, headers: init.headers as Record<string, string>, body })
    return handler(body.params.name, body.params.arguments)
  })
}

const toolResult = (value: unknown, isError = false) => ({
  jsonrpc: '2.0',
  id: 1,
  result: { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], ...(isError ? { isError: true } : {}) },
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'box-browser-'))
  setInstanceDir(root)
  writeFileSync(join(root, 'box.json'), JSON.stringify({ browsers: { url: 'http://127.0.0.1:8140' } }))
  calls = []
})
afterEach(() => {
  vi.unstubAllGlobals()
  resetInstanceDir()
  rmSync(root, { recursive: true, force: true })
})

test('an origin without a path resolves to the MCP endpoint', () => {
  expect(BROWSER_URL()).toBe('http://127.0.0.1:8140/mcp')
})

test('a plain JSON body yields the parsed tool result, statelessly and without auth on loopback', async () => {
  respond(() => Response.json(toolResult({ sessionId: 's1', cdpEndpoint: 'ws://x/devtools/session/s1' })))
  await expect(browserTool('open-session', { agent: 'alice' })).resolves.toEqual({ sessionId: 's1', cdpEndpoint: 'ws://x/devtools/session/s1' })
  expect(calls[0].url).toBe('http://127.0.0.1:8140/mcp')
  expect(calls[0].body).toMatchObject({ method: 'tools/call', params: { name: 'open-session', arguments: { agent: 'alice' } } })
  expect(calls[0].headers.Authorization).toBeUndefined()
})

test('an SSE body yields the response carried in its data lines', async () => {
  const sse = `event: message\ndata: ${JSON.stringify(toolResult({ closed: true }))}\n\n`
  respond(() => new Response(sse, { headers: { 'Content-Type': 'text/event-stream' } }))
  await expect(browserTool('close-session', { sessionId: 's1' })).resolves.toEqual({ closed: true })
})

test('isError and JSON-RPC errors throw with the tool message', async () => {
  respond(() => Response.json(toolResult('Unknown agent: bogus (create-agent first)', true)))
  await expect(browserTool('open-session', { agent: 'bogus' })).rejects.toThrow('Unknown agent: bogus (create-agent first)')
  respond(() => Response.json({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Unknown tool' } }))
  await expect(browserTool('nope')).rejects.toThrow('Unknown tool')
})

test('network mode sends the configured bearer token', async () => {
  writeFileSync(join(root, 'box.local.json'), JSON.stringify({ browsers: { token: 'secret' } }))
  respond(() => Response.json(toolResult({ sessions: [] })))
  await browserTool('list-sessions')
  expect(calls[0].headers.Authorization).toBe('Bearer secret')
})

test('the sweep closes only sessions this Box left behind', async () => {
  const now = Date.parse('2026-10-16T12:00:00Z')
  const ledger = [
    { sessionId: 'dead', identity: 'alice', pid: 999_999_999, openedAt: '2026-10-16T11:00:00Z' },
    { sessionId: 'live', identity: 'alice', pid: process.pid, openedAt: '2026-10-16T11:00:00Z' },
    { sessionId: 'kept-empty', identity: 'alice', pid: process.pid, openedAt: '2026-10-16T11:00:00Z', kept: true },
    { sessionId: 'kept-busy', identity: 'alice', pid: process.pid, openedAt: '2026-10-16T11:00:00Z', kept: true },
    { sessionId: 'kept-old', identity: 'alice', pid: process.pid, openedAt: '2026-10-14T11:00:00Z', kept: true },
    { sessionId: 'gone', identity: 'alice', pid: 999_999_999, openedAt: '2026-10-16T11:00:00Z' },
  ]
  writeFileSync(join(root, 'browser-leases.json'), JSON.stringify(ledger))
  const tab = [{ targetId: 't' }]
  respond((name) => {
    if (name === 'list-sessions') {
      return Response.json(toolResult({
        sessions: [
          { sessionId: 'dead', tabs: tab },
          { sessionId: 'live', tabs: tab },
          { sessionId: 'kept-empty', tabs: [] },
          { sessionId: 'kept-busy', tabs: tab },
          { sessionId: 'kept-old', tabs: tab },
          { sessionId: 'someone-else', tabs: tab },
        ],
      }))
    }
    return Response.json(toolResult({ closed: true }))
  })
  expect((await sweepStaleLeases(now)).sort()).toEqual(['dead', 'kept-empty', 'kept-old'])
  const closed = calls.filter((c) => c.body.params.name === 'close-session').map((c) => c.body.params.arguments.sessionId)
  expect(closed).not.toContain('someone-else')
  const left = JSON.parse(readFileSync(join(root, 'browser-leases.json'), 'utf8')).map((r: { sessionId: string }) => r.sessionId)
  expect(left.sort()).toEqual(['kept-busy', 'live'])
})
