import 'reflect-metadata'
import { addRouteRoots, diagnostic, errorKind, runtimeHeartbeat, traceHttp, traceSocket } from './diagnostics/runtime.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { NestFactory, Reflector } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import type { RequestHandler } from 'http-proxy-middleware'
import { SESSION_COOKIE, authenticatePrincipal, mcpConnectionPathId, mcpConnections, boxBrand, dataPath, findPathMount, pathMountSigninUrl, assertBackgroundDeclared, boxJson, clientIp, ensureBoxConfig, ensureAgentPrincipals, parseCookies, readUsers, rateLimit, repoRoot, resolveSessionPrincipal, setMaintenanceOverride, setSecurityHeaders, setTrustedContentHeaders } from '@silkweave/box-core'
import { AppModule } from './app.module.js'
import { SERVER_FEATURE_LIST } from './generated/features.js'
import { AGENT_PATH, createAgentMount } from './agent/agent.mount.js'
import { bootWorkerdeck, shutdownWorkerdeck } from './agent/workerdeck.host.js'
import { servicePort, verifyLoopback } from './agent/loopback-guard.js'
import { AuthGuard } from './auth/auth.guard.js'
import { createDevProxyGuard, devSourceScope } from './auth/dev-proxy-guard.js'
import { join } from 'node:path'
import { serveWebApp } from './web/web-release.js'

// Reserved path prefixes the SPA front door must NOT swallow - they belong to Nest (REST under the
// global `api` prefix, plus the silkweave-registered /trpc + /mcp transports) or, for /agent, to
// the in-process workerdeck mount registered below (which also gets the per-IP rate limit).
const RESERVED = /^\/(api|trpc|mcp|agent)(\/|$)/

const flagValue = (name: string): string | undefined => {
  const prefix = `--${name}=`
  const raw = process.argv.find((arg) => arg.startsWith(prefix))
  return raw?.slice(prefix.length)
}

const parsePortFlag = (name: string): number | undefined => {
  const raw = flagValue(name)
  if (raw === undefined) return undefined
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`--${name} must be a port number`)
  return port
}

const INTERNAL_PORT = parsePortFlag('internal-port')
const MAINTENANCE = process.argv.includes('--maintenance')

