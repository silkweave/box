import type { IncomingMessage, ServerResponse } from 'node:http'
import { PassThrough, type Duplex } from 'node:stream'
import type { SessionInfo } from '@workerdeck/protocol'
import { AGENT_SESSION_APP, SESSION_COOKIE, agentEnginesFor, agentSessionAccess, agentProfileFor, agentProfileMapFor, agentProfilesConfigured, preferredAgentEngine, authenticatePrincipal, parseCookies, resolvePrincipalById, verifySession, type Principal } from '@silkweave/box-core'
import { AGENT_AUTH, agentWorkerUrl, workerdeckHost, type AgentAuth, type AuthedRequest } from './workerdeck.host.js'
import { relayReadOnly } from './session-relay.js'
import { applyBuilderSessionPolicy, BuilderSessionPolicyError } from './builder-session-policy.js'
import { trackBuilderControl } from './builder-control.js'
import { repoRoot } from '@silkweave/box-core'

/**
 * The browser's door onto the IN-PROCESS workerdeck (agent/workerdeck.host.ts, docs/SERVER.md).
 *
 * PHASE 2 of the merge. Until 2026-09-02 this was a reverse proxy (`agent.proxy.ts`, now deleted)
 * that re-issued every request over a loopback socket to a worker that happened to be in the same
 * process. It is now a mount: the Box authenticates the caller, gates the request, rewrites the path,
 * and hands the SAME req/res straight to `worker.server` via `emit('request')` / `emit('upgrade')`.
 * No second socket, no second HTTP parse, no shared secret on the browser path.
 *
 * This server keeps the listener rather than handing the socket to workerdeck with its `fallback`
 * option, and that direction is deliberate: workerdeck's own upgrade listener `socket.destroy()`s
 * every upgrade that is not a session WS, so Vite's HMR socket would need exactly the surgery this
 * avoids. main.ts stays the one upgrade dispatcher.
 *
 * These run as plain express layers AHEAD of Nest's router, so they enforce the Box's rules themselves
 * (same as AuthGuard: principal required, collaborators excluded, CSRF header on cookie-authed
 * mutations; transition mode passes everything through).
 *
 * ENFORCEMENT IS TWO INDEPENDENT LAYERS. Layer A is here - the URL gates and the create stamp.
 * Layer B is inside workerdeck, driven by the `AgentAuth` this module stashes on the request (see
 * workerdeck.host.ts): `allowedProfiles`, `scope`, `operator: false`, `authorizeSession`. Layer B
 * is what makes the profile bound PATH-INDEPENDENT, which a string gate can never be.
 *
 * ONE GRANT CROSSES THE LAYERS THE OTHER WAY (2026-09-02): a room's readers may READ that room's
 * @nova turn. Layer A contributes the one fact only it knows - whether THIS request can change a
 * session - as `readOnly` on the AgentAuth, by HTTP METHOD rather than by URL (GET/HEAD and nothing
 * else), so it holds on a worker route this module has never heard of. Layer B decides the rest
 * from the session's own record and the chat store's membership predicate. The attach socket is
 * the one surface a method cannot describe, so readers never get the worker's socket at all: the
 * upgrade handler hands them a relay whose inbound side goes nowhere (session-relay.ts).
 */

/** Matches the reserved /agent prefix (REST and WS upgrades alike). */
export const AGENT_PATH = /^\/agent(\/|$)/

/**
 * The path the routing decisions below compare against - NEVER what gets dispatched.
 *
 * The worker routes `/v1/sessions` and `/v1/sessions/` to the same create handler (its `parseRoute`
 * treats a bare trailing slash as the collection), so an exact-string gate is bypassable by typing
 * one extra `/`: the create would skip the profile stamp and honor a client-chosen `profile`, i.e.
 * run as anyone. Duplicate slashes collapse for the same reason. Normalizing only the comparison
 * keeps the worker authoritative about what a URL means - and since phase 2, layer B refuses the
 * same thing again from inside the worker even if this normalization is ever wrong.
 */
const gatePath = (path: string): string => path.replace(/\/{2,}/g, '/').replace(/(.)\/+$/, '$1')

