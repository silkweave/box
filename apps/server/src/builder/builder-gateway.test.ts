import { createServer, type Server } from 'node:http'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILDER_ATTACHMENT_MAX_BYTES, createBuilderGateway, type BuilderGatewayMutate } from './builder-gateway.js'
import type { BuilderSupervisorAuthResult } from './builder-auth.js'
import { SupervisedApplication, type SupervisedChild } from './supervised-application.js'

type Principal = { id: string; display: string; role: 'admin' | 'member'; kind: 'human' | 'agent' }
type Current = { session: { id: string } | null }

const admin = (id: string): Principal => ({ id, display: id, role: 'admin', kind: 'human' })
const denied = { ok: false as const, state: 'denied' as const, reason: 'revoked' as const }

class RuntimeChild extends EventEmitter implements SupervisedChild {
  readonly pid: number
  constructor(pid: number) {
    super()
    this.pid = pid
  }
  spawn(): void { queueMicrotask(() => this.emit('spawn')) }
  exit(code: number | null = 0, signal: NodeJS.Signals | null = null): void { this.emit('exit', code, signal) }
  kill(): boolean { return true }
}

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('timed out waiting for scripted gateway frame')
}

describe('Builder gateway', () => {
  const roots: string[] = []
  const servers: Server[] = []
  const gateways: Array<ReturnType<typeof createBuilderGateway>> = []

  afterEach(async () => {
    for (const gateway of gateways.splice(0)) gateway.close()
    await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => server.close(() => resolve()))))
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  const setup = async (current: Current = { session: { id: 'session-1' } }, mutate?: BuilderGatewayMutate, profiles?: () => Promise<unknown[]>) => {
    const root = mkdtempSync(join(tmpdir(), 'builder-gateway-'))
    roots.push(root)
    writeFileSync(join(root, 'README.md'), 'readable\n')
    mkdirSync(join(root, 'data'), { recursive: true })
    writeFileSync(join(root, 'data', 'secret'), 'private\n')
    const calls: Array<{ path: string; method?: string; body?: string }> = []
    let verification: Principal | typeof denied = admin('alice')
    const auth = {
      authenticate: vi.fn(async (): Promise<BuilderSupervisorAuthResult> => 'ok' in verification ? verification : { ok: true as const, principal: verification, source: 'healthy' as const, expiresAt: Date.now() + 60_000 }),
    }
    const host = {
      url: 'http://127.0.0.1:1',
      key: 'test-key',
      request: vi.fn(async (path: string, init?: RequestInit) => {
        calls.push({ path, method: init?.method, body: typeof init?.body === 'string' ? init.body : undefined })
        if (path.startsWith('/v1/fs/roots')) return new Response(JSON.stringify({ roots: [{ path: root }, { path: join(root, 'data') }, { path: '/outside' }] }), { headers: { 'content-type': 'application/json' } })
        if (path.startsWith('/v1/fs/list')) return new Response(JSON.stringify({ entries: [{ path: join(root, 'README.md') }, { path: join(root, 'data', 'secret') }, { path: '/outside' }, { nope: true }] }), { headers: { 'content-type': 'application/json' } })
        return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
      }),
    }
    const gateway = createBuilderGateway({ root, host, auth, current: () => current, mutate, profiles })
    gateways.push(gateway)
    const server = createServer((req, res) => { void gateway.handle(req, res) })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('gateway test server did not bind')
    return {
      root,
      current,
      calls,
      auth,
      host,
      setVerification(value: Principal | typeof denied) { verification = value },
      url: `http://127.0.0.1:${address.port}`,
      wsUrl: `ws://127.0.0.1:${address.port}`,
    }
  }

  const fetchGateway = (url: string, path: string, init: RequestInit = {}) => fetch(`${url}/builder-agent${path}`, { ...init, headers: { cookie: 'alice-token', ...init.headers } })

  it('filters filesystem listings and lets every authenticated admin write', async () => {
    const test = await setup()
    const outside = mkdtempSync(join(tmpdir(), 'builder-gateway-outside-'))
    roots.push(outside)
    symlinkSync(outside, join(test.root, 'linked'))

    const rootsResponse = await fetchGateway(test.url, '/v1/fs/roots')
    expect(rootsResponse.status).toBe(200)
    expect(await rootsResponse.json()).toEqual({ roots: [{ path: test.root }], canWrite: true })

    const listResponse = await fetchGateway(test.url, `/v1/fs/list?path=${encodeURIComponent(test.root)}`)
    expect(listResponse.status).toBe(200)
    expect(await listResponse.json()).toEqual({ entries: [{ path: join(test.root, 'README.md') }] })

    for (const path of ['/v1/fs/read?path=../outside', `/v1/fs/read?path=${encodeURIComponent(join(test.root, 'linked', 'secret'))}`, `/v1/fs/read?path=${encodeURIComponent(join(test.root, 'box.local.json'))}`]) {
      const response = await fetchGateway(test.url, path)
      expect(response.status).toBe(403)
    }
    const malformed = await fetchGateway(test.url, '/v1/fs/write', { method: 'PUT', headers: { 'x-box-csrf': '1', 'content-type': 'application/json' }, body: '{' })
    expect(malformed.status).toBe(400)
    const collaborator = await setup({ session: { id: 'session-1' } })
    collaborator.setVerification(admin('bob'))
    const write = await fetchGateway(collaborator.url, '/v1/fs/write', { method: 'PUT', headers: { 'x-box-csrf': '1', 'content-type': 'application/json' }, body: JSON.stringify({ path: join(collaborator.root, 'README.md'), content: 'overwrite' }) })
    expect(write.status).toBe(200)
    expect(collaborator.calls).toHaveLength(1)
  })

  it('keeps the session route allowlist narrow', async () => {
    const test = await setup()
    const allowed = await fetchGateway(test.url, '/v1/sessions/session-1/files/output.txt')
    expect(allowed.status).toBe(200)
    const traversal = await fetchGateway(test.url, '/v1/sessions/session-1/files/%2e%2e/secret')
    expect(traversal.status).toBe(404)
    const events = await fetchGateway(test.url, '/v1/sessions/session-1/events/1/result?toolUseId=tool-1')
    expect(events.status).toBe(200)
    const providerRoute = await fetchGateway(test.url, '/v1/sessions/session-1/mcp')
    expect(providerRoute.status).toBe(404)
  })

  it('forwards current-session attachment uploads with their media type and caps their size', async () => {
    const test = await setup()
    const upload = await fetchGateway(test.url, '/v1/sessions/session-1/attachments?name=shot.png', { method: 'POST', headers: { 'x-box-csrf': '1', 'content-type': 'image/png' }, body: 'png-bytes' })
    expect(upload.status).toBe(200)
    const forwarded = test.host.request.mock.calls.at(-1)!
    expect(forwarded[0]).toBe('/v1/sessions/session-1/attachments?name=shot.png')
    expect(forwarded[1]).toMatchObject({ method: 'POST', headers: { 'content-type': 'image/png' } })
    expect(Buffer.from(forwarded[1]!.body as Uint8Array).toString()).toBe('png-bytes')
    const csrfMissing = await fetchGateway(test.url, '/v1/sessions/session-1/attachments', { method: 'POST', headers: { 'content-type': 'image/png' }, body: 'png' })
    expect(csrfMissing.status).toBe(403)
    const otherSession = await fetchGateway(test.url, '/v1/sessions/session-2/attachments', { method: 'POST', headers: { 'x-box-csrf': '1', 'content-type': 'image/png' }, body: 'png' })
    expect(otherSession.status).toBe(404)
    const listing = await fetchGateway(test.url, '/v1/sessions/session-1/attachments')
    expect(listing.status).toBe(404)
    const calls = test.host.request.mock.calls.length
    const tooLarge = await fetchGateway(test.url, '/v1/sessions/session-1/attachments', { method: 'POST', headers: { 'x-box-csrf': '1', 'content-type': 'image/png' }, body: Buffer.alloc(BUILDER_ATTACHMENT_MAX_BYTES + 1) })
    expect(tooLarge.status).toBe(413)
    expect(test.host.request.mock.calls.length).toBe(calls)
  })

  it('serves only sanitized current-session profile metadata from the explicit catalog hook', async () => {
    const test = await setup(undefined, undefined, async () => [
      { name: 'alice:codex', engine: 'codex', available: true, capabilities: { vfs: true }, secret: 'never' },
      { name: 'bob:claude', engine: 'claude', provider: { apiKey: 'never' } },
      { provider: { apiKey: 'never' } },
    ])
    const response = await fetchGateway(test.url, '/v1/profiles')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ profiles: [{ name: 'alice:codex', engine: 'codex', available: true, capabilities: { vfs: true } }, { name: 'bob:claude', engine: 'claude' }] })
    expect(test.calls).toHaveLength(0)
  })

  it('rechecks authentication for every filesystem write', async () => {
    const test = await setup()
    const csrfMissing = await fetchGateway(test.url, '/v1/fs/write', { method: 'PUT', body: JSON.stringify({ path: join(test.root, 'README.md') }) })
    expect(csrfMissing.status).toBe(403)
    test.setVerification(denied)
    const revoked = await fetchGateway(test.url, '/v1/fs/write', { method: 'PUT', headers: { 'x-box-csrf': '1', 'content-type': 'application/json' }, body: JSON.stringify({ path: join(test.root, 'README.md') }) })
    expect(revoked.status).toBe(403)
    expect(test.calls).toHaveLength(0)
  })

  it('rechecks the active session after body parsing inside the shared operation queue', async () => {
    const current: Current = { session: { id: 'session-1' } }
    const test = await setup(current, async operation => {
      current.session = null
      return await operation()
    })
    const response = await fetchGateway(test.url, '/v1/fs/write', { method: 'PUT', headers: { 'x-box-csrf': '1', 'content-type': 'application/json' }, body: JSON.stringify({ path: join(test.root, 'README.md') }) })
    expect(response.status).toBe(403)
    expect(test.calls).toHaveLength(0)
  })

  it('accepts commands from every authenticated admin and drops frames after access expires', async () => {
    const test = await setup({ session: { id: 'session-1' } })
    const upstream = new WebSocketServer({ port: 0 })
    await new Promise<void>((resolve) => upstream.once('listening', resolve))
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('upstream test server did not bind')
    const sharedGateway = gateways.pop()!
    sharedGateway.close()
    const commands: unknown[] = []
    let access = true
    const sharedAuth = {
      authenticate: vi.fn(async (cookie: string | undefined): Promise<BuilderSupervisorAuthResult> => access
        ? { ok: true, principal: admin(cookie?.includes('bob') ? 'bob' : 'alice'), source: 'healthy', expiresAt: Date.now() + 60_000 }
        : denied),
    }
    const shared = createBuilderGateway({
      root: test.root,
      host: { url: `http://127.0.0.1:${address.port}`, key: 'test-key', request: vi.fn() },
      auth: sharedAuth,
      command: async (_sessionId, frame) => {
        commands.push(frame)
        if (typeof frame === 'object' && frame !== null && (frame as { type?: unknown }).type === 'shell_command') throw new Error('Shell commands are disabled')
      },
      current: () => test.current,
    })
    gateways.push(shared)
    const server = servers.pop()!
    server.removeAllListeners('upgrade')
    server.on('upgrade', (req, socket, head) => { void shared.upgrade(req, socket, head) })
    const alice = new WebSocket(`${test.wsUrl}/builder-agent/v1/sessions/session-1/ws?afterSeq=0`, { headers: { cookie: 'alice-token' } })
    const bob = new WebSocket(`${test.wsUrl}/builder-agent/v1/sessions/session-1/ws?afterSeq=0`, { headers: { cookie: 'bob-token' } })
    await Promise.all([alice, bob].map(client => new Promise<void>((resolve, reject) => { client.once('open', () => resolve()); client.once('error', reject) })))
    alice.send(JSON.stringify({ type: 'user_message', text: 'alice can collaborate' }))
    bob.send(JSON.stringify({ type: 'user_message', text: 'bob can collaborate' }))
    await waitUntil(() => commands.length === 2)
    expect(commands).toEqual(expect.arrayContaining([{ type: 'user_message', text: 'alice can collaborate' }, { type: 'user_message', text: 'bob can collaborate' }]))
    access = false
    bob.send(JSON.stringify({ type: 'message', text: 'revoked' }))
    await new Promise<void>((resolve) => setTimeout(resolve, 30))
    expect(commands).toHaveLength(2)
    access = true
    bob.send(JSON.stringify({ type: 'user_message', text: 'dispatch me' }))
    await waitUntil(() => commands.length === 3)
    expect(commands.at(-1)).toEqual({ type: 'user_message', text: 'dispatch me' })
    const protocolErrors: string[] = []
    bob.on('message', data => {
      try {
        const frame = JSON.parse(data.toString()) as { type?: string; message?: string }
        if (frame.type === 'protocol_error') protocolErrors.push(frame.message ?? '')
      } catch { /* transcript frames are not protocol errors */ }
    })
    bob.send(JSON.stringify({ type: 'shell_command', command: 'cat secrets' }))
    await new Promise<void>((resolve) => setTimeout(resolve, 30))
    expect(protocolErrors).toContain('Builder command shell_command is unavailable')
    alice.close()
    bob.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  })

  it('keeps one public transcript socket alive through a failed app and supervised restart', async () => {
    const test = await setup()
    const upstream = new WebSocketServer({ port: 0 })
    await new Promise<void>((resolve) => upstream.once('listening', resolve))
    const address = upstream.address()
    if (!address || typeof address === 'string') throw new Error('upstream test server did not bind')
    const upstreamSockets: WebSocket[] = []
    upstream.on('connection', socket => upstreamSockets.push(socket))

    const children: RuntimeChild[] = []
    const app = new SupervisedApplication({
      repoRoot: '/box', internalPort: 8191, vitePort: 5191, readinessPollMs: 1,
      probe: async () => true,
      spawn: () => {
        const child = new RuntimeChild(5000 + children.length)
        children.push(child)
        child.spawn()
        return child
      },
      killProcessGroup: () => children.at(-1)?.exit(0, 'SIGTERM'),
    })
    await expect(app.start()).resolves.toMatchObject({ status: 'running' })

    const oldGateway = gateways.pop()!
    oldGateway.close()
    const commands: unknown[] = []
    const gateway = createBuilderGateway({
      root: test.root,
      host: { url: `http://127.0.0.1:${address.port}`, key: 'test-key', request: vi.fn() },
      auth: test.auth,
      command: async (_sessionId, frame) => { commands.push(frame) },
      current: () => test.current,
    })
    gateways.push(gateway)
    const server = servers.pop()!
    server.removeAllListeners('upgrade')
    server.on('upgrade', (req, socket, head) => { void gateway.upgrade(req, socket, head) })
    const client = new WebSocket(`${test.wsUrl}/builder-agent/v1/sessions/session-1/ws?afterSeq=0`, { headers: { cookie: 'alice-token' } })
    const transcript: string[] = []
    client.on('message', data => transcript.push(data.toString()))
    await new Promise<void>((resolve, reject) => { client.once('open', () => resolve()); client.once('error', reject) })
    await waitUntil(() => upstreamSockets.length === 1)
    const upstreamSocket = upstreamSockets[0]!

    upstreamSocket.send(JSON.stringify({ type: 'event', event: { kind: 'before-restart' } }))
    await waitUntil(() => transcript.length === 1)
    children[0]!.exit(1, null)
    expect(app.status.status).toBe('failed')
    upstreamSocket.send(JSON.stringify({ type: 'event', event: { kind: 'during-failure' } }))
    await waitUntil(() => transcript.length === 2)
    await expect(app.restart()).resolves.toMatchObject({ status: 'running' })
    upstreamSocket.send(JSON.stringify({ type: 'event', event: { kind: 'after-restart' } }))
    await waitUntil(() => transcript.length === 3)
    expect(upstreamSockets).toHaveLength(1)

    client.send(JSON.stringify({ type: 'user_message', text: 'admin can build' }))
    await waitUntil(() => commands.length === 1)
    expect(commands).toEqual([{ type: 'user_message', text: 'admin can build' }])

    client.close()
    await app.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
  })
})
