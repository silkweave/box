import { createRequire } from 'node:module'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { IncomingMessage } from 'node:http'
import { createFileSessionStore, createMemoryProfileStore, createWorkerServer, type WorkerServer, type WorkerServerOptions } from '@workerdeck/server'
import type { CreateJobRequest, JobEvent, JobInfo, ProfileInfo, SessionEvent, SessionInfo } from '@workerdeck/protocol'
import { agentProfileMapFor, agentSessionAccess, repoRoot, resolvePrincipalById } from '@silkweave/box-core'
import { DEFAULT_QUEUE, parkedDir, readWorkerdeckConfig, type UnattendedPermissionMode, type WorkerdeckConfig, type WorkerdeckProfile } from './workerdeck.config.js'
import { revokeBuilderControl, trackBuilderControl } from './builder-control.js'

/**
 * Boots workerdeck INSIDE this server's process (see docs/SERVER.md).
 *
 * It runs here API-only: no dashboard (`@workerdeck/web` is not installed) and no configured
 * secret, because there is no network hop to authenticate. What it declares comes from
 * `box.json`'s `workerdeck` section (workerdeck.config.ts); null means no agent surface, and the rest of
 * the Box is unaffected.
 *
 * The listener this module opens is NOT the browser's path. Browser traffic arrives through this
 * server's own express stack under /agent and is handed to `worker.server` in-process. This
 * listener exists for exactly one caller: the chat agent, which drives a real WorkerDeckClient (the
 * attach protocol - replay-from-seq, outbox, permission frames - is what chat is built on, so it
 * keeps a real socket rather than an in-process shim).
 *
 * It binds loopback on an OS-assigned port. Loopback is NOT a trust boundary: other services share
 * it, and every agent session this Box spawns can reach it, so a session under one profile could
 * otherwise create a session under another. Hence the boot key below.
 */

/** Per-boot credential for the loopback listener. Never written to disk, never in process.env,
 *  never in a session env - so unlike a configured secret it cannot be read by a session that can
 *  already `cat` the repo's box.local.json. Regenerated every boot; the only holder is this closure. */
const BOOT_KEY = randomBytes(32).toString('hex')
const BOOT_KEY_DIGEST = createHash('sha256').update(BOOT_KEY).digest()

const digestEquals = (provided: string): boolean => {
  const given = createHash('sha256').update(provided).digest()
  return given.length === BOOT_KEY_DIGEST.length && timingSafeEqual(given, BOOT_KEY_DIGEST)
}

/**
 * What `authenticate` hands workerdeck, i.e. LAYER B of the two-layer enforcement (docs/SERVER.md).
 *
 * Layer A is the Box's own pre-handler gate in `agent.mount.ts` - it matches URLs as strings, which is
 * exactly the kind of check one extra `/` can slip past. Layer B is inside workerdeck and is
 * path-independent: it is consulted by `resolveProfile`, `applyScope` and `canSee` wherever they
 * happen to run, so the profile bound holds on every route at once, present and future.
 *
 * Three shapes, one per door:
 * - `host` - the loopback listener, i.e. the @nova chat agent's own client, holding the boot key.
 *   An operator: it owns the sessions it creates and there is no user to scope it to.
 * - `box` - a signed-in Box principal arriving through the in-process mount. Bounded to their own
 *   profiles and their own `scope.user`, and NOT an operator (which is what 404s /v1/fs and
 *   /v1/sdk-sessions at the worker, independently of layer A's own refusals).
 * - `anon` - the mount with AUTH_REQUIRED off (transition mode, dev only). There is no identity to
 *   scope by, so there is no boundary here either; that is inherent to running without auth, and
 *   is why AUTH_REQUIRED=0 belongs on a local throwaway boot and nowhere else.
 */
