import { createRequire } from 'node:module'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { createFileSessionStore, createWorkerServer, type WorkerServer, type WorkerServerOptions } from '@workerdeck/server'
import type { ProfileInfo, SessionInfo } from '@workerdeck/protocol'
import { agentSessionAccess, boxJson, repoRoot, resolvePrincipalById } from '@silkweave/box-core'
import { parkedDir, readWorkerdeckConfig, type WorkerdeckProfile } from './workerdeck.config.js'
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

/**
 * A person's long-lived Claude OAuth token (`claude setup-token`), from `CLAUDE_TOKEN_<PERSON>` in
 * `box.json`'s `workerdeckTokens` map. Optional; a person without one falls back to whatever their configDir
 * resolves.
 *
 * WHY IT EXISTS, and why dropping it in the merge would have been a silent production break: under
 * launchd, a session pinned to a per-person `<home>/.claude` fails with "OAuth session expired and
 * could not be refreshed" even though that directory's .credentials.json is fresh and valid - the
 * same file, read through any other path, authenticates fine (investigated 2026-07-22 on a production host;
 * mechanism never identified). A long-lived token sidesteps config-dir credential resolution
 * altogether. CLAUDE_CONFIG_DIR is still pinned to the profile, so settings, memory and skills
 * remain that person's.
 *
 * Keyed by PERSON, not by profile name: `<person>:claude` and `<person>:codex` are the same human,
 * and deriving the variable from the profile would look for `CLAUDE_TOKEN_TOBY:CLAUDE`, find
 * nothing, and drop back to exactly the failure the token exists to sidestep - as an auth error
 * mid-turn rather than at startup. Applied to a person's codex profile too; codex ignores it.
 *
 * Read at CALL time and by hand, never `process.loadEnvFile`: the file is the operator's to edit
 * (a token rotated at 3pm should not need a restart), and loading it would pile every person's
 * token into this process's environment - which is the Box's, and which every session inherits.
 */
const claudeTokenFor = (person: string): string | undefined =>
  boxJson().workerdeckTokens['CLAUDE_TOKEN_' + person.toUpperCase()]?.trim() || undefined

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

  if (deployment.claudeTokens) {
    // Named at boot because the failure this guards against is silent and mid-turn: a missing token
    // does not fail the create, it fails the first Claude turn with an expired-OAuth error.
    const people = [...new Set(deployment.profiles.filter((p) => p.engine === 'claude').map((p) => p.person))]
    const have = people.filter((person) => claudeTokenFor(person))
    const missing = people.filter((person) => !claudeTokenFor(person))
    // Logged rather than merely warned so a deploy can ASSERT the tokens parsed, without printing
    // one. An invalid value in box.local.json is otherwise indistinguishable from no file at all.
    if (have.length > 0) console.log(`  agent: claude tokens loaded for ${have.join(', ')}`)
    if (missing.length > 0) {
      console.warn(`  agent: no CLAUDE_TOKEN_<PERSON> in box.json workerdeckTokens for ${missing.join(', ')}`)
    }
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

  const profiles: ProfileInfo[] = deployment.profiles.map((p) =>
    p.engine === 'codex'
      ? { name: p.name, engine: 'codex', codexHome: p.home, defaults: p.defaults, description: p.description }
      : { name: p.name, configDir: p.home, description: p.description },
  ) as ProfileInfo[]

  const byName = new Map<string, WorkerdeckProfile>(deployment.profiles.map((p) => [p.name, p]))

  const options: WorkerServerOptions = {
    basePath: '/v1',
    profiles,
    allowedCwdRoots: deployment.cwdRoots,
    // Host filesystem routes OFF. They mount on allowedCwdRoots alone, needing no grant of their
    // own, so leaving them on would publish the whole checkout - box.local.json included - as an
    // authenticated GET. An explicit [] 404s them. `operator: false` is the second lock.
    hostFiles: { roots: [] },
    // The sidebar can raise a session's permission mode; bypassPermissions on a live checkout has
    // no legitimate use here.
    disableBypassPermissions: true,
    // Probe credentials at launch so an un-logged-in profile shows a remedy rather than dying on
    // the first turn. requireAvailableProfile stays unset: the probe produces standing false
    // negatives, and a 503 on a profile that works is worse than a late failure.
    checkCredentials: true,
    // Parked/dormant session records inside the Box instance, beside the warehouse. STATED rather
    // than defaulted so it cannot drift onto workerdeck's own cwd-relative `.workerdeck/parked`,
    // which a second Box on this machine would also want.
    parking: { store: createFileSessionStore({ dir: parkedDir(deployment) }) },
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
      // A session runs arbitrary Bash, so it must never inherit anyone's long-lived Claude token -
      // holding someone else's would defeat the whole point of per-person config dirs. These are
      // never loaded into THIS process's env (see claudeTokenFor), so this is belt and braces
      // against one being exported into the service by hand.
      for (const key of Object.keys(env)) if (key.startsWith('CLAUDE_TOKEN_')) delete env[key]
      const profile = typeof req.profile === 'string' ? byName.get(req.profile) : undefined
      if (profile?.engine === 'codex' && profile.mcpTokensPath) {
        Object.assign(env, readEnvFile(profile.mcpTokensPath))
      }
      const token = profile ? claudeTokenFor(profile.person) : undefined
      if (token) env.CLAUDE_CODE_OAUTH_TOKEN = token
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
  host = { worker, url: `http://127.0.0.1:${port}`, key: BOOT_KEY, profiles }
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
