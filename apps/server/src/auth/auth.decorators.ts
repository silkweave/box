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

/** Who besides a caller without a session credential may start the job. */
export interface StartsJobOptions {
  /**
   * A chat serving session (a session credential whose scope is a chat room, `room:<id>`) may
   * call it: a room agent delegating to a feature's own agent jobs. The job runs as its configured
   * principal with its own job credential, which still starts nothing.
   */
  fromChat?: boolean
  /**
   * The job's output goes back to the caller only and lands nowhere in the area (WikiAsk's answer).
   * An agent caller is then not judged as a writer into the area destination; the answer is
   * judged where it is read (the asker covers the job agent, a room agent as a relay).
   */
  answersCaller?: boolean
}

/**
 * `@StartsJob()`: the handler starts or queues another agent job or session (WikiAsk, WikiUpdate,
 * TriggerRun). A session credential is refused on every transport, and the tool is left out of a
 * session's MCP list: a session never starts sessions. `@StartsJob({ fromChat: true })` opens it
 * to chat serving sessions only; work and job sessions stay refused, so delegation is one level
 * deep (docs/AUTH.md "Session credentials").
 */
export const STARTS_JOB = 'auth:starts-job'
export const StartsJob = (options: StartsJobOptions = {}): MethodDecorator => SetMetadata(STARTS_JOB, { fromChat: options.fromChat === true, answersCaller: options.answersCaller === true })

// Handler classification (docs/AUTH.md "Roles and areas"). Every REST, tRPC and MCP handler is
// exactly one of: a feature handler (its feature's area, at read with `@Read()` or write by
// default), a core resource handler (`@Resource(kind)`), an authenticated core handler
// (`@Authenticated()`), a core-area handler (`@Area('signals' | 'ops')`), `@Admin()` or
// `@Public()`. Boot refuses a handler that is none of them (handler-map.ts).

/**
 * The handler changes nothing shared, so a `read` level reaches it. Write is the default. A read may
 * update only the caller's own per-user state (a seen watermark), and says so where it does; bulk
 * or shared mutations are never `@Read()`. Classified by side effects, not by HTTP verb.
 */
export const IS_READ = 'auth:read'
export const READ_UPKEEP = 'auth:read-upkeep'
/**
 * `upkeep` names deterministic housekeeping the read performs that no caller input steers (expiring
 * stale approvals by time, refreshing a cache of what an upstream reports). It runs as system work
 * (`asSystem`), so a read level never writes through the caller's own access.
 */
export const Read = (options: { upkeep?: string } = {}): MethodDecorator & ClassDecorator =>
  ((target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    SetMetadata(IS_READ, true)(target, key as string, descriptor as PropertyDescriptor)
    if (options.upkeep) SetMetadata(READ_UPKEEP, options.upkeep)(target, key as string, descriptor as PropertyDescriptor)
  }) as MethodDecorator & ClassDecorator

/**
 * A core handler that serves resources of several areas (a run of any action, any signal, any
 * board). The guard lets it through; the handler authorizes the actual resource through its core
 * accessor before any side effect.
 */
export const RESOURCE_KIND = 'auth:resource'
export const Resource = (kind: string): MethodDecorator & ClassDecorator => SetMetadata(RESOURCE_KIND, kind)

/**
 * A core handler any signed-in principal may call, whatever its areas: `me`, the own profile and
 * sidebar, the user directory, the roles list. The handler applies its own rule.
 */
export const IS_AUTHENTICATED = 'auth:authenticated'
export const Authenticated = (): MethodDecorator & ClassDecorator => SetMetadata(IS_AUTHENTICATED, true)

/** A core handler in one of the core areas (`signals`, `ops`), decided like a feature handler. */
export const CORE_AREA = 'auth:area'
export const Area = (area: 'signals' | 'ops'): MethodDecorator & ClassDecorator => SetMetadata(CORE_AREA, area)

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
