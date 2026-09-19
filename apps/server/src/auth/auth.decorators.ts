import { ForbiddenException, SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { Principal, PrincipalCredential } from '@silkweave/box-core'

// Route-level auth metadata read by AuthGuard.

/** Mark a route reachable WITHOUT a session (login, magic-link). */
export const IS_PUBLIC = 'auth:public'
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true)

/**
 * Mark a method (or a whole controller) admin-only. Read by `AuthGuard`, so it holds on REST, tRPC
 * and MCP alike - wherever the class-level `@UseGuards(AuthGuard)` already holds.
 *
 * The rule for using it, from docs/core/AUTH.md § 3.1, and it is one sentence: **an operation is
 * admin-only when its blast radius is another person's identity or credential, the service itself,
 * or configuration wired to credentials.** Everything else stays a member's, which is the entire
 * working surface. Admin-gating the primary interaction makes the tool unusable, so when in doubt
 * the answer is member.
 */
export const IS_ADMIN = 'auth:admin'
export const Admin = (): MethodDecorator & ClassDecorator => SetMetadata(IS_ADMIN, true)

/**
 * The same check, for a branch a decorator cannot express - admin-only when a particular FIELD is
 * set (chat's `moderate` delete). Throws the same 403 the guard throws.
 */
export function assertAdmin(req: PrincipalRequest, what = 'this operation'): void {
  if (req.principal?.role !== 'admin') throw new ForbiddenException(`${what} is admin-only`)
}

/** Inject the authenticated principal (or null) attached to the request by AuthGuard. */
export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext): Principal | null => {
  const req = ctx.switchToHttp().getRequest<{ principal?: Principal | null }>()
  return req.principal ?? null
})

/**
 * Request shape carrying the principal AuthGuard attached. Use `@Req() req: PrincipalRequest` on
 * @Trpc/@Mcp methods - the @CurrentPrincipal param decorator only runs on plain REST handlers
 * (docs/AUTH.md). Audit-stamped writes default `actor ??= req.principal?.id` so MCP/agent calls
 * that omit it are attributed to the authenticated principal, not left null.
 */
export interface PrincipalRequest {
  principal?: Principal | null
  /**
   * How `principal` proved itself (session cookie vs bearer token) - the fact a destructive chat
   * operation keys its approval gate on (`chatOpNeedsApproval`). Absent when there is no
   * principal, and absent on a request the guard never saw; the gate treats both as "not a person
   * at a browser", which is the safe reading.
   */
  credential?: PrincipalCredential
}
