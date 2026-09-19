import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { SESSION_COOKIE, authenticatePrincipal, parseCookies, resolvePrincipalById, verifySession, type Principal, type PrincipalCredential } from '@silkweave/box-core'
import { IS_ADMIN, IS_PUBLIC } from './auth.decorators.js'

interface GuardRequest {
  headers: { cookie?: string; authorization?: string; 'x-box-csrf'?: string | string[] }
  method?: string
  principal?: Principal | null
  credential?: PrincipalCredential
}

/**
 * Global guard: resolves the principal from a Bearer token (API/MCP clients) or the session cookie
 * (SPA), attaches it to the request, and requires one. `@Public()` routes bypass it. Works uniformly
 * across REST controllers, @Trpc procedures and @Mcp tools (silkweave runs the Nest guard pipeline
 * for all three). See docs/AUTH.md.
 *
 * It also AUTHORIZES, since 2026-09-13 (docs/core/AUTH.md § 3): a route marked `@Admin()` additionally
 * requires `principal.role === 'admin'`. The check lives HERE, and not in a second `AdminGuard`,
 * because the adapters run exactly the guards named in `@UseGuards` - so a separate guard would be
 * a second decorator to forget on a method, and forgetting it fails open and silently. Putting the
 * tier where the principal is resolved means a method cannot be authenticated without also being
 * authorized, on every transport, by construction.
 *
 * Between 2026-09-10 and 2026-09-13 there was no authorization at all, argued from "a tailnet-only
 * tool for one small team". That argument does not survive the Box becoming a public template that
 * strangers run: `user-invite-reveal` returns any user's plaintext token, so one tier meant any
 * signed-in principal could become anyone - including through a prompt-injected agent session.
 * The role is re-read from the users row on every request (it is not in the cookie), so a demotion
 * takes effect on the demoted user's next call.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /** Resolve the principal + whether it came from a Bearer token (vs the session cookie). */
  private async resolve(req: GuardRequest): Promise<{ principal: Principal | null; viaBearer: boolean }> {
    const authz = req.headers.authorization
    if (authz && /^Bearer\s+/i.test(authz)) {
      return { principal: await authenticatePrincipal(authz.replace(/^Bearer\s+/i, '').trim()), viaBearer: true }
    }
    const claims = verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE])
    return { principal: claims ? await resolvePrincipalById(claims.sub) : null, viaBearer: false }
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<GuardRequest>()
    const { principal, viaBearer } = await this.resolve(req)
    req.principal = principal
    // Recorded alongside the principal, for the one route family that must tell a person at a
    // browser from an API client (chat-op approvals). Only meaningful WITH a principal: a bearer
    // that failed to authenticate is not a credential, it is a rejected request.
    if (principal) req.credential = viaBearer ? 'bearer' : 'session'

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])
    if (isPublic) return true

    if (!req.principal) throw new UnauthorizedException('sign in required')

    // Authorization. Checked before CSRF deliberately: a member calling an admin route should hear
    // "admin only" whichever way they called it, rather than a header complaint that suggests the
    // request would have worked with one more header.
    const adminOnly = this.reflector.getAllAndOverride<boolean>(IS_ADMIN, [ctx.getHandler(), ctx.getClass()])
    if (adminOnly && req.principal.role !== 'admin') {
      throw new ForbiddenException('admin only - ask an admin (Settings -> Users)')
    }

    // CSRF: a cookie-authed state-changing request must carry the x-box-csrf header (the SPA sets it
    // on every mutation). SameSite=Lax already blocks cross-site cookie sends on these methods; the
    // header is the second layer, and it OUTLIVED the authorization layer deliberately - dropping
    // authorization says "every signed-in person may do anything", not "any web page may act as
    // them". Bearer-authed clients (API/MCP/cli) carry no ambient cookie, so they are CSRF-exempt by
    // construction. @Public routes (login, magic link) never reach here.
    const method = (req.method ?? 'GET').toUpperCase()
    const mutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
    if (mutating && !viaBearer && !req.headers['x-box-csrf']) {
      throw new ForbiddenException('missing CSRF header')
    }

    return true
  }
}