export type AgentAuth =
  | { via: 'host'; operator: true; canManageProfiles: false }
  | {
      via: 'box'
      user: string
      /** Resolved from Box on this request, never supplied by the browser. */
      admin?: boolean
      /** Undefined = this deployment does not pin profiles at all (no agentProfiles map). */
      allowedProfiles?: string[]
      scope: { user: string }
      operator: false
      canManageProfiles: false
      /**
       * This REQUEST cannot change a session, so a room reader's entitlement applies to it.
       *
       * Per request, not per person: the same `alice` is `readOnly: true` on `GET /v1/sessions/:id`
       * and `readOnly: false` on `DELETE` of the same URL. The mount sets it for GET/HEAD REST calls
       * and for nothing else - never for an upgrade, because the attach socket is bidirectional and
       * "read-only" is not a thing an HTTP method can promise about it (session-relay.ts). A
       * caller constructed without it fails closed: the reader branch of `authorizeSession`
       * requires it to be literally `true`.
       */
      readOnly: boolean
    }
  | { via: 'anon'; operator: false; canManageProfiles: false }

/**
 * Where the mount stashes the caller's AgentAuth on the request object.
 *
 * A symbol rather than a header precisely because it CANNOT ride the wire: a request that arrived
 * on the loopback listener is a fresh IncomingMessage and can never carry it, so a session that
 * can reach 127.0.0.1 cannot forge a Box principal. And a mounted request that somehow reaches
 * `authenticate` without it falls through to the boot-key check and 401s - fail closed.
 */
export const AGENT_AUTH = Symbol('box.agent.auth')

export type AuthedRequest = IncomingMessage & { [AGENT_AUTH]?: AgentAuth }

/**
 * A `KEY=value` file, parsed by hand rather than with `process.loadEnvFile`.
 *
 * loadEnvFile would mutate THIS process's environment, piling every person's tokens into one shared
 * env which then leaks into everyone's sessions. The values here are per-PERSON secrets and this
 * process is the whole Box's, so they must only ever be assembled into one session's env.
 */
const readEnvFile = (path: string): Record<string, string> => {
  if (!existsSync(path)) return {}
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq > 0) out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return out
}

/** Resolve the bundled codex binary exactly the way @workerdeck/core does, so a missing platform
 *  package is a loud boot failure instead of a per-session `@openai/codex is not installed`. */
const codexBinaryResolves = (): boolean => {
  try {
    const fromCore = createRequire(createRequire(import.meta.url).resolve('@workerdeck/core'))
    fromCore.resolve('@openai/codex/package.json')
    return true
  } catch {
    return false
  }
}

export interface WorkerdeckHost {
  worker: WorkerServer
  url: string
  key: string
  profiles: ProfileInfo[]
  config: WorkerdeckConfig
}

const jobListeners = new Set<(event: JobEvent) => void>()

/**
 * Observe every job event of the queue (agent triggers follow their runs here). Returns the
 * unsubscribe. Listeners are best-effort: one that throws never affects the queue or the others.
 */
export function onJobEvent(listener: (event: JobEvent) => void): () => void {
  jobListeners.add(listener)
  return () => {
    jobListeners.delete(listener)
  }
}

function emitJobEvent(event: JobEvent): void {
  for (const listener of jobListeners) {
    try {
      listener(event)
    } catch (err) {
      console.error(`  agent: job listener failed - ${String((err as Error)?.message ?? err)}`)
    }
  }
}

/** The unattended permission mode: box.json `workerdeck.queue.permissionMode` (default `auto`). */
export function unattendedPermissionMode(): UnattendedPermissionMode {
  return host?.config.queue.permissionMode ?? DEFAULT_QUEUE.permissionMode
}

/**
 * Answer a pending approval on a live session with a denial (an unattended run has nobody to ask).
 * False when the session or the request is gone.
 */
export function denyAgentPermission(sessionId: string, requestId: string, message: string): boolean {
  return host?.worker.registry.get(sessionId)?.resolvePermission(requestId, { behavior: 'deny', message }) ?? false
}

/**
 * Follow one live session's events, replayed from its start. The queue relays only its own job
 * events; what the engine reports beside them (a tool call the auto-mode classifier denied, as an
 * `sdk_event`) is read here. Null when the session is not live on this worker.
 */
