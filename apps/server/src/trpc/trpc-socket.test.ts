import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createContext } from '@silkweave/core'
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

async function boot(): Promise<string> {
  transport = trpcWithSocket({ basePath: '/trpc' })
  transport.adapter.register({
    httpAdapter: { use: () => undefined },
    baseContext: createContext({ adapter: 'trpc' }),
    actions: [
      { name: 'feed', description: 'a live feed', input: z.object({}), chunk: z.unknown(), run: async function* () { yield { n: 1 } } },
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
