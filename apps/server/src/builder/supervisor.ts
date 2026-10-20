import { createBoxStatusStream } from './box-status-stream.js'
import { applicationUpgrade } from './application-upgrade.js'
import { diagnostic, errorKind, requestId, runtimeHeartbeat, setDiagnosticSink, traceHttp, traceSocket } from '../diagnostics/runtime.js'
import { execFileSync } from 'node:child_process'
import { createServer, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from 'node:http'
import { createGzip } from 'node:zlib'
import { createServer as createNetServer } from 'node:net'
import type { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { agentIdentity, boxJson, clientIp, dataPath, rateLimit, repoRoot, requestIsSecure, sessionCookie, setSecurityHeaders } from '@silkweave/box-core'
import { BuilderSupervisorAuth, type BuilderSupervisorPrincipal } from './builder-auth.js'
import { createBuilderBrowser } from './builder-browser.js'
import { startBuilderBrowserLocal } from './builder-browser-local.js'
import { createBuilderHost } from './builder-host.js'
import { createBuilderGateway, json, readJson, sameOrigin } from './builder-gateway.js'
import { backupBuilder, BuilderLifecycleError, readBuilderControl, readBuilderPendingChanges, recordBuilderSession, restoreBuilder, startBuilder, stopBuilder } from './builder-lifecycle.js'
import { applyMaintenancePatch, MAINTENANCE_PAGE_PATH, MaintenanceError, type MaintenanceSource, maintenancePath, maintenanceReturnPath, publicNotice, readMaintenance, writeMaintenance } from './maintenance.js'
import { maintenancePage } from './maintenance-page.js'
import { checkpointBuilder, finishBuilder, reviewBuilder, finalizeCheckout } from './builder-review.js'
import { createBuilderVerification } from './builder-verification.js'
import { startBuilderLocalControl } from './builder-local-control.js'
import { applicationHeaders, previewResponseHeaders } from './supervisor-http.js'
import { SupervisedApplication } from './supervised-application.js'
import { builderUiVersion, currentBuilderUi, prepareBuilderUi, runBuilderCommand, serveBuilderUi, stopBuilderCommands } from './builder-ui-snapshot.js'
import { DevView, parseDevLogLevel } from './dev-view.js'
import { createDevAccessCache, FRONTEND_HEADER, isPreviewDocument, isViteOnlyRequest, isViteSocket, shouldCompressDevResponse } from './frontend-routing.js'
import { currentWebRelease, prepareWebRelease, serveWebAsset, type WebRelease } from '../web/web-release.js'

// Keep in step with RESERVED in main.ts: these never reach Vite.
const APP_RESERVED = /^\/(api|trpc|mcp|agent)(\/|$)/

/** The checkout's revision and whether it has uncommitted work, recorded on each web release. */
function sourceState(root: string): { sha: string | null; dirty: boolean } {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim().length > 0
    return { sha, dirty }
  } catch { return { sha: null, dirty: true } }
}

async function freePort(): Promise<number> {
  const server = createNetServer()
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()))
  return port
}

