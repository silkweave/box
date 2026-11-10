import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createContext } from '@silkweave/core'
import { requestClosed } from '@silkweave/box-core'
import { afterEach, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { z } from 'zod'
import { trpcWithSocket } from './trpc-socket.js'

let server: Server | undefined
let transport: ReturnType<typeof trpcWithSocket> | undefined
afterEach(async () => {
  transport?.close()
  await new Promise(done => server ? server.close(done) : done(undefined))
  server = undefined
  transport = undefined
})

async function boot(extra: unknown[] = []): Promise<string> {
  transport = trpcWithSocket({ basePath: '/trpc' })
  transport.adapter.register({
    httpAdapter: { use: () => undefined },
    baseContext: createContext({ adapter: 'trpc' }),
    actions: [
      { name: 'feed', description: 'a live feed', input: z.object({}), chunk: z.unknown(), run: async function* () { yield { n: 1 } } },
      ...extra,
      { name: 'save', description: 'a mutation', kind: 'mutation', input: z.object({}), run: async () => ({ saved: true }) },
    ],
  } as unknown as Parameters<typeof transport.adapter.register>[0])
  server = createServer()
  server.on('upgrade', (req, socket, head) => transport!.upgrade(req, socket, head))
  await new Promise<void>(done => server!.listen(0, '127.0.0.1', done))
  return `127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** Open a socket and collect parsed frames until `count` arrive (or it closes/refuses). */
function exchange(host: string, origin: string, messages: unknown[], count: number): Promise<{ opened: boolean; frames: Record<string, unknown>[] }> {
  return new Promise(resolve => {
    const frames: Record<string, unknown>[] = []
    let opened = false
    const ws = new WebSocket(`ws://${host}/trpc`, { headers: { origin } })
    ws.on('open', () => { opened = true; for (const m of messages) ws.send(JSON.stringify(m)) })
    ws.on('message', data => {
      const text = String(data)
      if (text === 'PING' || text === 'PONG') return
      frames.push(JSON.parse(text) as Record<string, unknown>)
      if (frames.length >= count) { ws.close(); resolve({ opened, frames }) }
    })
    ws.on('error', () => resolve({ opened, frames }))
    ws.on('close', () => resolve({ opened, frames }))
  })
}

it('streams subscriptions over a same-origin socket and offers nothing else', async () => {
  const host = await boot()
  const { opened, frames } = await exchange(host, `http://${host}`, [
    { id: 1, method: 'subscription', params: { path: 'feed', input: {} } },
    { id: 2, method: 'mutation', params: { path: 'save', input: {} } },
  ], 4)
  expect(opened).toBe(true)
  expect(frames.find(f => f.id === 1 && (f.result as { type?: string })?.type === 'data')).toMatchObject({ result: { data: { n: 1 } } })
  expect(frames.find(f => f.id === 2)).toMatchObject({ error: { data: { code: 'NOT_FOUND' } } })
})

it('refuses an upgrade from another origin', async () => {
  const host = await boot()
  const { opened } = await exchange(host, 'https://elsewhere.example', [], 1)
  expect(opened).toBe(false)
})

/** A feed parked in a wait that only the caller going away ends; `released` is set by its cleanup. */
function parkedFeed(released: { at: number }) {
  return {
    name: 'parked', description: 'a feed parked in its wait', input: z.object({}), chunk: z.unknown(),
    run: async function* () {
      const closed = requestClosed()!
      try {
        yield { n: 1 }
        await new Promise<void>(done => closed.addEventListener('abort', () => done()))
      } finally { released.at = Date.now() }
    },
  }
}

const until = async (done: () => boolean, ms = 2000) => { const end = Date.now() + ms; while (!done() && Date.now() < end) await new Promise(r => setTimeout(r, 10)) }

it('releases a parked feed when its subscription is stopped, with the socket still open', async () => {
  const released = { at: 0 }
  const host = await boot([parkedFeed(released)])
  await new Promise<void>(done => {
    const ws = new WebSocket(`ws://${host}/trpc`, { headers: { origin: `http://${host}` } })
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'subscription', params: { path: 'parked', input: {} } })))
    ws.on('message', data => {
      const frame = String(data)
      if (frame.includes('"data"') && frame.includes('"n":1')) ws.send(JSON.stringify({ id: 1, method: 'subscription.stop' }))
    })
    until(() => released.at > 0).then(() => { expect(ws.readyState).toBe(WebSocket.OPEN); ws.close(); done() })
  })
  expect(released.at).toBeGreaterThan(0)
})

it('releases a parked feed when its socket closes', async () => {
  const released = { at: 0 }
  const host = await boot([parkedFeed(released)])
  const ws = new WebSocket(`ws://${host}/trpc`, { headers: { origin: `http://${host}` } })
  await new Promise<void>(done => {
    ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'subscription', params: { path: 'parked', input: {} } })))
    ws.on('message', () => { ws.terminate(); done() })
  })
  await until(() => released.at > 0)
  expect(released.at).toBeGreaterThan(0)
})
