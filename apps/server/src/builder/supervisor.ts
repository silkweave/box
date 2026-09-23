import { createBoxStatusStream } from './box-status-stream.js'
import { applicationUpgrade } from './application-upgrade.js'
import { diagnostic, errorKind, requestId, runtimeHeartbeat, setDiagnosticSink, traceHttp, traceSocket } from '../diagnostics/runtime.js'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
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
import { backupBuilder, builderControlPath, BuilderLifecycleError, readBuilderControl, recordBuilderSession, restoreBuilder, setBuilderMaintenance, startBuilder, stopBuilder } from './builder-lifecycle.js'
import { checkpointBuilder, finishBuilder, reviewBuilder, finalizeCheckout } from './builder-review.js'
import { createBuilderVerification } from './builder-verification.js'
import { startBuilderLocalControl } from './builder-local-control.js'
import { applicationHeaders, previewResponseHeaders } from './supervisor-http.js'
import { SupervisedApplication } from './supervised-application.js'
import { builderUiVersion, currentBuilderUi, prepareBuilderUi, runBuilderCommand, serveBuilderUi, stopBuilderCommands } from './builder-ui-snapshot.js'
import { DevView, parseDevLogLevel } from './dev-view.js'

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
    repoRoot: root, internalPort, vitePort: config.server.vitePort, dev: process.argv.includes('--dev'),
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
  const statusStream = createBoxStatusStream(builderControlPath(paths), () => readBuilderControl(paths))
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
  const restartApplication = () => mutate(async () => {
    diagnostic('supervisor', 'local-app-restart.start')
    browser.revoke('Box application restarting')
    busy = true
    try { return await app.restart(readBuilderControl(paths).maintenance) }
    finally { busy = false; diagnostic('supervisor', 'local-app-restart.finish') }
  })
  async function state(principal: BuilderSupervisorPrincipal) {
    const current = readBuilderControl(paths)
    const session = current.session ? await host.session(current.session.id) : null
    return { ...current, session, unavailableSession: current.session && !session ? current.session : null, application: app.status, ui: { version: builderUiVersion(ui), building: uiBuilding, error: uiError }, principal, profiles: await host.availableProfiles(principal.id) }
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
    if (req.method === 'GET' && path === '/state') { json(res, 200, await state(identity.principal)); return }
    if (req.method !== 'POST' || req.headers['x-box-csrf'] !== '1' || !sameOrigin(req)) { json(res, 403, { message: 'Invalid Builder control request' }); return }
    let body: Record<string, unknown>
    try { body = await readJson(req) } catch { json(res, 400, { message: 'Invalid JSON body' }); return }
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
            if (!(await host.availableProfiles(principal.id)).length) throw new BuilderLifecycleError(409, 'Configure a provider profile for this admin before starting Builder')
            await startBuilder(lifecycle)
            let id: string | undefined
            try {
              const session = await host.create(principal.id, body.engine as string | undefined)
              id = session.id
              await recordBuilderSession({ id, startedAt: new Date().toISOString() }, lifecycle)
            } catch (error) {
              if (id) host.worker.registry.get(id)?.close('server')
              await stopBuilder(lifecycle)
              throw error
            }
            break
          }
          case '/maintenance': {
            if (typeof body.enabled !== 'boolean') throw new BuilderLifecycleError(400, 'Expected enabled boolean')
            await setBuilderMaintenance(body.enabled, lifecycle)
            for (const socket of appSockets) socket.destroy()
            await app.restart(body.enabled)
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
              if (current.maintenance && app.status.status === 'running') await app.restart(true)
              throw error
            }
            if (current.session) {
              await host.worker.registry.get(current.session.id)?.close('client')
              host.clearPending(current.session.id)
            }
            await stopBuilder(lifecycle)
            break
          }
          case '/refresh-ui': await refreshUi(); break
          case '/restart':
            if (body.check !== false) {
              await runCommand(root, ['run', 'typecheck'])
              await runCommand(root, ['run', 'lint'])
              await runCommand(root, ['run', 'build'])
            }
            await app.restart(current.maintenance)
            if (body.check !== false) await refreshUi()
            break
          case '/stop':
            if (current.session) {
              const runner = host.worker.registry.get(current.session.id) ?? await host.worker.parking.ensureLive(current.session.id)
              await runner?.close('client')
              host.clearPending(current.session.id)
            }
            await stopBuilder(lifecycle)
            if (current.maintenance) await app.restart(false)
            break
          default: throw new BuilderLifecycleError(404, 'Unknown Builder control')
        }
      } finally { busy = false; diagnostic('supervisor', 'control.finish', { requestId: requestId(req), action: path }) }
    })
    await operation
    json(res, 200, { ok: true })
  }
  function proxy(req: IncomingMessage, res: ServerResponse): void {
    const started = performance.now()
    const upstream = httpRequest(`${appUrl}${req.url ?? '/'}`, { method: req.method, headers: { ...applicationHeaders(req), 'x-box-request-id': requestId(req) } }, response => {
      diagnostic('supervisor', 'proxy.headers', { requestId: requestId(req), durationMs: Math.round(performance.now() - started), status: response.statusCode })
      response.once('aborted', () => diagnostic('supervisor', 'proxy.response-aborted', { requestId: requestId(req) }))
      res.writeHead(response.statusCode ?? 502, previewResponseHeaders(response.headers))
      response.pipe(res)
    })
    upstream.on('error', error => { diagnostic('supervisor', 'proxy.error', { requestId: requestId(req), error: errorKind(error) }); if (!res.headersSent) json(res, 503, { message: 'The Box application is restarting or needs repair. Admins can open /builder.' }); else res.destroy() })
    req.on('aborted', () => upstream.destroy())
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  }
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    setSecurityHeaders(res, { csp: !process.argv.includes('--dev'), hsts: requestIsSecure(req) })
    const url = new URL(req.url ?? '/', 'http://local')
    if (/^\/(api|builder-agent)(\/|$)/.test(url.pathname) && !rateLimit(`supervisor:${clientIp(req)}`, 1200, 60_000)) { json(res, 429, { message: 'Too many requests' }); return }
    if (url.pathname === '/api/box-status/events' && req.method === 'GET') { statusStream.open(res); return }
    if (url.pathname === '/api/box-status' && req.method === 'GET') { json(res, 200, { maintenance: readBuilderControl(paths).maintenance }); return }
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
      const checked = await auth.authenticate(req.headers.cookie)
      if (checked.ok) { json(res, 200, { principal: checked.principal, agent: machine }); return }
    }
    if (readBuilderControl(paths).maintenance && !/^\/api\/auth\/(me|instance|login|link|logout)$/.test(url.pathname) && !/^\/login(?:\/|$)/.test(url.pathname)) {
      const checked = await auth.authenticate(req.headers.cookie)
      if (!checked.ok) {
        if (req.headers.accept?.includes('text/html')) {
          res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'retry-after': '60', 'cache-control': 'no-store' })
          res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Box maintenance</title></head><body style="margin:0;background:#101018;color:#e8e7ff;font:18px system-ui;display:grid;place-items:center;min-height:100vh"><main style="max-width:32rem;padding:2rem"><p style="color:#a5a1ff">BOX MAINTENANCE</p><h1>We’re making your Box better.</h1><p>Your team’s Builder is working on an update. Please check back shortly.</p><a style="color:#a5a1ff" href="/builder">Admin access</a></main></body></html>')
        } else json(res, 503, { message: 'This Box is in maintenance mode' })
        return
      }
    }
    proxy(req, res)
  }
  const publicSockets = new Set<Duplex>()
  const server = createServer((req, res) => { traceHttp('supervisor', req, res); void handle(req, res).catch(error => {
    diagnostic('supervisor', 'http.error', { requestId: requestId(req), error: errorKind(error) })
    if (res.headersSent) { res.destroy(); return }
    json(res, error instanceof BuilderLifecycleError ? error.statusCode : 500, { message: error instanceof Error ? error.message : 'Builder request failed' })
  }) })
  server.on('connection', socket => { publicSockets.add(socket); socket.once('close', () => publicSockets.delete(socket)) })
  server.on('upgrade', (req, socket, head) => { traceSocket('supervisor', req, socket); void (async () => {
    const path = new URL(req.url ?? '/', 'http://local').pathname
    if (path === '/builder-browser') { await browser.upgrade(req, socket, head); return }
    if (path.startsWith('/builder-agent/')) { await gateway.upgrade(req, socket, head); return }
    if (readBuilderControl(paths).maintenance && !(await auth.authenticate(req.headers.cookie)).ok) { socket.destroy(); return }
    const upstream = applicationUpgrade(`${appUrl}${req.url ?? '/'}`, { ...applicationHeaders(req), 'x-box-request-id': requestId(req) })
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
    await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(config.server.port, done) })
    diagnostic('supervisor', 'listening', { publicPort: config.server.port, internalPort, vitePort: config.server.vitePort })
    report('info', `Builder ready at http://localhost:${config.server.port}/builder`)
    diagnostic('supervisor', 'boot.ui.start')
    ui = await prepareBuilderUi(root, paths.instanceDir, { build: runCommand })
    diagnostic('supervisor', 'boot.ui.ready')
    closeBrowserLocal = await startBuilderBrowserLocal(paths.instanceDir, browser)
    closeLocalControl = await startBuilderLocalControl(paths.instanceDir, {
      status: () => app.status,
      restart: restartApplication,
      refresh: () => mutate(refreshUi),
    })
    if (closing) throw new Error('Box supervisor is stopping')
    await app.startVite().catch(error => report('error', `Box frontend needs repair: ${String(error)}`))
    if (closing) throw new Error('Box supervisor is stopping')
    await app.start(readBuilderControl(paths).maintenance).catch(error => report('error', `Box app needs repair: ${String(error)}`))
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
      restart: () => supervisor!.app.restart(readBuilderControl({ repoRoot: repoRoot(), instanceDir: dataPath() }).maintenance),
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
