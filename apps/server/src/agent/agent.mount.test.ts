import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Principal = { id: string; display: string; role: 'admin' | 'member' }
type Forwarded = { url: string; body: Record<string, unknown> }

const state = (() => {
  const principals = new Map<string, Principal>([
    ['alice-token', { id: 'alice', display: 'Alice', role: 'admin' }],
    ['bob-token', { id: 'bob', display: 'Bob', role: 'admin' }],
    ['member-token', { id: 'member', display: 'Member', role: 'member' }],
  ])
  const forwarded: Forwarded[] = []
  let holdNextResponse = false
  let releaseResponse: (() => void) | undefined

  const worker = {
    registry: { list: () => [], get: () => undefined },
    parking: { listInfo: async () => [] },
    server: {
      emit(event: string, ...args: unknown[]): boolean {
        if (event !== 'request') return false
        const req = args[0] as IncomingMessage
        const res = args[1] as ServerResponse
        void (async () => {
          let raw = ''
          for await (const chunk of req) raw += Buffer.from(chunk as Uint8Array).toString('utf8')
          forwarded.push({ url: req.url ?? '', body: JSON.parse(raw || '{}') as Record<string, unknown> })
          if (holdNextResponse) await new Promise<void>((resolve) => { releaseResponse = resolve })
          res.statusCode = 201
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
        })()
        return true
      },
    },
  }

  return {
    principals,
    forwarded,
    worker,
    setHold(value: boolean) {
      holdNextResponse = value
    },
    release() {
      const release = releaseResponse
      releaseResponse = undefined
      release?.()
    },
    reset() {
      forwarded.length = 0
      holdNextResponse = false
      releaseResponse = undefined
    },
  }
})()

vi.mock('@silkweave/box-core', () => ({
  AGENT_SESSION_APP: 'box-agent',
  SESSION_COOKIE: 'box_session',
  agentEnginesFor: () => ['claude', 'codex'],
  agentProfileFor: (user: string, engine: string) => `${user}:${engine}`,
  agentProfileMapFor: (user: string) => ({ claude: `${user}:claude`, codex: `${user}:codex` }),
  agentProfilesConfigured: () => true,
  agentSessionAccess: () => ({ kind: 'none' }),
  authenticatePrincipal: async (token: string) => state.principals.get(token) ?? null,
  parseCookies: (header: string | undefined) => {
    const cookies: Record<string, string> = {}
    for (const item of (header ?? '').split(';')) {
      const [key, ...value] = item.trim().split('=')
      if (key) cookies[key] = value.join('=')
    }
    return cookies
  },
  preferredAgentEngine: () => 'codex',
  repoRoot: () => '/box',
  resolvePrincipalById: async () => null,
  verifySession: () => null,
}))

vi.mock('@workerdeck/server', () => ({}))
vi.mock('./workerdeck.host.js', () => ({
  AGENT_AUTH: Symbol('agent-auth'),
  agentWorkerUrl: undefined,
  workerdeckHost: () => ({
    key: 'test-worker-key',
    url: 'http://127.0.0.1:1',
    worker: state.worker,
  }),
}))
vi.mock('./session-relay.js', () => ({ relayReadOnly: () => undefined }))

const { createAgentMount } = await import('./agent.mount.js')

type Response = { status: number; body: Record<string, unknown> }

const request = (server: Server, path: string, body: Record<string, unknown>, token = 'alice-token'): Promise<Response> =>
  new Promise((resolve, reject) => {
    const address = server.address()
    if (!address || typeof address === 'string') return reject(new Error('test server did not bind'))
    const payload = JSON.stringify(body)
    const req = fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: payload,
    })
    void req.then(async (res) => resolve({ status: res.status, body: await res.json() as Record<string, unknown> })).catch(reject)
  })

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('timed out waiting for forwarded request')
}

describe('agent mount Builder creation gate', () => {
  let server: Server

  beforeEach(async () => {
    state.reset()
    const mount = createAgentMount()
    expect(mount).toBeDefined()
    server = createServer((req, res) => mount!.middleware(req, res, (error) => {
      if (error) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: String(error) }))
        return
      }
      res.statusCode = 404
      res.end()
    }))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  })

  afterEach(async () => {
    state.release()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  })

  it('rejects the retired Builder workspace session shape', async () => {
    const result = await request(server, '/agent/v1/sessions', {
      builderWorkspaceId: 'alice-first',
      cwd: '/forged/worktree',
      profile: 'bob:claude',
      engine: 'claude',
      permissionMode: 'bypassPermissions',
      meta: { user: 'forged', kind: 'ordinary' },
    })

    expect(result.status).toBe(410)
    expect(result.body.error).toBe('builder_workspace_sessions_removed')
    expect(state.forwarded).toHaveLength(0)
  })

  it('rejects the retired Builder workspace shape for members too', async () => {
    const result = await request(server, '/agent/v1/sessions', { builderWorkspaceId: 'member-first' }, 'member-token')

    expect(result.status).toBe(410)
    expect(result.body.error).toBe('builder_workspace_sessions_removed')
    expect(state.forwarded).toHaveLength(0)
  })

  it('strips forged Builder metadata without an id and pins an ordinary session to the checkout', async () => {
    const result = await request(server, '/agent/v1/sessions', {
      cwd: '/forged/worktree',
      profile: 'bob:codex',
      engine: 'codex',
      meta: { kind: 'builder', builderWorkspaceId: 'alice-first', user: 'forged' },
    })

    expect(result.status).toBe(201)
    expect(state.forwarded[0]?.body).toEqual({
      cwd: '/box',
      meta: { user: 'alice', app: 'box-agent', display: 'Alice' },
      profile: 'alice:codex',
    })
  })

  it('rejects a workspace id even when supplied by another admin', async () => {
    const result = await request(server, '/agent/v1/sessions', { builderWorkspaceId: 'bob-first' })

    expect(result.status).toBe(410)
    expect(result.body.error).toBe('builder_workspace_sessions_removed')
    expect(state.forwarded).toHaveLength(0)
  })

  it('applies the retirement gate to a trailing slash', async () => {
    const result = await request(server, '/agent/v1/sessions/', {
      builderWorkspaceId: 'alice-slash',
      cwd: '/forged/worktree',
      engine: 'codex',
    })

    expect(result.status).toBe(410)
    expect(result.body.error).toBe('builder_workspace_sessions_removed')
    expect(state.forwarded).toHaveLength(0)
  })

  it('rejects a second create while the first request for the user is still starting', async () => {
    state.setHold(true)
    const first = request(server, '/agent/v1/sessions', { cwd: '/forged/worktree' })
    await waitUntil(() => state.forwarded.length === 1)

    const second = await request(server, '/agent/v1/sessions', { cwd: '/another/forged/worktree' })
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('agent_starting')
    expect(state.forwarded).toHaveLength(1)

    state.release()
    expect((await first).status).toBe(201)
  })
})
