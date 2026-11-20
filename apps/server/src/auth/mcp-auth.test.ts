// MCP sign-in plumbing (core mcp-auth.ts): the `/mcp` adapter's call wrapper marks each call's frame,
// the mark reaches the guard of a tool call there and no other route, and the shared resolver judges a
// token the sign-in extension recognises by the extension alone (failing closed, never falling back
// to the access-token check).

import 'reflect-metadata'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CanActivate, Controller, ExecutionContext, Get, Injectable, Module, UseGuards } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { Mcp, SilkweaveModule } from '@silkweave/nestjs'
import { mcp } from '@silkweave/nestjs/mcp'
import { installMcpAuth, isMcpCall, resolveMcpCredential, runInRequest, type McpAuthExtension, type Principal } from '@silkweave/box-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withCallContexts } from './call-context.js'

const person: Principal = { id: 'toby', display: 'Toby', role: 'member', kind: 'human' }

/** Recognises `oauth.<anything>`; only `oauth.good` is valid. Never touches the database. */
const extension: McpAuthExtension = {
  auth: () => null,
  recognizes: (token) => token.startsWith('oauth.'),
  verify: async (token) => (token === 'oauth.good' ? { principal: person, grantId: 'g1', clientId: 'https://claude.ai/oauth/claude-code-client-metadata' } : null),
  signIn: {
    url: () => null,
    request: async () => null,
    approve: async () => null,
    deny: async () => null,
    apps: async () => [],
    log: async () => [],
    revoke: async () => false,
    revokeAll: async () => 0,
  },
}

/** Records what the guard of each call saw. */
const seen: { route: string; marked: boolean; credential: string | null }[] = []

@Injectable()
class RecordGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string>; url?: string }>()
    const marked = isMcpCall()
    const authz = req.headers.authorization ?? ''
    const resolved = marked && authz.startsWith('Bearer ') ? await resolveMcpCredential(authz.slice(7)) : null
    seen.push({ route: req.url ?? '', marked, credential: resolved?.credential ?? null })
    return true
  }
}

@Controller('probe')
@UseGuards(RecordGuard)
class ProbeController {
  @Get('who')
  @Mcp({ name: 'probe-who' })
  async who(): Promise<{ ok: true }> {
    return { ok: true }
  }
}

@Module({
  controllers: [ProbeController],
  imports: [
    SilkweaveModule.forRoot({
      silkweave: { name: 'mcp-auth-test', description: 'test', version: '1' },
      adapters: [withCallContexts(mcp({
        basePath: '/mcp',
        auth: {
          required: true,
          verifyToken: async (token: string) => {
            const resolved = await resolveMcpCredential(token)
            return resolved ? { token, sub: resolved.principal.id } : undefined
          },
        },
      }), { transport: 'mcp' })],
    }),
  ],
})
class AppModule {}

let app: NestExpressApplication
let base = ''
let uninstall: () => void = () => {}

beforeAll(async () => {
  uninstall = installMcpAuth('test', extension)
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false })
  app.use((_req: IncomingMessage, _res: ServerResponse, next: () => void) => runInRequest(next))
  app.useBodyParser('json')
  app.setGlobalPrefix('api')
  await app.listen(0, '127.0.0.1')
  base = (await app.getUrl()).replace('[::1]', '127.0.0.1')
})

afterAll(async () => {
  await app.close()
  uninstall()
})

const connect = async (token: string): Promise<Client> => {
  const client = new Client({ name: 'mcp-auth-test', version: '1' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
  return client
}

describe('MCP sign-in plumbing', () => {
  it('a valid OAuth token lists and calls tools, and the call guard sees the marked transport as oauth', async () => {
    const client = await connect('oauth.good')
    const tools = await client.listTools()
    expect(tools.tools.map((t) => t.name)).toContain('ProbeWho')
    seen.length = 0
    await client.callTool({ name: 'ProbeWho', arguments: {} })
    expect(seen).toEqual([expect.objectContaining({ marked: true, credential: 'oauth' })])
    await client.close()
  })

  it('a recognised but invalid token is refused at the transport (no access-token fallback)', async () => {
    await expect(connect('oauth.revoked')).rejects.toThrow()
    expect(await resolveMcpCredential('oauth.revoked')).toBeNull()
  })

  it('REST routes are not marked, so the guard never uses the MCP resolver there', async () => {
    seen.length = 0
    const res = await fetch(`${base}/api/probe/who`, { headers: { authorization: 'Bearer oauth.good' } })
    expect(res.status).toBe(200)
    expect(seen).toEqual([expect.objectContaining({ marked: false, credential: null })])
  })

  it('a second supplier is refused', () => {
    expect(() => installMcpAuth('other', extension)).toThrow(/supplied twice/)
  })
})