/** Worker mutations that would create work WITHOUT passing through `gateCreate`'s profile stamp. */
const UNSTAMPED_WRITE = /^\/agent\/v1\/(jobs|queue)(\/|$)/

/**
 * Worker surfaces the sidebar has no business reaching, refused for EVERY method.
 *
 * `/v1/fs/*` serves the host filesystem: list, fuzzy-find, read, and - with `hostFiles.write` -
 * write. It is off on our instance (`hostFiles: { roots: [] }`, so the routes 404), and a Box
 * principal is not an operator, so the worker 404s it a second time. This is the third lock: the
 * routes mount on `allowedCwdRoots` alone, needing no grant of their own, so a future roots change
 * would otherwise silently publish the Box checkout - `box.local.json` included - to every signed-in user.
 *
 * Deliberately NOT in `UNSTAMPED_WRITE`: that gate only fires on mutating methods, and the
 * exposure here is `GET /v1/fs/read`. A write-only gate on a read hole is the wrong shape.
 */
const NOT_EXPOSED = /^\/agent\/v1\/fs(\/|$)/

/** Feature switch: undefined until (and unless) the in-process host booted (hides the sidebar). */
export { agentWorkerUrl }

/** Worker session statuses after which a session no longer counts as "the user's active agent". */
const TERMINAL_STATUS = new Set<SessionInfo['status']>(['failed', 'closed'])

/**
 * Methods that cannot change a session, i.e. the only ones a room reader's entitlement applies to.
 *
 * By method, deliberately not by URL: every read of a session in @workerdeck/server 1.1.0 is a GET
 * (info, list, attachment and produced-file downloads, tool-result bodies, MCP status, the VFS), and
 * every write is not (PATCH rename, DELETE, POST permissions/attachments/mcp, POST executions), so
 * the HTTP contract is the boundary and it needs no route table to stay correct. OPTIONS is left
 * out: it never reads anything, and a grant that buys nothing is one more thing to reason about.
 */
const READ_METHODS = new Set(['GET', 'HEAD'])

/** The attach socket, on the normalized path. The one URL layer A parses on the upgrade path, and only to choose the relay - a miss falls through to the worker, which refuses a non-owner. */
const ATTACH_PATH = /^\/agent\/v1\/sessions\/([^/]+)\/ws$/
/** WorkerDeck's account routes: POST .../account/connect, POST .../account/complete, DELETE .../account. */
const ACCOUNT_PATH = /^\/agent\/v1\/profiles\/[^/]+\/account(\/(connect|complete))?$/

/** Attach query parameters the relay carries upstream. A whitelist: the upstream URL carries the boot key, and nothing a browser chose belongs next to it. */
const ATTACH_PARAMS = ['afterSeq', 'truncateResults', 'imageRefs'] as const

const MAX_CREATE_BODY = 1024 * 1024

