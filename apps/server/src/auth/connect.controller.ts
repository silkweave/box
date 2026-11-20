// MCP sign-in, the core shell: the consent decision behind the dashboard's `/connect` page and
// Connected apps (Profile for one's own, Users for an admin). The logic is the extension's (the
// `mcp` recipe, core mcp-auth.ts `McpSignIn`); core owns the routes so that any signed-in person,
// whatever their role's areas, may approve a client for themselves and manage their own
// connections. Without the recipe every route but `connectStatus` answers that sign-in is not set up.
//
// The consent decision is a signed-in browser's alone: a session credential (never an access token
// or an OAuth token), the CSRF header (AuthGuard) and a same-origin request. The person it binds is
// the session's, never an id the caller sends. Nothing here is an MCP tool.

import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, NotFoundException, Post, Req, UseGuards } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { IsBoolean, IsOptional, IsString } from 'class-validator'
import { Trpc } from '@silkweave/nestjs'
import { accessOf, deviceHint, levelCovers, levelOf, mcpAuthExtension, mcpServerDirectory, sameOrigin, type McpSignIn, type Principal } from '@silkweave/box-core'
import { z } from 'zod/v4'
import { AuthGuard } from './auth.guard.js'
import { Admin, Authenticated, Read, type PrincipalRequest } from './auth.decorators.js'

class RequestIdDto {
  @ApiProperty({ description: 'The pending request id from /connect?request=' }) @IsString() id!: string
}

class DecideDto {
  @ApiProperty({ description: 'The pending request id' }) @IsString() id!: string
  @ApiProperty({ description: 'true to allow, false to deny' }) @IsBoolean() allow!: boolean
  /**
   * The person the consent page showed. Only a precondition: an Allow is refused when the session's
   * person differs (an account switch in another tab), and it never names the grant's owner, which
   * is always the session's.
   */
  @ApiProperty({ description: 'The id of the person the consent page displayed; Allow is refused if the session is now someone else', required: false })
  @IsOptional() @IsString() shown?: string
}

class GrantIdDto {
  @ApiProperty({ description: 'The connection (grant) id' }) @IsString() grantId!: string
}

class AppsOfDto {
  @ApiProperty({ required: false, description: 'One person; omitted for everyone' }) @IsOptional() @IsString() principalId?: string
}

class PrincipalIdDto {
  @ApiProperty() @IsString() principalId!: string
}

const statusOutput = z.object({ installed: z.boolean(), url: z.string().nullable() })
const requestOutput = z.object({
  request: z
    .object({
      id: z.string(),
      clientId: z.string(),
      clientName: z.string().nullable(),
      clientKind: z.enum(['cimd', 'dcr']),
      clientHost: z.string().nullable(),
      redirectHost: z.string(),
      expiresAt: z.number(),
    })
    .nullable(),
  person: z.object({ id: z.string(), display: z.string() }),
  /** The outside services (servers powerup) the app could also use as this person, by label. */
  outsideServices: z.array(z.string()),
})
const decideOutput = z.object({ redirectTo: z.string().nullable() })
const appOutput = z.object({
  grantId: z.string(),
  principalId: z.string(),
  clientId: z.string(),
  clientName: z.string().nullable(),
  clientKind: z.enum(['cimd', 'dcr']),
  clientHost: z.string().nullable(),
  connectedAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string(),
  device: z.string().nullable(),
})
const appsOutput = z.object({ apps: z.array(appOutput) })
const revokedOutput = z.object({ revoked: z.number() })

const NOT_SET_UP = 'MCP sign-in is not set up on this Box (the mcp recipe adds it)'

function signIn(): McpSignIn {
  const s = mcpAuthExtension()?.signIn
  if (!s) throw new NotFoundException(NOT_SET_UP)
  return s
}

/** The signed-in person behind a consent call: a human, on a browser session, same origin. */
function consentingPerson(req: PrincipalRequest & { headers: Record<string, string | string[] | undefined> }) {
  const p = req.principal
  if (!p || p.kind !== 'human') throw new ForbiddenException('only a person can connect an app to their account')
  if (req.credential !== 'session') throw new ForbiddenException('approve a connection in your signed-in browser, not with a token')
  if (!sameOrigin(req)) throw new ForbiddenException('cross-origin request refused')
  return p
}

/**
 * The outside services an app approved by `p` could reach through `/mcp`: the MCP servers in the
 * person's audience, shown only with `mcp` read access (the passthrough rule, mcp-passthrough.ts).
 * Empty without the servers powerup.
 */