export function onSessionEvent(sessionId: string, listener: (event: SessionEvent) => void): (() => void) | null {
  const runner = host?.worker.registry.get(sessionId)
  return runner ? runner.subscribe(listener, 0) : null
}

/**
 * Submit an unattended agent job. It goes through the loopback listener's `POST /v1/jobs` as the
 * host principal, so the worker vets it like any session create (profile, cwd inside cwdRoots,
 * permission mode) instead of this process handing the queue an unchecked request.
 */
export async function submitAgentJob(request: CreateJobRequest): Promise<JobInfo> {
  if (!host) throw new Error('the agent surface is not running (box.json workerdeck)')
  const res = await fetch(`${host.url}/v1/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${host.key}` },
    body: JSON.stringify(request),
  })
  const body = (await res.json().catch(() => ({}))) as { job?: JobInfo; error?: string }
  if (!res.ok || !body.job) throw new Error(`job refused (${res.status}): ${body.error ?? 'no detail'}`)
  return body.job
}

/** A configured profile with its live account state, for Settings > Profile. */
export interface AgentAccountProfile {
  name: string
  person: string
  engine: 'claude' | 'codex'
  description: string | null
  /** Settings can connect it: Claude by setup-token, Codex by device sign-in (WorkerDeck 3.10). */
  connectable: boolean
  account: { connectedAt: string; expiresAt: string } | null
  available: boolean | null
  unavailableReason: string | null
}

/**
 * Every configured profile with WorkerDeck's own view of it (account, availability), read over the
 * loopback listener as the host so the list is not narrowed to one person's profiles. Callers filter
 * by who is asking (agent.controller.ts).
 */
export async function agentAccountProfiles(): Promise<AgentAccountProfile[]> {
  if (!host) return []
  const res = await fetch(`${host.url}/v1/profiles`, { headers: { authorization: `Bearer ${host.key}` } })
  if (!res.ok) throw new Error(`profile list refused (${res.status})`)
  const live = new Map(((await res.json()) as { profiles: ProfileInfo[] }).profiles.map((p) => [p.name, p]))
  return host.config.profiles.map((p) => {
    const info = live.get(p.name)
    return {
      name: p.name,
      person: p.person,
      engine: p.engine,
      description: p.description ?? null,
      connectable: true,
      account: info?.account ? { connectedAt: info.account.connectedAt, expiresAt: info.account.expiresAt } : null,
      available: typeof info?.available === 'boolean' ? info.available : null,
      unavailableReason: info?.unavailableReason ?? null,
    }
  })
}

/** Cancel a queued or running job. Null when the queue does not know it. */
export async function cancelAgentJob(id: string): Promise<JobInfo | null> {
  return (await host?.worker.queue?.cancel(id)) ?? null
}

let host: WorkerdeckHost | undefined

/** The booted host, for the in-process mount in agent.mount.ts. Undefined until it boots. */
export const workerdeckHost = (): WorkerdeckHost | undefined => host

/** Feature switch + the chat agent's target. Undefined until (and unless) the host boots. */
export const agentWorkerUrl = (): string | undefined => host?.url
/** The loopback listener's credential, for the chat agent's own client. */
export const proxyKey = (): string | undefined => host?.key

