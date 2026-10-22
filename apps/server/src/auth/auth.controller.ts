import { Body, Controller, Get, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common'
import { ApiOkResponse, ApiProperty } from '@nestjs/swagger'
import { IsString } from 'class-validator'
import { Trpc } from '@silkweave/nestjs'
import { z } from 'zod/v4'
import {
  activeAgentPrincipals,
  authenticatePrincipal,
  agentIdentity,
  teamTimeZone,
  clientIp,
  consumeSigninGrant,
  hasHumanUser,
  mintSession,
  rateLimit,
  readUsers,
  requestIsSecure,
  sessionCookie,
  type Principal,
} from '@silkweave/box-core'
import { INSTANCE_ID } from '../agent/loopback-guard.js'
import { Public, type PrincipalRequest } from './auth.decorators.js'
import { AuthGuard } from './auth.guard.js'

// Minimal structural shapes so we don't take an express type dependency (see main.ts).
interface Req {
  headers: Record<string, unknown>
  socket?: { encrypted?: boolean; remoteAddress?: string }
}
interface Res {
  setHeader(name: string, value: string): void
  statusCode: number
  end(): void
}

class LoginDto {
  @ApiProperty({ description: 'The access token (bearer credential)' }) @IsString() token!: string
}
class LinkDto {
  @ApiProperty({ description: 'A short-lived sign-in grant (see core auth/link.ts)' }) @IsString() grant!: string
}
class PrincipalDto {
  @ApiProperty() id!: string
  @ApiProperty() display!: string
  @ApiProperty({ enum: ['admin', 'member'] }) role!: Principal['role']
  @ApiProperty({ enum: ['human', 'agent'] }) kind!: Principal['kind']
}
class AgentRefDto {
  @ApiProperty() id!: string
  @ApiProperty() name!: string
}
class MeDto {
  @ApiProperty({ required: false, nullable: true, type: PrincipalDto }) principal!: PrincipalDto | null
  @ApiProperty({ type: Object }) agent!: { id: string; name: string; role: 'admin' | 'member' }
  @ApiProperty({ type: [AgentRefDto], description: 'The active agents, system principal first; empty when signed out.' }) agents!: AgentRefDto[]
  @ApiProperty({ description: 'True until the host creates the first human owner.' }) needsOwner!: boolean
  @ApiProperty({ description: 'The team time zone (box.json timeZone, IANA): the clock "today" is read on.' }) timeZone!: string
}

/**
 * Authentication surface. Two ways in, and they are not the same credential:
 *
 *  - `login` takes the user's PERMANENT access token - the one their MCP client uses - and
 *    exchanges it for a session cookie. Typed or pasted by a person who kept it.
 *  - `link` spends a SHORT-LIVED, single-use grant (core auth/link.ts). Nothing durable is in it,
 *    which is what makes a sign-in link safe to send someone, or for an agent to mint on their
 *    behalf. This is the path a new person should take.
 *
 * `me` is the SPA's identity probe. Principal
 * resolution lives in AuthGuard (global), which since 2026-09-13 also carries the two trust tiers
 * (docs/core/AUTH.md § 3). What a session says is still only WHO: the role is not in the cookie, it is
 * re-read from the users row on every request - a principal
 * says WHO, and no route asks what they may do. See docs/AUTH.md.
 */
@Controller('auth')
export class AuthController {
  /** POST /api/auth/login {token} - exchange an access token for a session cookie. IP rate-limited. */
  @Post('login')
  @Public()
  @ApiOkResponse({ type: PrincipalDto })
  async login(@Body() body: LoginDto, @Req() req: Req, @Res({ passthrough: true }) res: Res): Promise<PrincipalDto> {
    if (!rateLimit(`login:${clientIp(req)}`, 10, 60_000)) throw new UnauthorizedException('too many attempts')
    const principal = await authenticatePrincipal((body.token ?? '').trim())
    if (!principal) throw new UnauthorizedException('invalid access token')
    // An agent has no browser: a session cookie would let it pass as a person at one (approvals
    // and other human decisions key on the session credential). Its token is for bearer calls only.
    if (principal.kind === 'agent') throw new UnauthorizedException('an agent token is a bearer credential; it does not sign in')
    res.setHeader('Set-Cookie', sessionCookie(mintSession(principal.id), undefined, requestIsSecure(req)))
    return principal
  }

  /**
   * GET /api/auth/instance - this process's per-boot id. Public, and deliberately nothing else.
   *
   * The one consumer is `verifyLoopback`, which asks 127.0.0.1 "are you me?" before the chat agent
   * runs a turn: nova's MCP client dials that literal address, and a port-forward can quietly own it
   * (see loopback-guard.ts for the incident this exists to prevent). A random per-boot uuid
   * discloses nothing - it names no user, no room, no version - and it is the only answer that
   * cannot be faked by another Box running this same code.
   */
  @Get('instance')
  @Public()
  @ApiOkResponse()
  instance(): { instance: string } {
    return { instance: INSTANCE_ID }
  }

  /** POST /api/auth/logout - clear the session cookie. */
  @Post('logout')
  @Public()
  @ApiOkResponse()
  logout(@Req() req: Req, @Res({ passthrough: true }) res: Res): { ok: true } {
    // Same `secure` derivation as minting: a browser matches a clearing cookie on name/path, but
    // sending attributes that disagree with the ones it stored is a way to be surprised later.
    res.setHeader('Set-Cookie', sessionCookie('', 0, requestIsSecure(req)))
    return { ok: true }
  }

  /** tRPC query `authMe` / GET /api/auth/me - the current principal, or null. Public so the SPA can
   *  probe login state without a 401. */
  @Get('me')
  @Public()
  @UseGuards(AuthGuard)
  @ApiOkResponse({ type: MeDto })
  @Trpc({ output: z.object({
    principal: z.object({ id: z.string(), display: z.string(), role: z.enum(['admin', 'member']), kind: z.enum(['human', 'agent']) }).nullable(),
    agent: z.object({ id: z.string(), name: z.string(), role: z.enum(['admin', 'member']) }),
    agents: z.array(z.object({ id: z.string(), name: z.string() })),
    needsOwner: z.boolean(),
    timeZone: z.string(),
  }) })
  async me(@Req() req: PrincipalRequest): Promise<MeDto> {
    const users = await readUsers()
    return {
      principal: req.principal ?? null,
      agent: agentIdentity(),
      // The active agents (system principal first), for mention autocomplete. Only to a signed-in
      // principal: the roster is no business of an anonymous probe.
      agents: req.principal ? (await activeAgentPrincipals()).map(({ id, display }) => ({ id, name: display })) : [],
      needsOwner: !hasHumanUser(users),
      timeZone: teamTimeZone(),
    }
  }

  /**
   * POST /api/auth/link {grant} - spend a short-lived sign-in grant for a session cookie.
   *
   * A POST and not a GET, for two independent reasons:
   *
   *  1. **Scanners.** Link unfurlers and URL detonators fetch a pasted URL immediately. A GET that
   *     consumed the grant would burn a single-use link before the human clicked, and tell them it
   *     was "already used". Consumption needs the click.
   *  2. **CSRF.** The retired GET route could be triggered cross-site by any page that could make
   *     the browser navigate. A JSON body cannot be sent cross-origin without a preflight this Box
   *     refuses.
   *
   * Public, because the whole point is that the caller has no session yet. The grant proves itself.
   */
  @Post('link')
  @Public()
  @ApiOkResponse({ type: PrincipalDto })
  async link(@Body() body: LinkDto, @Req() req: Req, @Res({ passthrough: true }) res: Res): Promise<PrincipalDto> {
    if (!rateLimit(`link:${clientIp(req)}`, 20, 60_000)) throw new UnauthorizedException('too many attempts')
    const result = await consumeSigninGrant((body.grant ?? '').trim())
    if (!result.ok) {
      // The reason is surfaced so the sign-in screen can say something true - "expired" and "already
      // used" need different advice. None of it is sensitive: a grant's claims are not secret.
      throw new UnauthorizedException(result.reason)
    }
    res.setHeader('Set-Cookie', sessionCookie(mintSession(result.principal.id), undefined, requestIsSecure(req)))
    return result.principal
  }

  /**
   * GET /api/auth/magic/* - RETIRED 2026-09-15. Kept as a signpost, not a credential path.
   *
   * This route used to accept the user's PERMANENT access token out of the URL and sign them in with
   * it. Every link ever minted is still sitting in someone's history, inbox or transcript, so the
   * route cannot simply 404 without those people concluding the Box is broken. It no longer looks at
   * the token at all - it just explains. Delete this stub once the field test is over.
   */
  @Get('magic/*path')
  @Public()
  magic(@Res() res: Res): void {
    res.statusCode = 302
    res.setHeader('Location', '/login?e=retired')
    res.end()
  }
}
