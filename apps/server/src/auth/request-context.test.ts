// The request context reaches handlers on every transport (docs/AUTH.md "Request context"): REST
// through the first-middleware holder, tRPC HTTP (batched), tRPC WebSocket and MCP Streamable HTTP
// through one frame per call, and a stream on every step. The guard fills the holder after an
// await, as AuthGuard does. A handler that runs without a filled holder is denied area data.

import 'reflect-metadata'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CanActivate, Controller, ExecutionContext, ForbiddenException, Get, Injectable, Module, Query, UseGuards } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { Mcp, SilkweaveModule, Trpc } from '@silkweave/nestjs'
import { mcp } from '@silkweave/nestjs/mcp'
import { asSystem, canAccess, currentPrincipal, currentScope, fillRequest, requireReachArea, runInRequest, withoutContext, type Principal } from '@silkweave/box-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { withCallContexts } from './call-context.js'
import { AreaAccessFilter } from './area-access.filter.js'
import { inputError } from './input-error.js'
import { trpcWithSocket } from '../trpc/trpc-socket.js'

const tick = new EventEmitter()
tick.setMaxListeners(100)
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const principal = (id: string): Principal => ({ id, display: id, role: 'member', kind: 'human' })

/**
 * Fills the holder after an await with a principal unique to this guard run (`<caller>#<seq>`). If
 * two concurrent calls shared a holder, both would report the later fill, so distinct ids per call
 * (and one id across a stream's frames) prove a holder per call.
 */
let seq = 0
@Injectable()
class FillGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>()
    const caller = req.headers['x-who']
    const id = `${caller}#${++seq}`
    await pause(Math.random() * 4)
    if (!caller) return true
    const p = principal(id)
    fillRequest({ principal: p, access: { role: 'member', areas: new Map([['ops', 'read']]), fallback: 'write', admin: false, revision: 1 }, handler: ctx.getHandler().name })
    return true
  }
}

@Injectable()
class RefuseGuard implements CanActivate {
  canActivate(): boolean { throw new ForbiddenException('admin only - ask an admin') }
}

@Controller('ctx')
@UseGuards(FillGuard)
class ContextController {
  @Get('who')
  @Trpc({ kind: 'query' })
  @Mcp({ name: 'ctx-who' })
  async who(@Query('n') n: string): Promise<{ who: string; n: string; crm: boolean }> {
    await pause(Math.random() * 6)
    return { who: currentPrincipal()?.id ?? '(none)', n: String(n), crm: canAccess('crm', 'read') }
  }

  /**
   * A handler shaped like the Box's controllers: a catch-all that turns a domain failure into a
   * 400, around a core accessor check that refuses (ops is read-only for the filled principal).
   */
  @Get('save')
  @Trpc({ kind: 'query' })
  @Mcp({ name: 'ctx-save' })
  async save(@Query('bad') bad: string): Promise<{ ok: true }> {
    try {
      await pause(1)
      if (bad === '1') throw new Error('bad input')
      requireReachArea('ops', 'write')
      return { ok: true }
    } catch (e) {
      throw inputError(e)
    }
  }

  @Get('guarded')
  @UseGuards(RefuseGuard)
  @Trpc({ kind: 'query' })
  @Mcp({ name: 'ctx-guarded' })
  async guarded(): Promise<{ ok: true }> { return { ok: true } }

  /** Three frames, each after an event dispatched from outside the request (a bus, a timer). */
  @Trpc({ kind: 'subscription' })
  async *stream(@Query('n') n: string): AsyncGenerator<{ who: string; n: string; step: number }> {
    for (let step = 0; step < 3; step++) {
      await new Promise<void>((resolve) => tick.once('tick', () => resolve()))
      yield { who: currentPrincipal()?.id ?? '(none)', n: String(n), step }
    }
  }
}

@Module({ controllers: [ContextController], providers: [FillGuard] })
class ContextModule {}

const transport = trpcWithSocket({ basePath: '/trpc' })