async function outsideServicesOf(p: Principal): Promise<string[]> {
  const directory = mcpServerDirectory()
  if (!directory) return []
  if (!levelCovers(levelOf(await accessOf(p), 'mcp'), 'read')) return []
  const ids = new Set(await directory.personal(p.id))
  return directory.list().filter((c) => ids.has(c.id)).map((c) => c.label)
}

/** The caller as a human (Connected apps), or a refusal. */
function person(req: PrincipalRequest) {
  const p = req.principal
  if (!p || p.kind !== 'human') throw new ForbiddenException('connected apps belong to people')
  return p
}

@Controller('connect')
@UseGuards(AuthGuard)
export class ConnectController {
  /** tRPC `connectStatus` - whether MCP sign-in is set up, and the MCP URL people connect to. */
  @Post('status')
  @Trpc({ kind: 'query', output: statusOutput })
  @Authenticated()
  @Read()
  status() {
    const s = mcpAuthExtension()?.signIn
    return { installed: !!s, url: s?.url() ?? null }
  }

  /** tRPC `connectRequest` - the pending sign-in request the consent page shows, and who would approve it. */
  @Post('request')
  @Trpc({ kind: 'query', output: requestOutput })
  @Authenticated()
  @Read()
  async request(@Body() body: RequestIdDto, @Req() req: PrincipalRequest & { headers: Record<string, string | string[] | undefined> }) {
    const p = consentingPerson(req)
    const request = await signIn().request(body.id)
    return { request, person: { id: p.id, display: p.display }, outsideServices: request ? await outsideServicesOf(p) : [] }
  }

  /** tRPC `connectDecide` - allow or deny a pending request for the signed-in person; returns where the browser goes next. */
  @Post('decide')
  @Trpc({ kind: 'mutation', output: decideOutput })
  @Authenticated()
  async decide(@Body() body: DecideDto, @Req() req: PrincipalRequest & { headers: Record<string, string | string[] | undefined> }) {
    const p = consentingPerson(req)
    const s = signIn()
    if (!body.id) throw new BadRequestException('a request id is required')
    // Allow only for the person the page showed: the page may predate an account switch in another
    // tab. The session stays the authority for the subject; `shown` can only refuse.
    if (body.allow && body.shown !== p.id) throw new ConflictException('The signed-in account changed since this page loaded. Check the account and decide again.')
    const ua = req.headers['user-agent']
    const redirectTo = body.allow ? await s.approve(body.id, p.id, { device: deviceHint(Array.isArray(ua) ? ua[0] : ua) }) : await s.deny(body.id)
    return { redirectTo }
  }

  /** tRPC `connectApps` - the caller's own connected apps. */
  @Post('apps')
  @Trpc({ kind: 'query', output: appsOutput })
  @Authenticated()
  @Read()
  async apps(@Req() req: PrincipalRequest) {
    const p = person(req)
    return { apps: await signIn().apps(p.id) }
  }

  /** tRPC `connectAppRevoke` - revoke one of the caller's own connected apps. */
  @Post('app-revoke')
  @Trpc({ kind: 'mutation', output: revokedOutput })
  @Authenticated()
  async appRevoke(@Body() body: GrantIdDto, @Req() req: PrincipalRequest) {
    const p = person(req)
    return { revoked: (await signIn().revoke(body.grantId, { owner: p.id, actor: p.id })) ? 1 : 0 }
  }

  /** tRPC `connectAppsOf` - an admin's view: one person's connected apps, or everyone's. */
  @Post('apps-of')
  @Trpc({ kind: 'query', output: appsOutput })
  @Admin()
  @Read()
  async appsOf(@Body() body: AppsOfDto) {
    return { apps: await signIn().apps(body.principalId ?? null) }
  }

  /** tRPC `connectAppAdminRevoke` - an admin revokes anyone's connected app. */
  @Post('app-admin-revoke')
  @Trpc({ kind: 'mutation', output: revokedOutput })
  @Admin()
  async appAdminRevoke(@Body() body: GrantIdDto, @Req() req: PrincipalRequest) {
    const p = person(req)
    return { revoked: (await signIn().revoke(body.grantId, { owner: null, actor: p.id })) ? 1 : 0 }
  }

  /** tRPC `connectAppsRevokeAll` - an admin revokes every connected app of one person. */
  @Post('apps-revoke-all')
  @Trpc({ kind: 'mutation', output: revokedOutput })
  @Admin()
  async appsRevokeAll(@Body() body: PrincipalIdDto, @Req() req: PrincipalRequest) {
    const p = person(req)
    return { revoked: await signIn().revokeAll(body.principalId, p.id) }
  }
}
