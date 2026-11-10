// The handler map (docs/AUTH.md "Roles and areas"): every REST route, tRPC procedure and MCP tool
// the server serves, with its owner and category, found once at boot from every Nest module's
// controllers and providers. AuthGuard decides each call from it. Boot refuses a handler that is
// unclassified, owned by two roots, or served over tRPC or MCP without AuthGuard: one mode, in the
// Stack and in a Box alike, with no default that guesses.
//
// Ownership is the module that DECLARES a controller or provider (Nest's `InstanceWrapper.host`),
// resolved to a root: a core module or a feature's root module. A root's tree is its imports,
// walked without entering another root, so importing another feature's module never transfers
// its handlers. A module reachable from two roots, or from none, owns nothing it may serve.

import { Injectable, type OnModuleInit, type Type } from '@nestjs/common'
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js'
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import type { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper.js'
import { MCP_METADATA, TRPC_METADATA } from '@silkweave/nestjs'
import { CORE_AREAS, agentToolset, levelCovers, levelOf, type Access, type AccessLevel, type SessionGrant } from '@silkweave/box-core'
import { CORE_AREA, IS_ADMIN, IS_AUTHENTICATED, IS_PUBLIC, IS_READ, READ_UPKEEP, RESOURCE_KIND, STARTS_JOB } from './auth.decorators.js'
import { AuthGuard } from './auth.guard.js'

export type HandlerCategory =
  | { kind: 'area'; area: string }
  | { kind: 'resource'; resource: string }
  | { kind: 'authenticated' }
  | { kind: 'admin' }
  | { kind: 'public' }

export interface HandlerPolicy {
  /** `Class.method`. */
  key: string
  /** `core` or a feature id. */
  owner: string
  category: HandlerCategory
  /** `@Read()`: a read level reaches it. */
  read: boolean
  /** `@Read({ upkeep })`: the deterministic housekeeping the read performs as system work. */
  upkeep?: string
  /** `@Admin()`: admin authority required on top of the category. */
  admin: boolean
  /** `@StartsJob()`: starts another agent job or session; never reachable with a session credential... */
  startsJob?: boolean
  /** ...except a chat serving session's, with `@StartsJob({ fromChat: true })`. */
  fromChat?: boolean
  /** `@StartsJob({ answersCaller: true })`: the output returns to the caller, not into the area. */
  answersCaller?: boolean
  rest?: string
  trpc?: string
  mcp?: string
}

export interface HandlerRoot {
  owner: string
  module: Type<unknown>
}

const VERBS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD', 'SEARCH']

let roots: readonly HandlerRoot[] = []
let policies: Map<Function, HandlerPolicy> | null = null

/** Name the roots before Nest initializes the application (app.module.ts). */
export function setHandlerRoots(next: readonly HandlerRoot[]): void {
  roots = next
}

/** The policy of a handler function, or null when it is not in the map (or the map is not built). */
export function handlerPolicy(handler: Function): HandlerPolicy | null {
  return policies?.get(handler) ?? null
}

/** The policy of a Box MCP tool by its action name (`crm-deals`), or null. */
export function mcpToolPolicy(actionName: string): HandlerPolicy | null {
  if (!policies) return null
  if (!byMcpName || byMcpNameOf !== policies) {
    byMcpName = new Map([...policies.values()].filter((p) => p.mcp).map((p) => [p.mcp!, p]))
    byMcpNameOf = policies
  }
  return byMcpName.get(actionName) ?? null
}
let byMcpName: Map<string, HandlerPolicy> | null = null
let byMcpNameOf: Map<Function, HandlerPolicy> | null = null

export type HandlerRefusal =
  | { reason: 'admin' }
  | { reason: 'area'; area: string; needed: AccessLevel }
  | { reason: 'session' }

/**
 * Whether `access` reaches a handler at the guard: admin authority for `@Admin()`, the area level
 * for an area handler. Resource handlers pass here and are decided by their accessor; authenticated
 * and public handlers pass. The one decision AuthGuard and the MCP tool list share.
 */
export function refusalFor(policy: HandlerPolicy, access: Access | null | undefined, session?: SessionGrant): HandlerRefusal | null {
  if (policy.category.kind === 'public') return null
  // A session credential reaches Box MCP tools only, and only its toolset's, on every transport:
  // a REST or tRPC call cannot reach what the session's MCP list hides.
  if (session) {
    if (!policy.mcp) return { reason: 'session' }
    if (policy.startsJob && !(policy.fromChat && servesChat(session))) return { reason: 'session' }
    const keep = session.toolset ? agentToolset(session.toolset)?.boxTools : null
    if (session.toolset && keep === undefined) return { reason: 'session' }
    if (keep && !keep.includes(policy.mcp)) return { reason: 'session' }
  }
  if (policy.admin && !access?.admin) return { reason: 'admin' }
  if (policy.category.kind === 'admin' && !access?.admin) return { reason: 'admin' }
  if (policy.category.kind === 'area') {
    const needed: AccessLevel = policy.read ? 'read' : 'write'
    if (!access || !levelCovers(levelOf(access, policy.category.area), needed)) return { reason: 'area', area: policy.category.area, needed }
  }
  return null
}

/** A chat serving session: a room or DM agent's turn (`room:<id>`), never a job's or a Work session's. */
function servesChat(session: SessionGrant): boolean {
  return session.kind === 'serving' && session.scope.startsWith('room:')
}

/** Every classified handler, for the contract tests and the docs. */
export function handlerPolicies(): HandlerPolicy[] {
  return [...(policies?.values() ?? [])].sort((a, b) => a.owner.localeCompare(b.owner) || a.key.localeCompare(b.key))
}

/** Install a map directly (unit tests of the guard). */
export function installHandlerPolicies(map: Map<Function, HandlerPolicy> | null): void {
  policies = map
}

/** Modules reachable from `root` through static and dynamic imports, without entering another root. */
function treeOf(root: Type<unknown>, otherRoots: Set<unknown>): Set<unknown> {
  const seen = new Set<unknown>()
  const visit = (entry: unknown): void => {
    if (!entry) return
    const resolved = typeof entry === 'object' && entry !== null && 'forwardRef' in entry ? (entry as { forwardRef: () => unknown }).forwardRef() : entry
    const meta = (resolved as { module?: unknown }).module ?? resolved
    if (seen.has(meta)) return
    if (meta !== root && otherRoots.has(meta)) return
    seen.add(meta)
    const imports = [...((Reflect.getMetadata('imports', meta as object) as unknown[] | undefined) ?? []), ...(((resolved as { imports?: unknown[] }).imports) ?? [])]
    for (const imp of imports) visit(imp)
  }
  visit(root)
  return seen
}

function verbOf(fn: Function): string | undefined {
  if (Reflect.getMetadata(PATH_METADATA, fn) === undefined) return undefined
  const code = Reflect.getMetadata(METHOD_METADATA, fn) as number | undefined
  return code === undefined ? undefined : VERBS[code]
}

export interface HandlerMapProblem {
  key: string
  problem: string
}

/** Build the map from Nest's discovered controllers and providers. Returns the problems found. */
export function buildHandlerMap(
  wrappers: { controllers: InstanceWrapper[]; providers: InstanceWrapper[] },
  reflector: Reflector,
  scanner: MetadataScanner,
  authGuard: Function,
  rootList: readonly HandlerRoot[] = roots,
): { map: Map<Function, HandlerPolicy>; problems: HandlerMapProblem[] } {
  const rootModules = new Set<unknown>(rootList.map((r) => r.module))
  const ownersOf = new Map<unknown, Set<string>>()
  for (const root of rootList) {
    for (const mod of treeOf(root.module, rootModules)) {
      ownersOf.set(mod, (ownersOf.get(mod) ?? new Set()).add(root.owner))
    }
  }
  const featureIds = new Set(rootList.map((r) => r.owner).filter((o) => o !== 'core'))
  const map = new Map<Function, HandlerPolicy>()
  const problems: HandlerMapProblem[] = []
  const seenClasses = new Map<Function, string>()

  const scan = (wrapper: InstanceWrapper, controller: boolean): void => {
    const metatype = wrapper.metatype as Function | null | undefined
    if (!metatype || typeof metatype !== 'function' || !metatype.prototype) return
    const proto = metatype.prototype as Record<string, unknown>
    const handlers = scanner.getAllMethodNames(proto).filter((name) => {
      const fn = proto[name]
      if (typeof fn !== 'function') return false
      const served = Boolean(Reflect.getMetadata(MCP_METADATA, fn) || Reflect.getMetadata(TRPC_METADATA, fn))
      return served || (controller && verbOf(fn) !== undefined)
    })
    if (!handlers.length) return
    const className = metatype.name
    const hostModule = wrapper.host?.metatype
    const owners = [...(ownersOf.get(hostModule) ?? [])]
    const previous = seenClasses.get(metatype)
    const owner = owners.length === 1 ? owners[0]! : null
    if (previous !== undefined && previous !== owner) {
      problems.push({ key: className, problem: `declared by two modules (${previous}, ${owner ?? 'none'})` })
      return
    }
    seenClasses.set(metatype, owner ?? '')
    for (const name of handlers) {
      const fn = proto[name] as Function
      const key = `${className}.${name}`
      if (!owner) {
        problems.push({ key, problem: owners.length ? `owned by several roots (${owners.join(', ')}); shared imports do not transfer ownership` : `its module ${hostModule?.name ?? '(unknown)'} belongs to no root` })
        continue
      }
      const targets = [fn, metatype]
      const isPublic = Boolean(reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets as never))
      const admin = Boolean(reflector.getAllAndOverride<boolean>(IS_ADMIN, targets as never))
      const read = Boolean(reflector.getAllAndOverride<boolean>(IS_READ, targets as never))
      const upkeep = reflector.getAllAndOverride<string>(READ_UPKEEP, targets as never)
      const starts = reflector.getAllAndOverride<{ fromChat: boolean; answersCaller: boolean } | undefined>(STARTS_JOB, targets as never)
      const startsJob = starts !== undefined
      const fromChat = starts?.fromChat === true
      const answersCaller = starts?.answersCaller === true
      const resource = reflector.getAllAndOverride<string>(RESOURCE_KIND, targets as never)
      const authenticated = Boolean(reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED, targets as never))
      const coreArea = reflector.getAllAndOverride<string>(CORE_AREA, targets as never)
      const marks = [resource ? '@Resource' : '', authenticated ? '@Authenticated' : '', coreArea ? '@Area' : ''].filter(Boolean)
      let category: HandlerCategory | null = null
      if (isPublic) {
        if (admin) problems.push({ key, problem: '@Public() and @Admin() together' })
        category = { kind: 'public' }
      } else if (marks.length > 1) {
        problems.push({ key, problem: `more than one category (${marks.join(', ')})` })
        continue
      } else if (owner !== 'core') {
        if (marks.length) {
          problems.push({ key, problem: `${marks[0]} is for core handlers; a feature handler is its feature's area` })
          continue
        }
        category = { kind: 'area', area: owner }
      } else if (resource) category = { kind: 'resource', resource }
      else if (authenticated) category = { kind: 'authenticated' }
      else if (coreArea) {
        if (!(CORE_AREAS as readonly string[]).includes(coreArea)) {
          problems.push({ key, problem: `@Area('${coreArea}') is not a core area` })
          continue
        }
        category = { kind: 'area', area: coreArea }
      } else if (admin) category = { kind: 'admin' }
      if (!category) {
        problems.push({ key, problem: 'unclassified core handler: mark it @Resource(kind), @Authenticated(), @Area(...), @Admin() or @Public()' })
        continue
      }
      if (category.kind === 'area' && !featureIds.has(category.area) && !(CORE_AREAS as readonly string[]).includes(category.area)) {
        problems.push({ key, problem: `area "${category.area}" is not an area of this Box` })
        continue
      }
      const mcpMeta = Reflect.getMetadata(MCP_METADATA, fn) as { name?: string } | undefined
      const trpcMeta = Reflect.getMetadata(TRPC_METADATA, fn) as { kind?: string } | undefined
      const verb = controller ? verbOf(fn) : undefined
      // tRPC and MCP run exactly the guards named in @UseGuards (silkweave), so a served method
      // without AuthGuard would never be decided. REST routes get the global guard.
      if (mcpMeta || trpcMeta) {
        const guards = [...((Reflect.getMetadata(GUARDS_METADATA, metatype) as unknown[] | undefined) ?? []), ...((Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[] | undefined) ?? [])]
        if (!guards.includes(authGuard)) {
          problems.push({ key, problem: 'served over tRPC or MCP without @UseGuards(AuthGuard)' })
          continue
        }
      }
      map.set(fn, {
        key,
        owner,
        category,
        read,
        ...(upkeep ? { upkeep } : {}),
        admin,
        ...(startsJob ? { startsJob } : {}),
        ...(fromChat ? { fromChat } : {}),
        ...(answersCaller ? { answersCaller } : {}),
        ...(verb ? { rest: verb } : {}),
        ...(trpcMeta ? { trpc: trpcMeta.kind ?? (verb === 'GET' ? 'query' : 'mutation') } : {}),
        // The action name silkweave gives the tool: its `name`, else `<Class without Controller>.<method>`.
        ...(mcpMeta ? { mcp: mcpMeta.name ?? `${className.replace(/Controller$/, '')}.${name}` } : {}),
      })
    }
  }
  for (const wrapper of wrappers.controllers) scan(wrapper, true)
  for (const wrapper of wrappers.providers) scan(wrapper, false)
  return { map, problems }
}