export interface AgentMount {
  /** Express-style middleware: auth + the gates, then dispatch. Register before the dev proxy. */
  middleware: (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => void
  /** Upgrade handler for /agent websockets - dispatch from the raw http.Server (see main.ts). */
  upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
}

interface AuthzResult {
  principal: Principal | null
  rejection: { status: number; error: string } | null
}

/** Mirror of AuthGuard.resolve + its enforcement rules, usable outside Nest's pipeline. */
async function authorize(req: IncomingMessage, mutating: boolean): Promise<AuthzResult> {
  let principal: Principal | null = null
  let viaBearer = false
  const authz = req.headers.authorization
  if (authz && /^Bearer\s+/i.test(authz)) {
    principal = await authenticatePrincipal(authz.replace(/^Bearer\s+/i, '').trim())
    viaBearer = true
  } else {
    const claims = verifySession(parseCookies(req.headers.cookie)[SESSION_COOKIE])
    principal = claims ? await resolvePrincipalById(claims.sub) : null
  }
  if (!principal) return { principal, rejection: { status: 401, error: 'sign in required' } }
  if (mutating && !viaBearer && !req.headers['x-box-csrf']) {
    return { principal, rejection: { status: 403, error: 'missing CSRF header' } }
  }
  return { principal, rejection: null }
}

/**
 * Layer B's view of this caller, on THIS request.
 *
 * `allowedProfiles` is left undefined when the deployment pins no profiles at all (no
 * with no agentProfiles map - a single-operator box, where the worker resolves its one profile
 * implicitly). Where it IS pinned, an unmapped user gets `[]`, which refuses every profile - the
 * right answer, and the same one layer A's create gate gives.
 *
 * `readOnly` is the request's, not the person's (workerdeck.host.ts § AgentAuth): true only when
 * the method cannot change a session. The upgrade handler passes false unconditionally.
 */
const agentAuthFor = (principal: Principal | null, readOnly: boolean): AgentAuth =>
  principal
    ? {
        via: 'box',
        user: principal.id,
        admin: principal.role === 'admin',
        ...(agentProfilesConfigured() ? { allowedProfiles: Object.values(agentProfileMapFor(principal.id)) } : {}),
        scope: { user: principal.id },
        operator: false,
        canManageProfiles: false,
        readOnly,
      }
    : { via: 'anon', operator: false, canManageProfiles: false }

const respond = (res: ServerResponse, status: number, body: unknown): void => {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}

/** `/agent/v1/sessions` -> `/v1/sessions`; a bare `/agent` -> `/`. */
const workerUrl = (url: string): string => url.replace(/^\/agent/, '') || '/'

/**
 * Hand the request to the worker with the caller's AgentAuth attached.
 *
 * The client's own `x-workerdeck-key` is dropped first. It cannot actually do anything - the
 * stashed symbol short-circuits the header check in `authenticate` - but leaving an attacker-chosen
 * credential header on a request we are about to hand to another component is the kind of thing
 * that becomes true later.
 */
const stash = (req: IncomingMessage, auth: AgentAuth): void => {
  delete req.headers['x-workerdeck-key']
  ;(req as AuthedRequest)[AGENT_AUTH] = auth
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_CREATE_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A request the worker can read a body from, standing in for one this module already drained.
 *
 * The create gate has to parse the JSON to stamp `meta` and the profile, which consumes the stream
 * - and an IncomingMessage that has emitted 'end' cannot be rewound. So the worker gets a fresh
 * readable carrying the REWRITTEN body, wearing the original's method/url/headers. That is the
 * whole contract: workerdeck touches `req.method`, `req.url`, `req.headers` and iterates the
 * stream, nothing else (the socket is carried over anyway, for anything that reaches for it).
 */
const replayRequest = (req: IncomingMessage, url: string, body: Buffer, auth: AgentAuth): IncomingMessage => {
  const stream = new PassThrough()
  const replay = Object.assign(stream, {
    url,
    method: req.method,
    // content-length must describe the body we are actually sending, not the one we were sent:
    // the stamp adds fields, so the rewritten JSON is a different length.
    headers: { ...req.headers, 'content-length': String(body.length) },
    httpVersion: req.httpVersion,
    socket: req.socket,
    [AGENT_AUTH]: auth,
  }) as unknown as IncomingMessage
  stream.end(body)
  return replay
}

export function createAgentMount(): AgentMount | undefined {
  const host = workerdeckHost()
  if (!host) return undefined
  const { worker } = host
  const creating = new Set<string>()

  /** Every session the worker knows about, live or parked - what its own GET /v1/sessions lists. */
  const allSessions = async (): Promise<SessionInfo[]> => [
    ...worker.registry.list(),
    ...(await worker.parking.listInfo()),
  ]

  /**
   * One agent per user: POST /agent/v1/sessions is rejected with 409 while a non-terminal Box
   * session for the same user exists on the worker (the registry is the source of truth). Identity
   * is the signed-in principal when there is one; in transition mode the client-stamped
   * `meta.user` (the localStorage picker) is accepted as-is.
   */
  async function gateCreate(
    req: IncomingMessage,
    res: ServerResponse,
    principal: Principal | null,
    auth: AgentAuth,
  ): Promise<void> {
    let body: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse((await readBody(req)) || '{}')
      if (!isRecord(parsed)) throw new Error('not an object')
      body = parsed
    } catch {
      respond(res, 400, { error: 'invalid JSON body' })
      return
    }
    const meta = isRecord(body.meta) ? body.meta : {}
    const user = principal?.id ?? (typeof meta.user === 'string' ? meta.user : undefined)
    body.meta = {
      ...meta,
      app: AGENT_SESSION_APP,
      ...(user ? { user } : {}),
      ...(principal ? { display: principal.display } : {}),
    }
    // Whose account runs this: the profile is resolved HERE from the identity, never taken from the
    // client (it selects a CLAUDE_CONFIG_DIR or a CODEX_HOME - settings, memory, skills,
    // credentials - so letting a browser name it would let anyone run as anyone). Unmapped is
    // refused rather than left to the worker's own resolution. With no mapping file
    // (single-operator box) nothing is stamped and the worker resolves its one profile implicitly.
    //
    // Since phase 2 this stamp is a convenience, not the boundary: `auth.allowedProfiles` refuses
    // the same thing from inside the worker, on this route and every other one.
    //
    // The client MAY name an `engine`, and that is safe where naming a profile is not: it selects
    // among THIS user's own profiles, so the worst it can do is run them on their own other
    // account. It never widens who they are. The engine is consumed here and stripped from the
    // body - the worker's create takes a `profile`, and the engine is a property of that profile.
    const engine =
      typeof body.engine === 'string' && body.engine
        ? body.engine
        : user
          ? preferredAgentEngine(user)
          : ''
    delete body.engine
    delete body.profile
    try {
      await applyBuilderSessionPolicy(body, principal, engine, repoRoot())
    } catch (error) {
      if (error instanceof BuilderSessionPolicyError) {
        respond(res, error.status, { error: error.message })
        return
      }
      throw error
    }
    if (agentProfilesConfigured()) {
      if (!user) {
        respond(res, 403, { error: 'agent_profile_unmapped', user: null })
        return
      }
      const profile = agentProfileFor(user, engine)
      if (!profile) {
        // Distinguish "you are not mapped at all" from "you are, but not for this engine" - the
        // remedies differ (ask an admin vs. run `codex <you> login` and get declared).
        const available = agentEnginesFor(user)
        respond(res, 403, {
          error: available.length > 0 ? 'agent_engine_unmapped' : 'agent_profile_unmapped',
          user,
          engine,
          ...(available.length > 0 ? { engines: available } : {}),
        })
        return
      }
      body.profile = profile
    }
    if (user) {
      const active = (await allSessions()).find(
        (s) => s.meta?.app === AGENT_SESSION_APP && s.meta?.user === user && !TERMINAL_STATUS.has(s.status),
      )
      if (active) {
        respond(res, 409, { error: 'agent_active', session: active })
        return
      }
    }
    const rewritten = Buffer.from(JSON.stringify(body), 'utf8')
    worker.server.emit('request', replayRequest(req, workerUrl(req.url ?? '/'), rewritten, auth), res)
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): Promise<void> {
    const path = (req.url ?? '/').split('?', 1)[0]
    if (!AGENT_PATH.test(path)) {
      next()
      return
    }
    const method = (req.method ?? 'GET').toUpperCase()
    const mutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
    const { principal, rejection } = await authorize(req, mutating)
    if (rejection) {
      respond(res, rejection.status, { error: rejection.error })
      return
    }
    const gated = gatePath(path)
    let auth = agentAuthFor(principal, READ_METHODS.has(method))
    // An admin may connect or disconnect anyone's agent account (Settings > Agent accounts, D3), so
    // their profile pin is lifted on exactly these routes. WorkerDeck's `accounts.canConnect` still
    // decides (workerdeck.host.ts); a member keeps their pin and reaches only their own profiles.
    if (auth.via === 'box' && auth.admin === true && ACCOUNT_PATH.test(gated)) {
      const { allowedProfiles: _pin, ...unpinned } = auth
      auth = unpinned
    }
    // The job queue is not part of the sidebar's surface and a job body carries its OWN `session`
    // (profile and cwd included), which gateCreate never sees - so the day a queue is configured on
    // the worker it would be an unstamped way to run as anyone. Refuse the writes now rather than
    // inherit the hole later; the worker answers 404 for these today.
    if (mutating && UNSTAMPED_WRITE.test(gated)) {
      respond(res, 403, { error: 'agent_queue_not_exposed' })
      return
    }
    // Every method, not just the mutating ones - the host-filesystem read is the exposure.
    if (NOT_EXPOSED.test(gated)) {
      respond(res, 403, { error: 'agent_host_fs_not_exposed' })
      return
    }
    if (method === 'POST' && gated === '/agent/v1/sessions') {
      const user = principal!.id
      if (creating.has(user)) {
        respond(res, 409, { error: 'agent_starting' })
        return
      }
      creating.add(user)
      const release = (): void => { creating.delete(user) }
      res.once('finish', release)
      res.once('close', release)
      try {
        await gateCreate(req, res, principal, auth)
      } catch (error) {
        release()
        throw error
      }
      return
    }
    stash(req, auth)
    req.url = workerUrl(req.url ?? '/')
    worker.server.emit('request', req, res)
  }

  /**
   * The loopback attach URL for a room reader's relay, or null when this upgrade is not that case
   * (an owner, an unknown or parked session, a room the caller cannot read, an unparseable URL) -
   * every one of which goes to the worker as before, where a non-owner is refused with 404.
   *
   * Registry only, never `parking.get`: the worker's own upgrade path calls `parking.ensureLive`,
   * which WAKES a parked session - spawning nova's engine on a reader's click. A parked room session
   * has nothing live to watch anyway (the chat agent closes its sessions rather than parking them,
   * and a closed runner stays in the registry with its log until a restart, which is why an ended
   * turn's transcript can still be read). The verdict re-runs the same rule layer B applies, so
   * the two can only disagree if this URL parse does - and then the worker has the last word.
   */
  const readerRelayUrl = (url: string, user: string): string | null => {
    const parsed = new URL(url, 'http://internal')
    const match = ATTACH_PATH.exec(gatePath(parsed.pathname))
    if (!match) return null
    let id: string
    try {
      id = decodeURIComponent(match[1])
    } catch {
      return null
    }
    const runner = worker.registry.get(id)
    if (!runner) return null
    if (agentSessionAccess(user, runner.info()).kind !== 'reader') return null
    // Built the way `hostAuth` builds the chat agent's own attach URL: `?key=` on the loopback
    // listener, which is the one transport a socket handshake has for a credential.
    const upstream = new URL(`${host.url}/v1/sessions/${encodeURIComponent(id)}/ws`)
    upstream.protocol = 'ws:'
    for (const name of ATTACH_PARAMS) {
      const value = parsed.searchParams.get(name)
      if (value !== null) upstream.searchParams.set(name, value)
    }
    upstream.searchParams.set('key', host.key)
    return upstream.toString()
  }

  return {
    middleware: (req, res, next) => {
      handle(req, res, next).catch((err: unknown) => next(err))
    },
    upgrade: (req, socket, head) => {
      void (async () => {
        const { principal, rejection } = await authorize(req, false)
        if (rejection) {
          socket.write(`HTTP/1.1 ${rejection.status} ${rejection.status === 401 ? 'Unauthorized' : 'Forbidden'}\r\n\r\n`)
          socket.destroy()
          return
        }
        // Never read-only, whoever is asking: an upgrade is a GET on the wire, and it is the one
        // GET that opens a channel that writes. The room reader's case is served without ever
        // handing the worker this socket.
        const auth = agentAuthFor(principal, false)
        // Track authenticated sockets so a role change closes existing control channels too.
        // Tracking all of an admin's agent sockets covers a dormant Builder session waking below.
        if (principal?.role === 'admin') {
          const untrack = trackBuilderControl(principal.id, () => socket.destroy())
          socket.once('close', untrack)
        }
        const relay = auth.via === 'box' ? readerRelayUrl(req.url ?? '/', auth.user) : null
        if (relay !== null) {
          relayReadOnly({ upstreamUrl: relay, req, socket, head })
          return
        }
        stash(req, auth)
        req.url = workerUrl(req.url ?? '/')
        worker.server.emit('upgrade', req, socket, head)
      })().catch(() => socket.destroy())
    },
  }
}