export async function bootWorkerdeck(): Promise<WorkerdeckHost | undefined> {
  const deployment = readWorkerdeckConfig({ repoRoot: repoRoot() })
  if (!deployment) {
    console.log('  agent: off (workerdeck is not configured in box.json)')
    return undefined
  }
  if (deployment.pending.length > 0) {
    // Named rather than passed over silently, so the log says who still owes a login. A declared
    // profile whose home is missing is a hard createWorkerServer failure, and that once crash-looped
    // the service under a supervisor - one person's pending login must not be an outage.
    console.warn(`  agent: no home yet, not declaring ${deployment.pending.map((p) => p.name).join(', ')}`)
  }
  if (deployment.profiles.some((p) => p.engine === 'codex') && !codexBinaryResolves()) {
    throw new Error(
      '@openai/codex does not resolve from @workerdeck/core - every codex session would fail at create. ' +
        'It is an OPTIONAL PEER of core, so apps/server must declare it for Bun to link it.',
    )
  }

  // `connectors: false` on every profile (owner decision 2026-10-08): claude.ai connectors never run
  // in Box sessions, which use Box-managed MCP servers instead. A setup-token carries no connector
  // scope anyway; this also stops a full login's connectors from appearing.
  const profiles: ProfileInfo[] = deployment.profiles.map((p) =>
    p.engine === 'codex'
      ? { name: p.name, engine: 'codex', codexHome: p.home, defaults: p.defaults, description: p.description }
      : { name: p.name, engine: 'claude', configDir: p.home, description: p.description, connectors: false },
  ) as ProfileInfo[]

  const byName = new Map<string, WorkerdeckProfile>(deployment.profiles.map((p) => [p.name, p]))
  const canConnectAccount = (auth: AgentAuth | undefined, profile: string): boolean => {
    if (auth?.via !== 'box') return false
    if (auth.admin === true) return true
    return byName.get(profile)?.person === auth.user || Object.values(agentProfileMapFor(auth.user)).includes(profile)
  }

  const options: WorkerServerOptions = {
    basePath: '/v1',
    // A profile STORE, not `profiles`: WorkerDeck refuses account connect (403) for profiles declared
    // in server options. The store is rebuilt from box.local.json on every boot, so box.local.json
    // stays the source of truth; nobody may edit it over the API (every principal below has
    // `canManageProfiles: false`, so PATCH/DELETE/POST /v1/profiles answer 403).
    profileStore: createMemoryProfileStore(profiles),
    // Required for managed claude/codex profiles: each one's config dir must sit under a root. The
    // roots are the configured dirs' own parents (the person's home), nothing wider.
    allowedConfigDirRoots: [...new Set(deployment.profiles.map((p) => dirname(p.home)))],
    // Settings > Profile (docs/SERVER.md, "Agent accounts"). WorkerDeck runs `claude setup-token`, keeps
    // the token in <configDir>/workerdeck-account.json and injects it into that profile's sessions.
    // A person connects their own profiles; an admin may connect anyone's (D3). The host principal
    // (the chat agent's loopback client) never may.
    // Codex profiles connect by device sign-in (a user code on the ChatGPT page, no paste). Under
    // Bun, WorkerDeck's loadPty picks Bun's own PTY (node-pty never starts the child there).
    accounts: {
      canConnect: (principal, profile) => canConnectAccount(principal as AgentAuth | undefined, profile.name),
    },
    allowedCwdRoots: deployment.cwdRoots,
    // Host filesystem routes OFF. They mount on allowedCwdRoots alone, needing no grant of their
    // own, so leaving them on would publish the whole checkout - box.local.json included - as an
    // authenticated GET. An explicit [] 404s them. `operator: false` is the second lock.
    hostFiles: { roots: [] },
    // Bypass for jobs only. Sessions, agents, profile defaults and a live set_permission_mode are
    // refused it (the sidebar has no legitimate use for it on a live checkout); a job the host
    // submits as the operator may run in it, and WorkerDeck then refuses typed input and peer
    // messages into that session. The Box asks for it only from an admin's stored agent trigger
    // (features/automation, `permission_mode`): WorkerDeck cannot tell an admin's job from a
    // browser user's, since both arrive under the host's operator key.
    disableBypassPermissions: 'sessions',
    // Probe credentials at launch so an un-logged-in profile shows a remedy rather than dying on
    // the first turn. requireAvailableProfile stays unset: the probe produces standing false
    // negatives, and a 503 on a profile that works is worse than a late failure.
    checkCredentials: true,
    // Parked/dormant session records inside the Box instance, beside the warehouse. STATED rather
    // than defaulted so it cannot drift onto workerdeck's own cwd-relative `.workerdeck/parked`,
    // which a second Box on this machine would also want.
    parking: { store: createFileSessionStore({ dir: parkedDir(deployment) }) },
    // The job queue runs agent triggers unattended (features/automation). In-memory: a restart
    // loses queued and running jobs, and the Box marks their runs orphaned at boot. Only the
    // loopback listener can submit (agent.mount.ts refuses /jobs and /queue from browsers).
    queue: {
      maxConcurrency: deployment.queue.maxConcurrency,
      ...(deployment.queue.sessionTokenLimit !== null ? { sessionTokenLimit: deployment.queue.sessionTokenLimit } : {}),
      ...(deployment.queue.dailyTokenLimit !== null ? { dailyTokenLimit: deployment.queue.dailyTokenLimit } : {}),
      maxJobDurationMs: deployment.queue.maxJobDurationMs,
      retention: { maxAgeMs: deployment.queue.retentionMs },
      onEvent: emitJobEvent,
    },
    authenticate: (req: IncomingMessage): AgentAuth | null => {
      // Two doors, one authenticator. Browser traffic arrives through the Box's own express stack,
      // which resolves the Box principal and stashes an AgentAuth under AGENT_AUTH before emitting
      // the request into this server (agent.mount.ts). Nothing is read off the headers in that
      // case - a Box user's own Authorization header rides along and is deliberately ignored.
      const mounted = (req as AuthedRequest)[AGENT_AUTH]
      if (mounted) return mounted
      // Otherwise this came in over the loopback listener, whose one legitimate caller is the @nova
      // chat agent: Bearer (REST) and ?key= (WS attach), plus the header the pre-phase-2 proxy used.
      const header = req.headers['x-workerdeck-key']
      const authz = req.headers.authorization
      const bearer = typeof authz === 'string' && /^Bearer\s+/i.test(authz)
        ? authz.replace(/^Bearer\s+/i, '').trim()
        : undefined
      const query = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('key') ?? undefined
      const provided = (typeof header === 'string' ? header : undefined) ?? bearer ?? query
      if (!provided || !digestEquals(provided)) return null
      return { via: 'host', operator: true, canManageProfiles: false }
    },
    /**
     * Who may SEE (and therefore attach to, send to, approve for, interrupt or delete) a session.
     *
     * Before phase 2 every Box user reached the worker as an unscoped operator, so `canSee` was
     * true for every session on it - any internal user could drive any other user's agent, on that
     * person's own credentials. This is the fix, and it is the reason the bound lives here rather
     * than in a URL gate.
     *
     * ONE boolean gates all of those verbs, which is what shapes the second rule. A room's readers
     * may READ that room's @nova turn (they are already watching it happen in the channel), and the
     * rule for that is registered by the chat feature into `agentSessionAccess` (@silkweave/box-core) - but saying `true` here for a reader
     * would also let them type into nova's session, answer its approvals, interrupt or delete it,
     * on nova's credentials. So the reader verdict only counts on a request the mount has marked
     * `readOnly` (GET/HEAD, never an upgrade), and the transcript socket reaches a reader through
     * the mount's own relay instead of through this check (session-relay.ts). On every other
     * request a reader is exactly what they were before: nobody, 404.
     */
    authorizeSession: (principal: unknown, session: SessionInfo): boolean => {
      const auth = principal as AgentAuth | undefined
      if (!auth) return false
      if (auth.via !== 'box') {
        // 'host' owns everything it creates; 'anon' means auth is off and there is nothing to scope by.
        return true
      }
      if (session.meta?.kind === 'builder' && auth.admin !== true) return false
      // Ownership is `scope` and nothing else. A session with no scope belongs to nobody a Box
      // principal can be, so it is refused rather than fuzzily matched on `meta`. There was a
      // bridge here that fell back to `meta.user` for sessions created before phase 2; it was
      // dropped on 2026-09-02 once the one surviving record (one dormant session) had
      // been migrated to carry a real scope. The room-reader branch below is NOT that bridge back
      // under another name: it never makes a session someone's, it lets a room's readers look at a
      // session that is the agent's own, and only on a request that cannot touch it.
      const access = agentSessionAccess(auth.user, session)
      if (access.kind === 'owner') return true
      return access.kind === 'reader' && auth.readOnly === true
    },
    buildRunnerConfig: (req) => {
      const env = { ...process.env } as Record<string, string | undefined>
      delete env.WORKERDECK_AUTH_KEY
      delete env.AGENT_PROXY_KEY
      // A session runs arbitrary Bash, so it must never inherit a Claude token exported into the
      // service by hand: holding the host's would defeat per-person config dirs. A connected
      // account's own token is added back by WorkerDeck after this (accountSessionEnv).
      delete env.CLAUDE_CODE_OAUTH_TOKEN
      for (const key of Object.keys(env)) if (key.startsWith('CLAUDE_TOKEN_')) delete env[key]
      const profile = typeof req.profile === 'string' ? byName.get(req.profile) : undefined
      if (profile?.engine === 'codex' && profile.mcpTokensPath) {
        Object.assign(env, readEnvFile(profile.mcpTokensPath))
      }
      return { ...req, env } as ReturnType<NonNullable<WorkerServerOptions['buildRunnerConfig']>>
    },
  }

  const worker = createWorkerServer(options)

  worker.registry.observe((runner) => {
    const info = runner.info()
    if (info.meta?.kind !== 'builder' || typeof info.meta.user !== 'string') return
    const user = info.meta.user
    const untrack = trackBuilderControl(user, () => runner.close('server'))
    // User-management calls revoke immediately. This also catches host-side role/token changes
    // while a browser is connected or a turn continues without a browser.
    let checking = false
    const timer = setInterval(() => {
      if (runner.info().status === 'closed' || runner.info().status === 'failed') {
        clearInterval(timer)
        untrack()
        return
      }
      if (checking) return
      checking = true
      void resolvePrincipalById(user).then((principal) => {
        if (principal?.role !== 'admin') revokeBuilderControl(user)
      }).catch(() => revokeBuilderControl(user)).finally(() => { checking = false })
    }, 1000)
    timer.unref()
    return () => { clearInterval(timer); untrack() }
  })

  // An upstream change that attaches a second handler would silently double-handle every request
  // once we start emitting into this server ourselves. Fail loudly instead.
  const requests = worker.server.listenerCount('request')
  const upgrades = worker.server.listenerCount('upgrade')
  if (requests !== 1 || upgrades !== 1) {
    throw new Error(`unexpected listener counts on WorkerServer.server (request=${requests}, upgrade=${upgrades})`)
  }

  const { port } = await worker.listen(0, '127.0.0.1')
  host = { worker, url: `http://127.0.0.1:${port}`, key: BOOT_KEY, profiles, config: deployment }
  console.log(`  agent: workerdeck in-process on 127.0.0.1:${port}`)
  console.log(`         profiles: ${deployment.profiles.map((p) => p.name).join(', ')}`)
  return host
}

/**
 * Sessions mid-turn RIGHT NOW, by id - "is it safe to stop?" answered without starting a drain.
 *
 * `awaiting_approval` is deliberately excluded: those are blocked on a human, nothing about
 * restarting will answer the prompt, and the same reasoning is why workerdeck's own drain names
 * them but never waits for them.
 *
 * The embedded host shares the application's lifetime, so restart ends active execution.
 * Supported provider resume state can restore a later session, but does not preserve an
 * interrupted turn. See automation.controller.ts § restart.
 */
export function agentSessionsWorking(): string[] {
  if (!host) return []
  return host.worker.registry
    .list()
    .filter((s) => s.status === 'running')
    .map((s) => s.id)
}

/** Let running turns finish, then stop. Called on shutdown so a deploy does not cut turns mid-flight. */
export async function shutdownWorkerdeck(timeoutMs = 15_000): Promise<void> {
  if (!host) return
  const report = await host.worker.drain({ timeoutMs })
  if (report.timedOut) console.warn(`  agent: drain timed out, working=${report.working.join(', ')}`)
  await host.worker.close()
  host = undefined
}