/** Builds the map at module init; a problem stops boot. */
@Injectable()
export class HandlerMap implements OnModuleInit {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    const { map, problems } = buildHandlerMap(
      { controllers: this.discovery.getControllers(), providers: this.discovery.getProviders() },
      this.reflector,
      this.scanner,
      AuthGuard,
    )
    if (problems.length) {
      throw new Error(`handler map: ${problems.length} handler${problems.length === 1 ? '' : 's'} cannot be served (docs/AUTH.md "Roles and areas"):\n  ${problems.map((p) => `${p.key}: ${p.problem}`).join('\n  ')}`)
    }
    policies = map
  }
}

/**
 * The wrappers Nest would discover, read from module metadata without instantiating anything: each
 * module reachable from the roots, with the controllers and providers it declares. For the contract
 * tests, which must not boot features.
 */
export function discoverStatically(rootList: readonly HandlerRoot[] = roots): { controllers: InstanceWrapper[]; providers: InstanceWrapper[] } {
  const controllers: InstanceWrapper[] = []
  const providers: InstanceWrapper[] = []
  const seen = new Set<unknown>()
  const visit = (entry: unknown): void => {
    if (!entry) return
    const resolved = typeof entry === 'object' && entry !== null && 'forwardRef' in entry ? (entry as { forwardRef: () => unknown }).forwardRef() : entry
    const meta = (resolved as { module?: unknown }).module ?? resolved
    if (seen.has(meta)) return
    seen.add(meta)
    const host = { metatype: meta } as InstanceWrapper['host']
    const list = (key: string): unknown[] => [...((Reflect.getMetadata(key, meta as object) as unknown[] | undefined) ?? []), ...(((resolved as Record<string, unknown[] | undefined>)[key]) ?? [])]
    for (const c of list('controllers')) controllers.push({ metatype: c, host } as unknown as InstanceWrapper)
    for (const p of list('providers')) {
      const metatype = typeof p === 'function' ? p : (p as { useClass?: unknown }).useClass
      if (typeof metatype === 'function') providers.push({ metatype, host } as unknown as InstanceWrapper)
    }
    for (const imp of list('imports')) visit(imp)
  }
  for (const root of rootList) visit(root.module)
  return { controllers, providers }
}
