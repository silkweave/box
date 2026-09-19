import 'reflect-metadata'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { NestFactory, Reflector } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import type { RequestHandler } from 'http-proxy-middleware'
import { boxBrand, boxJson, clientIp, ensureBoxConfig, ensureSystemPrincipal, rateLimit, setSecurityHeaders } from '@silkweave/box-core'
import { AppModule } from './app.module.js'
import { AGENT_PATH, createAgentMount } from './agent/agent.mount.js'
import { bootWorkerdeck, shutdownWorkerdeck } from './agent/workerdeck.host.js'
import { servicePort, verifyLoopback } from './agent/loopback-guard.js'
import { AuthGuard } from './auth/auth.guard.js'

// Reserved path prefixes the SPA front door must NOT swallow - they belong to Nest (REST under the
// global `api` prefix, plus the silkweave-registered /trpc + /mcp transports) or, for /agent, to
// the in-process workerdeck mount registered below (which also gets the per-IP rate limit).
const RESERVED = /^\/(api|trpc|mcp|agent)(\/|$)/

async function bootstrap(): Promise<void> {
  // Validate merged configuration and lock the system identity before opening the warehouse.
  ensureBoxConfig()

  // Seed the machine account before anything can reference it (the scheduler's attribution, the
  // agent's seat in chat, alert delivery into rooms all assume the row). Insert-only and always a
  // member, so this is safe on every boot. It also applies the schema, which is otherwise lazy.
  // Deliberately NOT wrapped in a try: a Box that cannot write its own warehouse should fail here,
  // loudly, rather than at the first request.
  await ensureSystemPrincipal()

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false })
  // Controllers carry incidental REST routes (`@Get()` on the methods the silkweave adapters reflect
  // into tRPC/MCP). Behind `/api` so they don't shadow the SPA's client routes (/signals, /inbox, …).
  // The dashboard only ever calls /trpc + /mcp (registered by the adapters, NOT prefixed).
  app.setGlobalPrefix('api')

  // Global auth guard for plain REST routes ONLY. The silkweave adapters do NOT run
  // useGlobalGuards instances for @Trpc procedures or @Mcp tools - the changesFeed subscription
  // leaked anonymously until 9339a16 proved it. The real boundary there is class-level
  // @UseGuards(AuthGuard) on every data controller; add it to any new controller.
  app.useGlobalGuards(new AuthGuard(app.get(Reflector)))

  // Development proxies to the configured Vite server. Production serves the built SPA.
  const viteDevUrl =
    boxJson().server.viteDevUrl || (process.argv.includes('--dev') ? `http://localhost:${boxJson().server.vitePort}` : undefined)

  // Hardening middleware (runs first, ahead of the dev proxy + Nest router): strict security headers
  // on every response, plus a coarse per-IP rate limit on the API surfaces. CSP + HSTS are prod-only
  // (a strict CSP would break Vite's HMR client/eval in dev) - keyed off the dev proxy. Static/SPA
  // asset loads are not rate-limited (only /api,/trpc,/mcp). See docs/AUTH.md.
  const isProd = !viteDevUrl
  app.use((req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    setSecurityHeaders(res, { csp: isProd, hsts: isProd })
    const path = (req.url ?? '/').split('?', 1)[0]
    if (RESERVED.test(path) && !rateLimit(`api:${clientIp(req)}`, 600, 60_000)) {
      res.statusCode = 429
      res.end('rate limited')
      return
    }
    next()
  })

  // Boot workerdeck IN THIS PROCESS first (config/workerdeck.json; no file means no agent
  // surface). The mount below hands it browser traffic in-process; it also opens a
  // loopback listener on an OS-assigned port, whose one caller is the @nova chat agent's client. A boot failure here (a missing profile home, an unresolvable
  // codex binary) must NOT take the Box down - the agent surface is optional, the dashboard is not.
  //
  // It must be listening before app.listen(), because AgentModule.onModuleInit starts the chat
  // agent, which sweeps orphan sessions against that URL immediately.
  try {
    await bootWorkerdeck()
  } catch (err) {
    console.error('  agent: workerdeck failed to boot, agent surface disabled -', (err as Error).message)
  }

  // The agent sidebar's door onto that in-process worker: the Box's auth + the gates, then the SAME
  // req/res emitted into `worker.server` - no second socket (feature off when the host did not
  // boot). Registered ahead of the dev proxy + Nest's router; it enforces that auth itself and gates
  // session creation to one live agent per user. See agent/agent.mount.ts + docs/SERVER.md.
  const agentMount = createAgentMount()
  if (agentMount) app.use(agentMount.middleware)

  // Nest is the single origin. In dev (`viteDevUrl` above): reverse-proxy every non-reserved route
  // to the Vite dev server so the browser hits ONE port and still gets HMR. Registered as plain
  // express middleware BEFORE listen so it runs ahead of Nest's router; reserved prefixes fall
  // through to Nest. In prod there is no dev URL and ServeStaticModule (registered in AppModule)
  // serves the built SPA instead.
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
    app.use((req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
      // Strip the query string so `/mcp?session=…` etc. still match the reserved set.
      const path = (req.url ?? '/').split('?', 1)[0]
      return RESERVED.test(path) ? next() : devProxy!(req, res, next)
    })
  }

  // Single-origin: no cross-origin calls in dev or prod, so no CORS needed.
  // The default lives in loopback-guard.ts, next to the guard that probes it - see the note there
  // for why it is neither 8080 nor the predecessor engine's 8090. Production pins PORT=8080 in its
  // launchd plist.
  const port = servicePort()
  await app.listen(port)

  // WebSocket upgrades bypass the express request pipeline, so dispatch them on the raw http.Server
  // by path: /agent sockets go to the authenticated agent mount, everything else to the Vite HMR
  // proxy (dev only; in prod non-agent upgrades are refused).
  if (agentMount || devProxy?.upgrade) {
    app.getHttpServer().on('upgrade', (req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
      const path = (req.url ?? '/').split('?', 1)[0]
      if (AGENT_PATH.test(path)) {
        if (agentMount) agentMount.upgrade(req, socket, head)
        else socket.destroy()
        return
      }
      if (devProxy?.upgrade) devProxy.upgrade(req, socket as import('node:net').Socket, head)
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
      void shutdownWorkerdeck()
        .catch((err: unknown) => console.error('  agent: drain failed -', err))
        .finally(() => process.exit(0))
    })
  }

  // Who owns 127.0.0.1:<port>? Said at boot because the answer is invisible otherwise: Node binds
  // the IPv6 wildcard, so an IPv4-only squatter (a VS Code Remote-SSH port forward of ANOTHER
  // machine's Box, the case that cost a production write on 2026-09-02) coexists with this server
  // instead of colliding with it - the browser reaches us over ::1 and everything looks normal, while nova's
  // MCP client dials the literal IPv4 and reaches THEM. See agent/loopback-guard.ts.
  void verifyLoopback(port).then((verdict) => {
    if (verdict.ours) return
    console.error(`\n  ⚠ 127.0.0.1:${port} IS NOT THIS SERVER - ${verdict.detail}`)
    console.error('    The dashboard may still look local (browsers prefer ::1). Chat agent turns are REFUSED')
    console.error('    while this holds, because its MCP tools dial that address with real credentials.')
    console.error('    Usual cause: VS Code Remote-SSH auto-forwarding the remote\'s port onto yours.\n')
  })

  console.log(`✓ ${boxBrand().name} server on http://localhost:${port}`)
  console.log(`  tRPC:  http://localhost:${port}/trpc   (signalsData, inboxData, …)`)
  console.log(
    viteDevUrl
      ? `  SPA:   proxied to Vite dev server at ${viteDevUrl} (HMR)`
      : `  SPA:   served from apps/web/dist`,
  )
}

bootstrap()