async function bootstrap(): Promise<void> {
  const stopHeartbeat = runtimeHeartbeat('app')
  const started = performance.now()
  diagnostic('app', 'boot.start', { maintenance: MAINTENANCE, internalPort: INTERNAL_PORT })
  // Must happen before NestFactory instantiates the module so schedulers, the chat agent and relay observe the
  // process-local repair mode through boxJson(). It is never written to the Box configuration.
  setMaintenanceOverride(MAINTENANCE)
  // Validate merged configuration and lock the system identity before opening the warehouse.
  ensureBoxConfig()
  // A feature capability under `background.features` must be one its manifest declares. A
  // maintenance boot reads every capability off, so it skips this and stays able to repair.
  assertBackgroundDeclared()

  // Seed the agent principals before anything can reference them (the scheduler's attribution, the
  // agent's seat in chat, alert delivery into rooms all assume the row): upsert each configured
  // agent, retire agent rows whose file is gone. It also applies the schema, which is otherwise lazy.
  // Deliberately NOT wrapped in a try: a Box that cannot write its own warehouse should fail here,
  // loudly, rather than at the first request.
  diagnostic('app', 'boot.schema.start')
  await ensureAgentPrincipals()
  diagnostic('app', 'boot.schema.ready', { durationMs: Math.round(performance.now() - started) })

  diagnostic('app', 'boot.nest.start')
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false })
  // Controllers carry incidental REST routes (`@Get()` on the methods the silkweave adapters reflect
  // into tRPC/MCP). Behind `/api` so they don't shadow the SPA's client routes (/signals, /inbox, …).
  // The dashboard only ever calls /trpc + /mcp (registered by the adapters, NOT prefixed).
  diagnostic('app', 'boot.nest.ready', { durationMs: Math.round(performance.now() - started) })
  // Request diagnostics name a route root only when core or a registered feature serves it.
  addRouteRoots(SERVER_FEATURE_LIST.flatMap((f) => [f.id, ...(f.routeRoots ?? [])]))
  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => { traceHttp('app', req, res, true); next() })
  app.setGlobalPrefix('api')

  // Request bodies. Nest's default JSON limit is 100 kB, which refuses ordinary payloads a Box must
  // take: a single-file artifact page over MCP or tRPC (artifact-publish `html`, a base64 tarball)
  // is routinely larger. The parser runs before any guard, so the larger limit is only offered to
  // requests that present a credential (a bearer header or the session cookie); the guard still
  // decides whether that credential is real. Anything else keeps the 100 kB ceiling.
  const BODY_LIMIT_BYTES = 64 * 1024 * 1024
  const ANONYMOUS_BODY_LIMIT_BYTES = 100 * 1024
  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const length = Number(req.headers['content-length'] ?? 0)
    const credentialed = /^Bearer\s+/i.test(String(req.headers.authorization ?? '')) || SESSION_COOKIE in parseCookies(req.headers.cookie)
    if (length > (credentialed ? BODY_LIMIT_BYTES : ANONYMOUS_BODY_LIMIT_BYTES)) {
      res.statusCode = 413
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ statusCode: 413, message: 'request entity too large' }))
      return
    }
    next()
  })
  app.useBodyParser('json', { limit: BODY_LIMIT_BYTES })
  app.useBodyParser('urlencoded', { limit: ANONYMOUS_BODY_LIMIT_BYTES, extended: true })

  // Global auth guard for plain REST routes ONLY. The silkweave adapters do NOT run
  // useGlobalGuards instances for @Trpc procedures or @Mcp tools - the changesFeed subscription
  // leaked anonymously until 9339a16 proved it. The real boundary there is class-level
  // @UseGuards(AuthGuard) on every data controller; add it to any new controller.
  app.useGlobalGuards(new AuthGuard(app.get(Reflector)))

  // Three frontend topologies. `--dev` (box dev) or a configured viteDevUrl: every SPA request goes
  // to Vite. Supervised without `--dev` (box start): the dual mode - everyone gets the promoted
  // release, and only requests the supervisor marked with its trusted `x-box-frontend: dev` header
  // (an admin's Builder Preview while a session runs) go to Vite. The supervisor strips any client
  // copy of that header, which is why it is honoured only when the supervisor owns this process.
  // Unsupervised without `--dev`: release only.
  const configuredViteUrl = boxJson().server.viteDevUrl || (process.argv.includes('--dev') ? `http://localhost:${boxJson().server.vitePort}` : undefined)
  const dualMode = !configuredViteUrl && INTERNAL_PORT !== undefined
  const viteDevUrl = configuredViteUrl ?? (dualMode ? `http://127.0.0.1:${boxJson().server.vitePort}` : undefined)
  const devRequest = (req: IncomingMessage): boolean =>
    Boolean(configuredViteUrl) || (dualMode && req.headers['x-box-frontend'] === 'dev')

  // Hardening middleware (runs first, ahead of the dev proxy + Nest router): strict security headers
  // on every response, plus a coarse per-IP rate limit on the API surfaces. CSP + HSTS are off for
  // Vite-served requests only (a strict CSP would break Vite's HMR client/eval). Static/SPA
  // asset loads are not rate-limited (only /api,/trpc,/mcp). See docs/AUTH.md.
  app.use((req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const prod = !devRequest(req)
    setSecurityHeaders(res, { csp: prod, hsts: prod })
    const path = (req.url ?? '/').split('?', 1)[0]
    if (RESERVED.test(path) && !rateLimit(`api:${clientIp(req)}`, 600, 60_000)) {
      res.statusCode = 429
      res.end('rate limited')
      return
    }
    next()
  })

  // Feature path mounts (core port, packages/core/src/path-mounts.ts): a feature-owned top-level
  // prefix such as `/artifacts/` is served here, ahead of the agent mount, the dev proxy and the
  // production ServeStatic catch-all, so it behaves identically in both topologies. Never public:
  // the Box session (or a bearer token) is resolved first; a browser without one is sent to the
  // sign-in gate with a return path, an API client gets a 401. The registry is read per request
  // because features register from onModuleInit, which runs at listen().
  app.use((req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const path = (req.url ?? '/').split('?', 1)[0]
    const mount = findPathMount(path)
    if (!mount) return next()
    void (async () => {
      const authz = req.headers.authorization
      const viaBearer = typeof authz === 'string' && /^Bearer\s+/i.test(authz)
      // Bearer resolution writes to the warehouse (token_last_used_at), so it gets the API limit.
      if (viaBearer && !rateLimit(`api:${clientIp(req)}`, 600, 60_000)) {
        res.statusCode = 429
        res.end('rate limited')
        return
      }
      const principal = viaBearer
        ? await authenticatePrincipal(authz.replace(/^Bearer\s+/i, '').trim())
        : await resolveSessionPrincipal(req.headers.cookie)
      if (!principal) {
        const wantsHtml = (req.method === 'GET' || req.method === 'HEAD') && String(req.headers.accept ?? '').includes('text/html')
        if (wantsHtml && !viaBearer) {
          res.statusCode = 302
          res.setHeader('Location', pathMountSigninUrl(req.url ?? '/'))
          res.end()
        } else {
          res.statusCode = 401
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ message: 'sign in required' }))
        }
        return
      }
      setTrustedContentHeaders(res)
      await mount.handle({ req, res, path, principal, credential: viaBearer ? 'bearer' : 'session' })
    })().catch((err: unknown) => {
      diagnostic('app', 'path-mount.error', { mount: mount.id, error: errorKind(err) })
      if (res.headersSent) { res.destroy(); return }
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('internal error')
    })
  })

  // A connection's session endpoint (core port, packages/core/src/mcp-connections.ts):
  // `/mcp/connections/<id>` serves one outside MCP server's tools under their upstream names to a
  // server-owned agent session whose toolset grants it. The `mcp` recipe's relay answers it; without
  // the recipe it is 404. Bearer only (an MCP client, never a browser), with the API rate limit; the
  // body is already parsed above.
  app.use((req: IncomingMessage & { body?: unknown }, res: ServerResponse, next: (err?: unknown) => void) => {
    const path = (req.url ?? '/').split('?', 1)[0]
    const id = mcpConnectionPathId(path)
    if (id === null) return next()
    const json = (status: number, body: unknown): void => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(body))
    }
    const directory = mcpConnections()
    if (!directory) return json(404, { message: 'no MCP connections on this Box' })
    void (async () => {
      const authz = req.headers.authorization
      if (typeof authz !== 'string' || !/^Bearer\s+/i.test(authz)) return json(401, { message: 'bearer token required' })
      const principal = await authenticatePrincipal(authz.replace(/^Bearer\s+/i, '').trim())
      if (!principal) return json(401, { message: 'invalid token' })
      await directory.serve({ req, res, id, principal })
    })().catch((err: unknown) => {
      diagnostic('app', 'mcp-connection.error', { connection: id, error: errorKind(err) })
      if (res.headersSent) { res.destroy(); return }
      json(500, { message: 'internal error' })
    })
  })

  // Boot workerdeck IN THIS PROCESS first (config/workerdeck.json; no file means no agent
  // surface). The mount below hands it browser traffic in-process; it also opens a
  // loopback listener on an OS-assigned port, whose one caller is the @nova chat agent's client. A boot failure here (a missing profile home, an unresolvable
  // codex binary) must NOT take the Box down - the agent surface is optional, the dashboard is not.
  //
  // It must be listening before app.listen(), because AgentModule.onModuleInit starts the chat
  // agent, which sweeps orphan sessions against that URL immediately.
  // Warm the default-agent-profile cache (core agent-defaults.ts) before anything can start an agent:
  // the engine rule reads it synchronously. A failure only means the deployment rule applies.
  await readUsers().catch((err: unknown) => diagnostic('app', 'boot.agent-defaults.error', { error: errorKind(err) }))
  try {
    diagnostic('app', 'boot.workerdeck.start')
    await bootWorkerdeck()
    diagnostic('app', 'boot.workerdeck.ready', { durationMs: Math.round(performance.now() - started) })
  } catch (err) {
    diagnostic('app', 'boot.workerdeck.error', { error: errorKind(err) })
    console.error('  agent: workerdeck failed to boot, agent surface disabled -', (err as Error).message)
  }

  // The agent sidebar's door onto that in-process worker: the Box's auth + the gates, then the SAME
  // req/res emitted into `worker.server` - no second socket (feature off when the host did not
  // boot). Registered ahead of the dev proxy + Nest's router; it enforces that auth itself and gates
  // session creation to one live agent per user. See agent/agent.mount.ts + docs/SERVER.md.
  const agentMount = createAgentMount()
  if (agentMount) app.use(agentMount.middleware)

  // Nest is the single origin. For a dev request (`devRequest` above): reverse-proxy every
  // non-reserved route to the Vite dev server so the browser hits ONE port and still gets HMR.
  // Registered as plain express middleware BEFORE listen so it runs ahead of Nest's router; reserved
  // prefixes fall through to Nest. Every other request gets the release middleware below.
  let devProxy: RequestHandler | undefined
  if (viteDevUrl) {
    // changeOrigin:false keeps the original Host so Vite's allowedHosts + HMR client origin work.
    // ws MUST be false even though HMR sockets are proxied - `devProxy.upgrade()` below does that
    // explicitly. `ws: true` makes http-proxy-middleware subscribe its OWN catch-all 'upgrade'
    // listener to the raw http.Server on the first request through the middleware, AND set
    // `wsInternalSubscribed`, which silently turns our `devProxy.upgrade()` into a no-op. Net
    // effect in dev: every upgrade was handled twice, the agent's included. Same bug class as the
    // a4f1649 incident on the agent proxy.
    devProxy = createProxyMiddleware({ target: viteDevUrl, ws: false, changeOrigin: false })
    // Vite is a file server, and this proxy puts it on the Box origin before anyone signs in: the
    // login page IS the SPA, so an anonymous browser must load the whole module graph (apps/,
    // packages/, features/, the Bun store) through here. On 2026-09-23 `/@fs/<checkout>/box.local.json`
    // came back with the session secret. vite.config.ts now limits `fs.allow` to those
    // directories; this guard enforces its own copy of that list a second time (apps/web rather
    // than apps/, and never node_modules/.cache), on the decoded, realpath'd target, and refuses
    // the encodings Vite has been bypassed through, so a Vite regression or a loosened allow list
    // does not reopen it. Deliberately no session bypass for `/@fs/`: a member needs the same
    // directories as the login page, and instance state is not source. See auth/dev-proxy-guard.ts.
    const devGuard = createDevProxyGuard({
      scope: devSourceScope(repoRoot()),
      authenticate: async (req) => {
        return (await resolveSessionPrincipal(req.headers.cookie)) !== null
      },
      onRefuse: (req, verdict) => diagnostic('app', 'dev-proxy.refused', { verdict, url: req.url, ip: clientIp(req) }),
    })
    app.use((req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
      // Strip the query string so `/mcp?session=…` etc. still match the reserved set.
      const path = (req.url ?? '/').split('?', 1)[0]
      if (RESERVED.test(path) || !devRequest(req)) return next()
      devGuard(req, res, () => devProxy!(req, res, next))
    })
  }

  // The built SPA: the promoted release in data/web (apps/web/dist until the first release
  // exists). Any unmatched path serves index.html, so `/crm/acme` survives a refresh; a missing
  // hashed `/assets/*` chunk 404s. Reserved prefixes fall through to Nest's router, so API paths
  // 404 as JSON. Keep RESERVED in step with the client router in apps/web/src/router.tsx.
  const webFallback = join(repoRoot(), 'apps', 'web', 'dist')
  app.use((req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    const path = (req.url ?? '/').split('?', 1)[0]
    if (RESERVED.test(path) || devRequest(req)) return next()
    if (!serveWebApp(dataPath(), webFallback, req, res, path)) next()
  })

  // Single-origin: no cross-origin calls in dev or prod, so no CORS needed.
  // The default lives in loopback-guard.ts, next to the guard that probes it - see the note there
  // for why it is neither 8080 nor the predecessor engine's 8090. Production pins PORT=8080 in its
  // launchd plist.
  const port = servicePort()
  const listenPort = INTERNAL_PORT ?? port
  if (INTERNAL_PORT !== undefined) await app.listen(listenPort, '127.0.0.1')
  else await app.listen(listenPort, boxJson().server.host)

  diagnostic('app', 'listening', { port: listenPort, durationMs: Math.round(performance.now() - started) })

  // WebSocket upgrades bypass the express request pipeline, so dispatch them on the raw http.Server
  // by path: /agent sockets go to the authenticated agent mount, everything else to the Vite HMR
  // proxy (dev only; in prod non-agent upgrades are refused). The HMR socket is not put behind the
  // dev proxy guard: it carries no file reads. Vite creates the browser-facing environment with
  // `disableFetchModule: true` (vite 8.3.0, `defaultCreateClientDevEnvironment`), so the one
  // `vite:invoke` handler that could return module source over the socket throws instead.
  if (agentMount || devProxy?.upgrade) {
    app.getHttpServer().on('upgrade', (req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
      traceSocket('app', req, socket, true)
      const path = (req.url ?? '/').split('?', 1)[0]
      if (AGENT_PATH.test(path)) {
        if (agentMount) agentMount.upgrade(req, socket, head)
        else socket.destroy()
        return
      }
      if (devProxy?.upgrade && devRequest(req)) devProxy.upgrade(req, socket as import('node:net').Socket, head)
      else socket.destroy()
    })
  }

  // This server had no signal handling before the merge: a restart just exited, and the separate
  // worker kept every session alive. Now the sessions ARE in this process, so a bare exit cuts live turns
  // mid-flight - and a codex session cannot be rebuilt from a park. Drain first.
  let stopping = false
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (stopping) return
      stopping = true
      diagnostic('app', 'shutdown.start', { signal })
      void shutdownWorkerdeck()
        .catch((err: unknown) => console.error('  agent: drain failed -', err))
        .finally(() => { stopHeartbeat(); diagnostic('app', 'shutdown.finish'); process.exit(0) })
    })
  }

  // Who owns 127.0.0.1:<port>? Said at boot because the answer is invisible otherwise: Node binds
  // the IPv6 wildcard, so an IPv4-only squatter (a VS Code Remote-SSH port forward of ANOTHER
  // machine's Box, the case that cost a production write on 2026-09-02) coexists with this server
  // instead of colliding with it - the browser reaches us over ::1 and everything looks normal, while nova's
  // MCP client dials the literal IPv4 and reaches THEM. See agent/loopback-guard.ts.
  void verifyLoopback(listenPort).then((verdict) => {
    if (verdict.ours) return
    console.error(`\n  ⚠ 127.0.0.1:${listenPort} IS NOT THIS SERVER - ${verdict.detail}`)
    console.error('    The dashboard may still look local (browsers prefer ::1). Chat agent turns are REFUSED')
    console.error('    while this holds, because its MCP tools dial that address with real credentials.')
    console.error('    Usual cause: VS Code Remote-SSH auto-forwarding the remote\'s port onto yours.\n')
  })

  const publicPort = INTERNAL_PORT === undefined ? listenPort : boxJson().server.port
  console.log(`✓ ${boxBrand().name} ready at http://localhost:${publicPort}`)
  if (INTERNAL_PORT !== undefined) console.log(`  Builder: http://localhost:${publicPort}/builder`)
  console.log(`  tRPC:  http://localhost:${publicPort}/trpc   (signalsData, inboxData, …)`)
  console.log(
    configuredViteUrl
      ? `  SPA:   proxied to Vite dev server at ${configuredViteUrl} (HMR)`
      : dualMode
        ? `  SPA:   promoted release from data/web; Builder Preview through Vite while a session runs`
        : `  SPA:   promoted release from data/web`,
  )
}

bootstrap().catch(error => { diagnostic('app', 'boot.failed', { error: errorKind(error) }); console.error(error); process.exitCode = 1 })
