import { createServer, type Server } from 'node:http'
import { WebSocket } from 'ws'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBuilderBrowser } from './builder-browser.js'
import type { BuilderSupervisorAuthResult } from './builder-auth.js'

type Principal = { id: string; display: string; role: 'admin' | 'member'; kind: 'human' | 'agent' }
type Current = { session: { id: string } | null }
type Message = Record<string, unknown>

const admin = (id: string): Principal => ({ id, display: id, role: 'admin', kind: 'human' })
const denied: BuilderSupervisorAuthResult = { ok: false, state: 'denied', reason: 'revoked' }

const nextMessage = (socket: WebSocket, predicate: (message: Message) => boolean): Promise<Message> => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { socket.off('message', onMessage); reject(new Error('Timed out waiting for browser message')) }, 1_000)
  const onMessage = (data: Buffer): void => {
    let message: unknown
    try { message = JSON.parse(data.toString()) } catch { return }
    if (!message || typeof message !== 'object' || Array.isArray(message) || !predicate(message as Message)) return
    clearTimeout(timeout)
    socket.off('message', onMessage)
    resolve(message as Message)
  }
  socket.on('message', onMessage)
})

const open = (url: string, origin: string, cookie = 'sid=1'): Promise<WebSocket> => new Promise((resolve, reject) => {
  const socket = new WebSocket(url, { headers: { origin, cookie } })
  let settled = false
  socket.on('error', error => { if (!settled) { settled = true; reject(error) } })
  const onInitial = (data: Buffer): void => {
    let message: unknown
    try { message = JSON.parse(data.toString()) } catch { return }
    if (!message || typeof message !== 'object' || (message as Message).type !== 'state') return
    settled = true
    socket.off('message', onInitial)
    resolve(socket)
  }
  socket.on('message', onInitial)
})

const waitForHandshakeFailure = (socket: WebSocket): Promise<void> => new Promise(resolve => {
  let done = false
  const finish = (): void => {
    if (done) return
    done = true
    resolve()
  }
  socket.on('error', finish)
  socket.on('close', finish)
})

const closeSocket = (socket: WebSocket): Promise<void> => new Promise(resolve => {
  if (socket.readyState === WebSocket.CLOSED) { resolve(); return }
  const finish = (): void => { socket.off('close', finish); resolve() }
  socket.on('close', finish)
  socket.on('error', () => {})
  socket.close()
})