@Module({
  imports: [
    ContextModule,
    SilkweaveModule.forRoot({
      silkweave: { name: 'ctx-test', description: 'request context proof', version: '0.0.0' },
      adapters: [transport.adapter, withCallContexts(mcp({ basePath: '/mcp' }))],
    }),
  ],
})
class AppModule {}

let app: NestExpressApplication
let base = ''
let ticker: ReturnType<typeof setInterval>

beforeAll(async () => {
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false })
  app.use((_req: IncomingMessage, _res: ServerResponse, next: () => void) => runInRequest(next))
  app.useBodyParser('json')
  app.useGlobalFilters(new AreaAccessFilter())
  app.setGlobalPrefix('api')
  await app.listen(0, '127.0.0.1')
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1')
  app.getHttpServer().on('upgrade', (req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => transport.upgrade(req, socket, head))
  // Events dispatched from a timer: no request context of their own.
  ticker = withoutContext(() => setInterval(() => tick.emit('tick'), 3))
})

afterAll(async () => {
  clearInterval(ticker)
  transport.close()
  await app.close()
})

type Who = { who: string; n: string; crm?: boolean }

describe('the request context on every transport', () => {
  it('REST: the first-middleware holder reaches the handler, per request', async () => {
    const out = await Promise.all(Array.from({ length: 12 }, (_, n) =>
      fetch(`${base}/api/ctx/who?n=${n}`, { headers: { 'x-who': 'rest' } }).then((r) => r.json() as Promise<Who>)))
    for (const o of out) expect(o).toMatchObject({ who: expect.stringMatching(/^rest#/), crm: true })
    expect(new Set(out.map((o) => o.who)).size).toBe(12)
  })

  it('tRPC HTTP: each call of a batch has its own holder', async () => {
    const input = encodeURIComponent(JSON.stringify(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [String(i), { n: String(i) }]))))
    const paths = Array.from({ length: 8 }, () => 'contextWho').join(',')
    const res = await fetch(`${base}/trpc/${paths}?batch=1&input=${input}`, { headers: { 'x-who': 'batch' } })
    const out = (await res.json()) as { result: { data: Who } }[]
    expect(out).toHaveLength(8)
    for (const o of out) expect(o.result.data).toMatchObject({ who: expect.stringMatching(/^batch#/), crm: true })
    expect(new Set(out.map((o) => o.result.data.who)).size).toBe(8)
  })

  it('MCP Streamable HTTP: a tools/call sees its holder', async () => {
    // Protocol 2026-07-28 (the server's only era): every call is its own HTTP request.
    const client = new Client({ name: 'ctx-test', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { 'x-who': 'mcp' } } }))
    const call = async (n: number): Promise<Who> => {
      const result = (await client.callTool({ name: 'CtxWho', arguments: { n: String(n) } })) as { content: { type: string; text?: string }[]; structuredContent?: Who }
      return result.structuredContent ?? (JSON.parse(result.content[0]!.text!) as Who)
    }
    const out = await Promise.all(Array.from({ length: 10 }, (_, n) => call(n)))
    for (const o of out) expect(o.who).toMatch(/^mcp#/)
    expect(new Set(out.map((o) => o.who)).size).toBe(10)
    await client.close()
  })

  it('tRPC WebSocket: concurrent subscriptions on one socket keep their own holder on every frame', async () => {
    const frames = await new Promise<{ id: number; data: Who & { step: number } }[]>((resolve, reject) => {
      const got: { id: number; data: Who & { step: number } }[] = []
      const ws = new WebSocket(`${base.replace('http', 'ws')}/trpc`, { headers: { origin: base, 'x-who': 'ws' } })
      ws.on('open', () => {
        for (let id = 1; id <= 4; id++) ws.send(JSON.stringify({ id, method: 'subscription', params: { path: 'contextStream', input: { n: String(id) } } }))
      })
      ws.on('message', (raw) => {
        const text = String(raw)
        if (text === 'PING' || text === 'PONG') return
        const msg = JSON.parse(text) as { id: number; result?: { type: string; data?: Who & { step: number } } }
        if (msg.result?.type === 'data' && msg.result.data) got.push({ id: msg.id, data: msg.result.data })
        if (got.length === 12) { ws.close(); resolve(got) }
      })
      ws.on('error', reject)
      setTimeout(() => reject(new Error(`only ${got.length} frames`)), 5000)
    })
    expect(frames).toHaveLength(12)
    // Every frame was produced inside a filled holder: one id per subscription, never shared.
    const bySubscription = new Map<number, Set<string>>()
    for (const f of frames) {
      expect(f.data.who).toMatch(/^ws#/)
      bySubscription.set(f.id, (bySubscription.get(f.id) ?? new Set()).add(f.data.who))
    }
    expect([...bySubscription.values()].every((ids) => ids.size === 1)).toBe(true)
    expect(new Set([...bySubscription.values()].map((ids) => [...ids][0])).size).toBe(4)
  })
})

describe('an area refusal inside a controller catch-all (BOX-Review 0bfd114)', () => {
  it('REST: 403 with the guard refusal body; an input error stays 400', async () => {
    const refused = await fetch(`${base}/api/ctx/save`, { headers: { 'x-who': 'rest' } })
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: 'area_access', area: 'ops', needed: 'write', message: 'no write access to ops' })
    const bad = await fetch(`${base}/api/ctx/save?bad=1`, { headers: { 'x-who': 'rest' } })
    expect(bad.status).toBe(400)
  })

  it('tRPC HTTP: FORBIDDEN; an input error stays BAD_REQUEST', async () => {
    const call = async (input: object) => {
      const res = await fetch(`${base}/trpc/contextSave?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { 'x-who': 'trpc' } })
      return { status: res.status, body: (await res.json()) as { error?: { data?: { code?: string } } } }
    }
    const refused = await call({})
    expect(refused.status).toBe(403)
    expect(refused.body.error?.data?.code).toBe('FORBIDDEN')
    const bad = await call({ bad: '1' })
    expect(bad.status).toBe(400)
    expect(bad.body.error?.data?.code).toBe('BAD_REQUEST')
  })

  it('MCP tools/call: a tool refusal with code area_access (MCP tool errors carry no HTTP status)', async () => {
    const client = new Client({ name: 'ctx-test', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { 'x-who': 'mcp' } } }))
    const result = (await client.callTool({ name: 'CtxSave', arguments: {} })) as { isError?: boolean; content: { type: string; text?: string }[] }
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0]!.text!)).toMatchObject({ success: false, code: 'area_access', message: 'no write access to ops' })
    await client.close()
  })
})

describe('guard refusals over MCP', () => {
  it('a guard refusal carries the code forbidden, not http_error', async () => {
    const client = new Client({ name: 'ctx-test', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { 'x-who': 'mcp' } } }))
    const result = (await client.callTool({ name: 'CtxGuarded', arguments: {} })) as { isError?: boolean; content: { type: string; text?: string }[] }
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.content[0]!.text!)).toMatchObject({ success: false, code: 'forbidden', message: 'admin only - ask an admin' })
    await client.close()
  })
})

describe('without a filled holder', () => {
  it('denies area data: no frame, an empty holder, an unauthenticated call', async () => {
    expect(withoutContext(() => canAccess('crm', 'read'))).toBe(false)
    expect(runInRequest(() => canAccess('crm', 'read'))).toBe(false)
    expect(runInRequest(() => currentScope().kind)).toBe('none')
    const anon = (await (await fetch(`${base}/api/ctx/who?n=1`)).json()) as Who
    expect(anon).toEqual({ who: '(none)', n: '1', crm: false })
  })

  it('system is entered explicitly and only for its callback', async () => {
    expect(asSystem('test', () => canAccess('crm', 'write'))).toBe(true)
    expect(await asSystem('test', async () => {
      await pause(1)
      return currentScope().kind
    })).toBe('system')
    expect(withoutContext(() => currentScope().kind)).toBe('none')
  })
})