/** Owns the public origin and recovery surfaces. App restarts never restart this process. */
export async function startBuilderSupervisor(options: { signals?: boolean; devView?: DevView } = {}) {
  const stopHeartbeat = runtimeHeartbeat('supervisor')
  const root = repoRoot()
  const paths = { repoRoot: root, instanceDir: dataPath() }
  const config = boxJson()
  const machine = agentIdentity()
  const internalPort = await freePort()
  const appUrl = `http://127.0.0.1:${internalPort}`
  const app = new SupervisedApplication({
    repoRoot: root, instanceDir: paths.instanceDir, internalPort, vitePort: config.server.vitePort, dev: process.argv.includes('--dev'),
    ...(options.devView && { onOutput: (source: 'app' | 'vite', level: 'info' | 'warn', line: string) => options.devView!.child(source, level, line) }),
  })
  const report = (level: 'info' | 'warn' | 'error', message: string): void => {
    if (options.devView) options.devView.add('supervisor', level, message)
    else if (level === 'error') console.error(message)
    else if (level === 'warn') console.warn(message)
    else console.log(message)
  }
  const runCommand = async (cwd: string, args: string[]): Promise<void> => {
    if (!options.devView) return runBuilderCommand(cwd, args)
    let pending = ''
    const output = (chunk: string): void => {
      pending += chunk
      const lines = pending.split(/\r?\n|\r/)
      pending = lines.pop() ?? ''
      for (const line of lines) if (line) options.devView!.child('build', 'info', line)
    }
    try { await runBuilderCommand(cwd, args, { onOutput: output }) }
    finally { if (pending) options.devView.child('build', 'info', pending) }
  }
  const auth = new BuilderSupervisorAuth(async cookie => {
    const started = performance.now()
    try {
      const response = await fetch(`${appUrl}/api/auth/me`, { headers: { cookie }, signal: AbortSignal.timeout(2_000), redirect: 'error' })
      if (response.status >= 500) return 'unavailable'
      if (!response.ok) return 'deny'
      const body = await response.json() as { principal?: BuilderSupervisorPrincipal }
      return body.principal ?? 'deny'
    } catch (error) { diagnostic('supervisor', 'auth.unavailable', { error: errorKind(error) }); return 'unavailable' }
    finally { const durationMs = Math.round(performance.now() - started); if (durationMs >= 500) diagnostic('supervisor', 'auth.slow', { durationMs }) }
  })
  diagnostic('supervisor', 'boot.host.start')
  const host = await createBuilderHost(paths)
  diagnostic('supervisor', 'boot.host.ready')
  const inMaintenance = (): boolean => readMaintenance(paths.instanceDir).enabled
  const statusStream = createBoxStatusStream(maintenancePath(paths.instanceDir), () => {
    const maintenance = readMaintenance(paths.instanceDir)
    return { maintenance: maintenance.enabled, release: app.dev ? null : currentWebRelease(paths.instanceDir)?.version ?? null, notice: publicNotice(maintenance) }
  })
  /** One maintenance change from Builder or `box maintenance`. Switching on or off reboots the app
   * into (or out of) its paused mode; notice edits only rewrite the file the page follows. */
  const changeMaintenance = (patch: unknown, by: string | null, source: MaintenanceSource) => mutate(async () => {
    const current = readMaintenance(paths.instanceDir)
    const body = typeof patch === 'object' && patch !== null && !Array.isArray(patch) ? { ...patch, ...(by && { by }) } : patch
    const next = writeMaintenance(paths.instanceDir, applyMaintenancePatch(current, body, new Date(), source))
    // Locking admins out drops the connections they already hold (Builder, app sockets).
    if (next.enabled && next.lockAdmins && !(current.enabled && current.lockAdmins)) {
      browser.revoke('Admins locked out for maintenance')
      gateway.disconnect()
      for (const socket of appSockets) socket.destroy()
    }
    if (next.enabled !== current.enabled) {
      browser.revoke(next.enabled ? 'Maintenance started' : 'Maintenance ended')
      if (next.enabled) for (const socket of appSockets) socket.destroy()
      busy = true
      try { await app.restart(next.enabled) } finally { busy = false }
    }
    return next
  })
  let stopping = false
  let operations = Promise.resolve()
  let operationSequence = 0
  const mutate = <T>(operation: () => Promise<T> | T): Promise<T> => {
    const operationId = ++operationSequence
    const queued = performance.now()
    diagnostic('supervisor', 'operation.queued', { operationId })
    const result = operations.then(async () => {
      const started = performance.now()
      diagnostic('supervisor', 'operation.start', { operationId, queueMs: Math.round(started - queued) })
      if (stopping) throw new BuilderLifecycleError(503, 'The Box supervisor is stopping')
      try { return await operation() }
      catch (error) { diagnostic('supervisor', 'operation.error', { operationId, error: errorKind(error) }); throw error }
      finally { diagnostic('supervisor', 'operation.finish', { operationId, durationMs: Math.round(performance.now() - started) }) }
    })
    operations = result.then(() => {}, () => {})
    return result
  }
  let busy = false
  const browser = createBuilderBrowser({ auth, busy: () => busy, current: () => readBuilderControl(paths) })
  const gateway = createBuilderGateway({ root, host, auth, mutate, command: host.command,
    profiles: async () => {
      const session = readBuilderControl(paths).session
      return session ? host.sessionProfiles(session.id) : []
    }, current: () => ({ session: busy ? null : readBuilderControl(paths).session }) })
  let ui = currentBuilderUi(paths.instanceDir)
  let uiBuilding = false
  let uiError: string | null = null
  let closeBrowserLocal: (() => Promise<void>) | undefined
  let closeLocalControl: (() => Promise<void>) | undefined
  async function refreshUi(): Promise<void> {
    const started = performance.now()
    diagnostic('supervisor', 'ui-refresh.start')
    uiBuilding = true
    uiError = null
    try { ui = await prepareBuilderUi(root, paths.instanceDir, { fallback: false, build: runCommand }) }
    catch (error) { uiError = error instanceof Error ? error.message : 'Builder UI refresh failed'; throw error }
    finally { uiBuilding = false; diagnostic('supervisor', 'ui-refresh.finish', { durationMs: Math.round(performance.now() - started), failed: uiError !== null }) }
  }
  const appSockets = new Set<Duplex>()
  const offline = <T>(fn: () => Promise<T> | T): Promise<T> => app.withStopped(fn)
  const lifecycle = { paths, withAppStopped: offline }
  const verification = createBuilderVerification(paths)
  const restartFrontend = () => mutate(async () => {
    diagnostic('supervisor', 'local-frontend-restart.start')
    // Refused before touching the preview when there is no Vite to restart (built mode).
    if (!app.dev) return app.restartFrontend()
    browser.revoke('Box frontend restarting')
    try { return await app.restartFrontend() }
    finally { diagnostic('supervisor', 'local-frontend-restart.finish') }
  })
  const restartApplication = () => mutate(async () => {
    diagnostic('supervisor', 'local-app-restart.start')
    browser.revoke('Box application restarting')
    busy = true
    try { return await app.restart(inMaintenance()) }
    finally { busy = false; diagnostic('supervisor', 'local-app-restart.finish') }
  })
  // Built mode: the release everyone outside Builder loads changes only here.
  let webPromoting = false
  let webError: string | null = null
  async function promoteWeb(options: { check: boolean }): Promise<WebRelease> {
    if (app.dev) throw new BuilderLifecycleError(409, 'box dev serves every page through Vite; promote applies to box start')
    const started = performance.now()
    diagnostic('supervisor', 'web-promote.start', { check: options.check })
    webPromoting = true
    webError = null
    try {
      if (options.check) await runCommand(root, ['run', 'typecheck'])
      const release = await prepareWebRelease(root, paths.instanceDir, { build: runCommand, source: sourceState(root) })
      statusStream.refresh()
      report('info', `Web release ${release.version.slice(0, 8)} promoted`)
      return release
    } catch (error) {
      webError = error instanceof Error ? error.message : 'Web release build failed'
      throw error
    } finally {
      webPromoting = false
      diagnostic('supervisor', 'web-promote.finish', { durationMs: Math.round(performance.now() - started), failed: webError !== null })
    }
  }
  const promoteLocal = () => mutate(() => promoteWeb({ check: true }))
  const devAccess = createDevAccessCache(async cookie => (await auth.authenticate(cookie)).ok)
  // Vite exists in built mode only for a Builder session's Preview.
  const startPreviewVite = async (): Promise<void> => {
    if (app.dev) return
    await app.startVite().catch(error => report('error', `Builder Preview frontend needs repair: ${String(error)}`))
  }
  const stopPreviewVite = async (): Promise<void> => {
    if (app.dev) return
    devAccess.clear()
    await app.closeVite().catch(error => report('error', `Builder Preview frontend did not stop cleanly: ${String(error)}`))
  }
  /** Built mode: may this request see the live Vite graph? Admin, active session, Vite up. */
  const devAllowed = async (req: IncomingMessage): Promise<boolean> =>
    !app.dev && app.viteRunning && readBuilderControl(paths).session !== null && await devAccess.allowed(req.headers.cookie)
  async function state(principal: BuilderSupervisorPrincipal) {
    const current = readBuilderControl(paths)
    const session = current.session ? await host.session(current.session.id) : null
    const release = app.dev ? null : currentWebRelease(paths.instanceDir)
    const web = app.dev ? { mode: 'dev' as const } : {
      mode: 'built' as const, promoting: webPromoting, error: webError,
      release: release ? { version: release.version, createdAt: release.createdAt, sourceSha: release.sourceSha, dirty: release.dirty } : null,
    }
    return { ...current, maintenance: readMaintenance(paths.instanceDir), session, unavailableSession: current.session && !session ? current.session : null, application: app.status, ui: { version: builderUiVersion(ui), building: uiBuilding, error: uiError }, web, principal, profiles: await host.availableProfiles(principal.id) }
  }
  async function requireIdle(): Promise<void> {
    const current = readBuilderControl(paths)
    if (current.session && host.hasPendingWork(current.session.id)) throw new BuilderLifecycleError(409, 'The Builder has a queued turn; wait for it to settle or interrupt it before taking a backup or restoring')
    const session = current.session && await host.session(current.session.id)
    if (current.session && !session) throw new BuilderLifecycleError(409, 'The Builder runner is unavailable; end this session before backing up or restoring')
    if (session && !['idle', 'parked', 'failed', 'closed'].includes(session.status)) throw new BuilderLifecycleError(409, 'Wait for the Builder turn to finish or interrupt it before taking a backup or restoring data')
  }
  async function control(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const identity = await auth.authenticate(req.headers.cookie)
    if (!identity.ok) { json(res, 403, { message: 'Builder requires a signed-in admin' }); return }
    if (req.method === 'GET' && path === '/review') { json(res, 200, { review: await reviewBuilder(paths), verification: verification.read() }); return }
    if (req.method === 'GET' && path === '/pending-changes') { json(res, 200, readBuilderPendingChanges(paths)); return }
    if (req.method === 'GET' && path === '/state') { json(res, 200, await state(identity.principal)); return }
    if (req.method === 'GET' && path === '/maintenance') { json(res, 200, readMaintenance(paths.instanceDir)); return }
    if (req.method !== 'POST' || req.headers['x-box-csrf'] !== '1' || !sameOrigin(req)) { json(res, 403, { message: 'Invalid Builder control request' }); return }
    let body: Record<string, unknown>
    try { body = await readJson(req) } catch { json(res, 400, { message: 'Invalid JSON body' }); return }
    if (path === '/maintenance') { json(res, 200, await changeMaintenance(body, identity.principal.id, 'builder')); return }
    diagnostic('supervisor', 'control.queued', { requestId: requestId(req), action: path })
    const operation = mutate(async () => {
      diagnostic('supervisor', 'control.start', { requestId: requestId(req), action: path })
      // Authentication is checked again after waiting for a prior operation.
      const checked = await auth.authenticate(req.headers.cookie)
      if (!checked.ok) throw new BuilderLifecycleError(409, 'Builder access expired')
      const principal = checked.principal
      const current = readBuilderControl(paths)
      browser.revoke('Builder host control changed')
      busy = true
      try {
        switch (path) {
          case '/start': {
            if (body.engine !== undefined && typeof body.engine !== 'string') throw new BuilderLifecycleError(400, 'Invalid engine')
            if (body.adoptChanges !== undefined && typeof body.adoptChanges !== 'string') throw new BuilderLifecycleError(400, 'Invalid adoptChanges fingerprint')
            if (!(await host.availableProfiles(principal.id)).length) throw new BuilderLifecycleError(409, 'Configure a provider profile for this admin before starting Builder')
            await startBuilder({ ...lifecycle, ...(typeof body.adoptChanges === 'string' && { adoptChanges: body.adoptChanges }) })
            let id: string | undefined
            try {
              const session = await host.create(principal.id, body.engine as string | undefined)
              id = session.id
              await recordBuilderSession({ id, startedAt: new Date().toISOString() }, lifecycle)
              await startPreviewVite()
            } catch (error) {
              if (id) host.worker.registry.get(id)?.close('server')
              await stopBuilder(lifecycle)
              throw error
            }
            break
          }
          case '/backup': await requireIdle(); await backupBuilder(lifecycle); break
          case '/restore':
            if (typeof body.id !== 'string') throw new BuilderLifecycleError(400, 'Expected backup id')
            await requireIdle(); await restoreBuilder(body.id, lifecycle); break
          case '/verify-review':
            if (typeof body.fingerprint !== 'string') throw new BuilderLifecycleError(400, 'Expected review fingerprint')
            await requireIdle()
            await verification.verify(body.fingerprint, offline)
            break
          case '/checkpoint':
            if (typeof body.fingerprint !== 'string' || typeof body.message !== 'string') throw new BuilderLifecycleError(400, 'Expected review fingerprint and commit message')
            await requireIdle()
            await checkpointBuilder(paths, { fingerprint: body.fingerprint, message: body.message })
            break
          case '/finish': {
            if (typeof body.fingerprint !== 'string' || typeof body.message !== 'string') throw new BuilderLifecycleError(400, 'Expected review fingerprint and commit message')
            await requireIdle()
            verification.assertPassed(body.fingerprint)
            const integrated = await finishBuilder(paths, { fingerprint: body.fingerprint, message: body.message })
            // A failed boot leaves the live Builder branch and runner available for repair.
            try {
              await app.restart(false)
              await finalizeCheckout(paths, { expectedBranch: integrated.checkedOutBranch, expectedSHA: integrated.integratedSHA, targetBranch: integrated.targetBranch })
            } catch (error) {
              // A failed completion must not leave background work resumed under a maintenance banner.
              if (inMaintenance() && app.status.status === 'running') await app.restart(true)
              throw error
            }
            if (current.session) {
              await host.worker.registry.get(current.session.id)?.close('client')
              host.clearPending(current.session.id)
            }
            await stopBuilder(lifecycle)
            await stopPreviewVite()
            // The integrated work was verified; publish it to everyone outside Builder. A failed
            // build keeps the previous release and is reported in Builder state, not as a failed finish.
            if (!app.dev) await promoteWeb({ check: false }).catch(error => report('error', `Web release after Finish failed: ${String(error)}`))
            break
          }
          case '/promote':
            if (body.check !== undefined && typeof body.check !== 'boolean') throw new BuilderLifecycleError(400, 'Expected check boolean')
            await promoteWeb({ check: body.check !== false })
            break
          case '/refresh-ui': await refreshUi(); break
          case '/restart':
            if (body.check !== false) {
              await runCommand(root, ['run', 'typecheck'])
              await runCommand(root, ['run', 'lint'])
              await runCommand(root, ['run', 'build'])
            }
            await app.restart(inMaintenance())
            if (body.check !== false) await refreshUi()
            break
          case '/stop':
            if (current.session) {
              const runner = host.worker.registry.get(current.session.id) ?? await host.worker.parking.ensureLive(current.session.id)
              await runner?.close('client')
              host.clearPending(current.session.id)
            }
            await stopBuilder(lifecycle)
            await stopPreviewVite()
            // Ending the Builder session ends a maintenance it was holding.
            if (inMaintenance()) { writeMaintenance(paths.instanceDir, applyMaintenancePatch(readMaintenance(paths.instanceDir), { enabled: false, by: principal.id })); await app.restart(false) }
            break
          default: throw new BuilderLifecycleError(404, 'Unknown Builder control')
        }
      } finally { busy = false; diagnostic('supervisor', 'control.finish', { requestId: requestId(req), action: path }) }
    })
    await operation
    json(res, 200, { ok: true })
  }
  function proxy(req: IncomingMessage, res: ServerResponse, frontend: { dev: boolean; compress: boolean }): void {
    const started = performance.now()
    const headers: OutgoingHttpHeaders = { ...applicationHeaders(req), 'x-box-request-id': requestId(req) }
    if (frontend.dev) headers[FRONTEND_HEADER] = 'dev'
    const upstream = httpRequest(`${appUrl}${req.url ?? '/'}`, { method: req.method, headers }, response => {
      diagnostic('supervisor', 'proxy.headers', { requestId: requestId(req), durationMs: Math.round(performance.now() - started), status: response.statusCode })
      response.once('aborted', () => diagnostic('supervisor', 'proxy.response-aborted', { requestId: requestId(req) }))
      const outgoing = previewResponseHeaders(response.headers)
      if (frontend.compress && shouldCompressDevResponse({ acceptEncoding: req.headers['accept-encoding'], clientIp: clientIp(req), status: response.statusCode, headers: outgoing })) {
        const compressed: OutgoingHttpHeaders = { ...outgoing, 'content-encoding': 'gzip', vary: 'Accept-Encoding' }
        delete compressed['content-length']
        res.writeHead(200, compressed)
        const gzip = createGzip({ level: 4 })
        gzip.once('error', () => res.destroy())
        response.pipe(gzip).pipe(res)
        return
      }
      res.writeHead(response.statusCode ?? 502, outgoing)
      response.pipe(res)
    })
    upstream.on('error', error => {
      diagnostic('supervisor', 'proxy.error', { requestId: requestId(req), error: errorKind(error) })
      if (res.headersSent) { res.destroy(); return }
      // A document gets the branded page, which reloads itself once the app answers again.
      if (isDocument(req)) servePage(res, publicNotice(readMaintenance(paths.instanceDir)))
      else json(res, 503, { message: 'The Box application is restarting or needs repair. Admins can open /builder.' })
    })
    req.on('aborted', () => upstream.destroy())
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  }
  const isDocument = (req: IncomingMessage): boolean => (req.method === 'GET' || req.method === 'HEAD') && !!req.headers.accept?.includes('text/html')
  function servePage(res: ServerResponse, notice: ReturnType<typeof publicNotice>): void {
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'retry-after': notice ? '60' : '5', 'cache-control': 'no-store' })
    res.end(maintenancePage(boxJson().brand, notice))
  }
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local')
    // Built mode routes per request: the Builder Preview (an admin's framed document plus Vite's own
    // module paths) reaches Vite while a session runs; everyone else gets the promoted release.
    let devRoute = false
    if (!app.dev && (isViteOnlyRequest(url) || isPreviewDocument(req))) {
      devRoute = await devAllowed(req)
      if (!devRoute && isViteOnlyRequest(url)) { setSecurityHeaders(res, { csp: true, hsts: requestIsSecure(req) }); res.writeHead(404, { 'cache-control': 'no-store' }); res.end(); return }
    }
    setSecurityHeaders(res, { csp: !app.dev && !devRoute, hsts: requestIsSecure(req) })
    if (/^\/(api|builder-agent)(\/|$)/.test(url.pathname) && !rateLimit(`supervisor:${clientIp(req)}`, 1200, 60_000)) { json(res, 429, { message: 'Too many requests' }); return }
    if (url.pathname === '/api/box-status/events' && req.method === 'GET') { statusStream.open(res); return }
    if (url.pathname === '/api/box-status' && req.method === 'GET') { const maintenance = readMaintenance(paths.instanceDir); json(res, 200, { maintenance: maintenance.enabled, notice: publicNotice(maintenance) }); return }
    const maintenance = readMaintenance(paths.instanceDir)
    // The page for app tabs that maintenance blocks (signed out, members, admins when locked out).
    // Once maintenance ends it sends the tab back to where it was.
    if (url.pathname === MAINTENANCE_PAGE_PATH && (req.method === 'GET' || req.method === 'HEAD')) {
      if (maintenance.enabled) { servePage(res, publicNotice(maintenance)); return }
      res.writeHead(303, { location: maintenanceReturnPath(url.searchParams.get('return')), 'cache-control': 'no-store' }); res.end(); return
    }
    // Admins locked out: nothing past this point answers anyone. The page, its logo and the status
    // stream stay; the host acts through `box maintenance` on the local socket.
    if (maintenance.enabled && maintenance.lockAdmins && !url.pathname.startsWith('/builder-assets/') && !url.pathname.startsWith('/assets/')) {
      if (isDocument(req)) servePage(res, publicNotice(maintenance))
      else json(res, 503, { message: 'This Box is in maintenance mode' })
      return
    }
    if (url.pathname.startsWith('/api/builder-control/')) { await control(req, res, url.pathname.slice('/api/builder-control'.length)); return }
    if (url.pathname.startsWith('/builder-agent/')) { await gateway.handle(req, res); return }
    if (url.pathname === '/builder' || url.pathname === '/builder/' || url.pathname.startsWith('/builder-assets/')) {
      if (!ui) { res.writeHead(503, { 'content-type': 'text/html', 'refresh': '3' }); res.end('<h1>Preparing Box Builder</h1><p>The recovery workspace is starting.</p>'); return }
      serveBuilderUi(ui, url.pathname, res); return
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      if (!sameOrigin(req) || !req.headers['x-box-csrf']) { json(res, 403, { message: 'Invalid logout request' }); return }
      browser.revoke('Signed out')
      auth.logout(req.headers.cookie)
      res.setHeader('Set-Cookie', sessionCookie('', 0, requestIsSecure(req)))
      json(res, 200, { ok: true }); return
    }
    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      // While the app is healthy it answers /me itself (the full shape: agents, needsOwner). Only an
      // admin repairing through an outage gets this answer from the lease, in the same shape.
      const checked = await auth.authenticate(req.headers.cookie)
      if (checked.ok && checked.source === 'recovery') {
        json(res, 200, { principal: { ...checked.principal, kind: 'human' }, agent: machine, agents: [], needsOwner: false, timeZone: config.timeZone }); return
      }
    }
    if (maintenance.enabled && !/^\/api\/auth\/(me|instance|login|link|logout)$/.test(url.pathname) && !/^\/login(?:\/|$)/.test(url.pathname)) {
      const checked = await auth.authenticate(req.headers.cookie)
      if (!checked.ok) {
        if (req.headers.accept?.includes('text/html') || req.method === 'HEAD') {
          servePage(res, publicNotice(maintenance))
        } else json(res, 503, { message: 'This Box is in maintenance mode' })
        return
      }
    }
    // Hashed release assets skip the app hop: precompressed, immutable, and served even while the
    // app restarts.
    if (!app.dev && !devRoute && (req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/assets/') && serveWebAsset(paths.instanceDir, req, res, url.pathname)) return
    const viteResponse = app.dev ? !APP_RESERVED.test(url.pathname) : devRoute
    proxy(req, res, { dev: devRoute, compress: viteResponse })
  }
  const publicSockets = new Set<Duplex>()
  const server = createServer((req, res) => { traceHttp('supervisor', req, res); void handle(req, res).catch(error => {
    diagnostic('supervisor', 'http.error', { requestId: requestId(req), error: errorKind(error) })
    if (res.headersSent) { res.destroy(); return }
    json(res, error instanceof BuilderLifecycleError || error instanceof MaintenanceError ? error.statusCode : 500, { message: error instanceof Error ? error.message : 'Builder request failed' })
  }) })
  server.on('connection', socket => { publicSockets.add(socket); socket.once('close', () => publicSockets.delete(socket)) })
  server.on('upgrade', (req, socket, head) => { traceSocket('supervisor', req, socket); void (async () => {
    const path = new URL(req.url ?? '/', 'http://local').pathname
    const maintenance = readMaintenance(paths.instanceDir)
    if (maintenance.enabled && maintenance.lockAdmins) { socket.destroy(); return }
    if (path === '/builder-browser') { await browser.upgrade(req, socket, head); return }
    if (path.startsWith('/builder-agent/')) { await gateway.upgrade(req, socket, head); return }
    if (maintenance.enabled && !(await auth.authenticate(req.headers.cookie)).ok) { socket.destroy(); return }
    const upgradeHeaders: OutgoingHttpHeaders = { ...applicationHeaders(req), 'x-box-request-id': requestId(req) }
    if (!app.dev && isViteSocket(req.headers)) {
      if (!(await devAllowed(req))) { socket.destroy(); return }
      upgradeHeaders[FRONTEND_HEADER] = 'dev'
    }
    const upstream = applicationUpgrade(`${appUrl}${req.url ?? '/'}`, upgradeHeaders)
    upstream.on('upgrade', (response, connection, extra) => {
      diagnostic('supervisor', 'ws.upgraded', { requestId: requestId(req), status: response.statusCode })
      connection.once('end', () => diagnostic('supervisor', 'ws.upstream-ended', { requestId: requestId(req) }))
      connection.once('close', () => diagnostic('supervisor', 'ws.upstream-closed', { requestId: requestId(req) }))
      appSockets.add(socket)
      socket.once('close', () => { appSockets.delete(socket); connection.destroy() })
      connection.once('error', error => { diagnostic('supervisor', 'ws.upstream-error', { requestId: requestId(req), error: errorKind(error) }); socket.destroy() })
      socket.once('error', () => connection.destroy())
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`)
      if (extra.length) socket.write(extra)
      if (head.length) connection.write(head)
      connection.pipe(socket).pipe(connection)
    })
    upstream.on('response', response => { diagnostic('supervisor', 'ws.upgrade-refused', { requestId: requestId(req), status: response.statusCode }); response.resume(); socket.destroy() })
    upstream.on('error', error => { diagnostic('supervisor', 'ws.connect-error', { requestId: requestId(req), error: errorKind(error) }); socket.destroy() })
    upstream.end()
  })().catch(error => { diagnostic('supervisor', 'ws.handler-error', { requestId: requestId(req), error: errorKind(error) }); socket.destroy() }) })
  let closing: Promise<void> | undefined
  const onSignal = (signal: string): void => { diagnostic('supervisor', 'process.signal', { signal }); void close().then(() => { options.devView?.stop(); process.exit(0) }, () => { options.devView?.stop(); process.exit(1) }) }
  const onSigint = () => onSignal('SIGINT')
  const onSigterm = () => onSignal('SIGTERM')
  if (options.signals) { process.once('SIGINT', onSigint); process.once('SIGTERM', onSigterm) }
  try {
    await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(config.server.port, config.server.host, done) })
    diagnostic('supervisor', 'listening', { host: config.server.host, publicPort: config.server.port, internalPort, vitePort: config.server.vitePort })
    report('info', `Builder ready at http://localhost:${config.server.port}/builder`)
    diagnostic('supervisor', 'boot.ui.start')
    ui = await prepareBuilderUi(root, paths.instanceDir, { build: runCommand })
    diagnostic('supervisor', 'boot.ui.ready')
    closeBrowserLocal = await startBuilderBrowserLocal(paths.instanceDir, browser)
    closeLocalControl = await startBuilderLocalControl(paths.instanceDir, {
      status: () => app.status,
      frontend: () => app.frontendStatus(),
      restart: restartApplication,
      restartFrontend,
      refresh: () => mutate(refreshUi),
      promote: promoteLocal,
      maintenance: { read: () => readMaintenance(paths.instanceDir), change: patch => changeMaintenance(patch, null, 'host') },
    })
    if (closing) throw new Error('Box supervisor is stopping')
    if (app.dev) await app.startVite().catch(error => report('error', `Box frontend needs repair: ${String(error)}`))
    else if (readBuilderControl(paths).session) await startPreviewVite()
    if (closing) throw new Error('Box supervisor is stopping')
    await app.start(inMaintenance()).catch(error => report('error', `Box app needs repair: ${String(error)}`))
    // Outside a Builder session the checkout is the integrated state: publish it when the current
    // release was built from something else. During a session the checkout holds unpromoted work,
    // so the last release (or apps/web/dist before the first one) stays.
    if (!app.dev && !readBuilderControl(paths).session) {
      const source = sourceState(root)
      const release = currentWebRelease(paths.instanceDir)
      if (!release || release.dirty || source.dirty || release.sourceSha !== source.sha) {
        void mutate(() => promoteWeb({ check: false })).catch(error => report('error', `Box web release needs repair: ${String(error)}`))
      }
    }
  } catch (error) {
    await close()
    throw error
  }
  function close(): Promise<void> {
    if (closing) return closing
    closing = (async () => {
      diagnostic('supervisor', 'shutdown.start', { publicSockets: publicSockets.size, appSockets: appSockets.size })
      stopping = true
      statusStream.close()
      browser.close()
      gateway.close()
      for (const socket of publicSockets) socket.destroy()
      for (const socket of appSockets) socket.destroy()
      const stopped = new Promise<void>(done => server.close(() => done()))
      await stopBuilderCommands()
      await operations
      await closeBrowserLocal?.()
      await closeLocalControl?.()
      await app.close().catch(error => report('error', `Box shutdown: ${String(error)}`))
      await host.worker.drain({ timeoutMs: 5_000 }).catch(() => {})
      await host.worker.close()
      server.closeAllConnections()
      await stopped
      auth.clear()
      stopHeartbeat()
      diagnostic('supervisor', 'shutdown.finish')
      if (options.signals) { process.removeListener('SIGINT', onSigint); process.removeListener('SIGTERM', onSigterm) }
    })()
    return closing
  }
  return { server, host, app, close }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dev = process.argv.includes('--dev')
  let view: DevView | undefined
  let supervisor: Awaited<ReturnType<typeof startBuilderSupervisor>> | undefined
  try {
    if (dev) {
      const config = boxJson()
      view = new DevView({ root: repoRoot(), port: config.server.port, vitePort: config.server.vitePort,
        level: parseDevLogLevel(process.argv.slice(2)), status: () => supervisor?.app.status ?? { status: 'starting' } })
      setDiagnosticSink(record => view?.diagnostic(record))
      view.start()
    }
    supervisor = await startBuilderSupervisor({ signals: true, ...(view && { devView: view }) })
    view?.setActions({
      restart: () => supervisor!.app.restart(readMaintenance(dataPath()).enabled),
      restartFrontend: () => supervisor!.app.restartVite(),
      quit: async () => { await supervisor!.close(); setDiagnosticSink(undefined); view?.stop() },
    })
  } catch (error) {
    view?.add('supervisor', 'error', error instanceof Error ? error.message : String(error))
    view?.stop()
    setDiagnosticSink(undefined)
    if (!view) console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