describe('Builder browser broker', () => {
  const brokers: Array<ReturnType<typeof createBuilderBrowser>> = []
  const servers: Server[] = []
  const sockets: WebSocket[] = []

  afterEach(async () => {
    for (const broker of brokers.splice(0)) broker.close()
    await Promise.all(sockets.splice(0).map(closeSocket))
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  })

  async function setup(initial: Current = { session: { id: 'session-1' } }, timing = { commandMs: 500, grantMs: 1_000, heartbeatMs: 50, pollMs: 50 }) {
    let current = initial
    let identity: Principal = admin('alice')
    let allowed = true
    const auth = {
      authenticate: vi.fn(async (cookie: string | undefined): Promise<BuilderSupervisorAuthResult> => allowed ? { ok: true, principal: cookie?.includes('bob') ? admin('bob') : identity, source: 'healthy', expiresAt: Date.now() + 60_000 } : denied),
    }
    const broker = createBuilderBrowser({ auth, current: () => current, timings: timing })
    brokers.push(broker)
    const server = createServer()
    server.on('upgrade', (req, socket, head) => { void broker.upgrade(req, socket, head) })
    servers.push(server)
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test server did not bind')
    const origin = `http://127.0.0.1:${address.port}`
    const url = `${origin}/builder-browser`
    return {
      broker,
      auth,
      url,
      origin,
      sockets,
      setCurrent(value: Current) { current = value },
      setIdentity(value: Principal) { identity = value },
      setAllowed(value: boolean) { allowed = value },
      connect: async (cookie?: string) => { const socket = await open(url, origin, cookie); sockets.push(socket); return socket },
    }
  }

  async function ready(socket: WebSocket, generation = 'generation-1', path = '/home'): Promise<Message> {
    socket.send(JSON.stringify({ type: 'ready', generation, path }))
    return nextMessage(socket, message => message.type === 'state' && Array.isArray((message.state as Message).tabs) && ((message.state as Message).tabs as Message[]).some(tab => tab.generation === generation))
  }

  it('selects the first ready Preview and completes a validated browser command', async () => {
    const { broker, connect } = await setup()
    const socket = await connect()
    await ready(socket)
    const commandPromise = broker.execute('session-1', { op: 'snapshot' })
    const command = await nextMessage(socket, message => message.type === 'command')
    const browserGrant = command.grant as Message
    const settledPromise = nextMessage(socket, message => message.type === 'settled')
    socket.send(JSON.stringify({ type: 'result', id: command.id, nonce: browserGrant.nonce, generation: browserGrant.generation, ok: true, result: { path: '/home' } }))
    await expect(settledPromise).resolves.toMatchObject({ id: command.id, nonce: browserGrant.nonce, generation: browserGrant.generation, ok: true })
    await expect(commandPromise).resolves.toEqual({ path: '/home' })
  })

  it('acknowledges failed results before rejecting and rejects a later stale result', async () => {
    const { broker, connect } = await setup()
    const socket = await connect()
    await ready(socket)
    const commandPromise = broker.execute('session-1', { op: 'click', ref: 'button' })
    const command = await nextMessage(socket, message => message.type === 'command')
    const browserGrant = command.grant as Message
    const settledPromise = nextMessage(socket, message => message.type === 'settled')
    const commandFailure = commandPromise.catch(error => error)
    const result = { type: 'result', id: command.id, nonce: browserGrant.nonce, generation: browserGrant.generation, ok: false, error: 'button is disabled' }
    socket.send(JSON.stringify(result))
    await expect(settledPromise).resolves.toMatchObject({ id: command.id, ok: false })
    const failure = await commandFailure
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('button is disabled')
    socket.send(JSON.stringify(result))
    await expect(nextMessage(socket, message => message.type === 'error')).resolves.toMatchObject({ message: 'No browser command is pending' })
  })

  it('keeps the first ready Preview when another browser connects', async () => {
    const { broker, connect } = await setup()
    const first = await connect()
    await ready(first)
    const commandPromise = broker.execute('session-1', { op: 'snapshot' })
    const command = await nextMessage(first, message => message.type === 'command')
    const firstGrant = command.grant as Message

    const second = await connect('bob-token')
    await ready(second, 'generation-2')
    second.send(JSON.stringify({ type: 'result', id: command.id, nonce: firstGrant.nonce, generation: firstGrant.generation, ok: true, result: 'wrong browser' }))
    await expect(nextMessage(second, message => message.type === 'error')).resolves.toMatchObject({ message: 'Stale or unauthorized browser result' })
    first.send(JSON.stringify({ type: 'result', id: command.id, nonce: firstGrant.nonce, generation: firstGrant.generation, ok: true, result: 'first browser' }))
    await expect(commandPromise).resolves.toBe('first browser')
  })

  it('times out a command and clears the grant', async () => {
    const { broker, connect } = await setup(undefined, { commandMs: 25, grantMs: 500, heartbeatMs: 50, pollMs: 50 })
    const socket = await connect()
    await ready(socket)
    await expect(broker.execute('session-1', { op: 'click', ref: 'button' })).rejects.toThrow('Browser command timed out')
  })

  it('allows one pending request and binds execution to its session', async () => {
    const { broker, connect, setCurrent } = await setup({ session: { id: 'session-1' } })
    const socket = await connect()
    await ready(socket)
    await expect(broker.execute('other-session', { op: 'snapshot' })).rejects.toThrow('another session')
    const first = broker.execute('session-1', { op: 'snapshot' })
    await expect(broker.execute('session-1', { op: 'snapshot' })).rejects.toThrow('already pending')
    setCurrent({ session: { id: 'session-2' } })
    await expect(first).rejects.toThrow(/(?:Browser control authority|Builder lifecycle) changed/)
  })

  it('requires a same-origin admin handshake and filters sensitive page paths', async () => {
    const { url } = await setup()
    const foreign = new WebSocket(url, { headers: { origin: 'https://evil.example', cookie: 'sid=1' } })
    sockets.push(foreign)
    await expect(waitForHandshakeFailure(foreign)).resolves.toBeUndefined()
    const current = await setup().then(value => value)
    const socket = await current.connect()
    socket.send(JSON.stringify({ type: 'ready', generation: 'g', path: '/settings?password=secret' }))
    const state = await nextMessage(socket, message => message.type === 'state' && (message.state as Message).tabs !== undefined)
    const tab = ((state.state as Message).tabs as Message[])[0]
    expect(tab.path).toBe('/unavailable')
    await expect(current.broker.execute('session-1', { op: 'snapshot' })).rejects.toThrow('No Builder Preview tab')
    const member = await setup()
    member.setIdentity({ id: 'alice', display: 'alice', role: 'member', kind: 'human' })
    const memberSocket = new WebSocket(member.url, { headers: { origin: member.origin, cookie: 'sid=1' } })
    sockets.push(memberSocket)
    await expect(waitForHandshakeFailure(memberSocket)).resolves.toBeUndefined()
  })
})
