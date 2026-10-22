import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

type Fields = Record<string, string | number | boolean | null | undefined>
export type DiagnosticRecord = { time: string; pid: number; component: string; event: string } & Fields
let diagnosticSink: ((record: DiagnosticRecord) => void) | undefined

export function setDiagnosticSink(sink: ((record: DiagnosticRecord) => void) | undefined): void {
  diagnosticSink = sink
}

/** Callers supply operational metadata only, never headers, bodies, URLs or error messages. */
export function diagnostic(component: string, event: string, fields: Fields = {}): void {
  const record: DiagnosticRecord = { time: new Date().toISOString(), pid: process.pid, component, event, ...fields }
  if (diagnosticSink) diagnosticSink(record)
  else console.info(JSON.stringify(record))
}

export function errorKind(error: unknown): string {
  const value = error as { code?: unknown; name?: unknown } | null
  const code = value?.code ?? value?.name
  return typeof code === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(code) ? code : 'Error'
}

/** Top-level path segments core serves itself, or that its tooling serves in development. */
const CORE_ROUTE_ROOTS = ['api', 'trpc', 'mcp', 'agent', 'builder', 'builder-agent', 'builder-browser', 'builder-assets',
  'settings', 'recipes', 'login', 'assets', 'src', 'node_modules', '@vite', '@fs', '@id']
/** Route roots the registered features bring (main.ts: each feature's id and `routeRoots`). */
const featureRouteRoots = new Set<string>()

/** Add route roots a diagnostic may name; a root nobody added is reported as `/:path`. */
export function addRouteRoots(roots: Iterable<string>): void {
  for (const root of roots) featureRouteRoots.add(root)
}

/** Route categories deliberately omit query strings, document IDs and filesystem paths. */
export function requestRoute(url: string | undefined): string {
  const path = (url ?? '/').split(/[?#]/, 1)[0]
  if (path === '/') return '/'
  if (/^\/api\/builder-control\/[a-z-]+$/.test(path)) return path
  if (/^\/api\/(box-status|auth\/(me|instance|login|link|logout))$/.test(path)) return path
  if (/^\/trpc\/[a-zA-Z0-9_.,]+$/.test(path)) return path
  const root = path.split('/')[1]
  const known = CORE_ROUTE_ROOTS.includes(root) || featureRouteRoots.has(root)
  return known ? `/${root}${path === `/${root}` ? '' : '/:path'}` : '/:path'
}

const requestIds = new WeakMap<IncomingMessage, string>()
export function requestId(req: IncomingMessage): string {
  let id = requestIds.get(req)
  if (!id) { id = randomUUID(); requestIds.set(req, id) }
  return id
}

/** An immediate start record plus periodic waits makes even requests that never finish visible. */
export function traceHttp(component: string, req: IncomingMessage, res: ServerResponse, forwarded = false): void {
  const inherited = req.headers['x-box-request-id']
  if (forwarded && typeof inherited === 'string' && /^[a-f0-9-]{36}$/.test(inherited)) requestIds.set(req, inherited)
  const fields = { requestId: requestId(req), method: req.method, route: requestRoute(req.url) }
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  diagnostic(component, 'http.start', fields)
  const timer = setInterval(() => {
    // A healthy SSE stream is long-lived; distinguish it from waiting for response headers.
    diagnostic(component, res.headersSent ? 'http.open' : 'http.wait', { ...fields, durationMs: elapsed(), status: res.headersSent ? res.statusCode : undefined })
  }, 10_000)
  timer.unref()
  let done = false
  const finish = (event: string) => {
    if (done) return
    done = true
    clearInterval(timer)
    diagnostic(component, event, { ...fields, durationMs: elapsed(), status: res.headersSent ? res.statusCode : undefined })
  }
  res.once('finish', () => finish('http.finish'))
  res.once('close', () => finish('http.closed-before-finish'))
  req.once('aborted', () => diagnostic(component, 'http.request-aborted', fields))
}

export function traceSocket(component: string, req: IncomingMessage, socket: Duplex, forwarded = false): void {
  const inherited = req.headers['x-box-request-id']
  if (forwarded && typeof inherited === 'string' && /^[a-f0-9-]{36}$/.test(inherited)) requestIds.set(req, inherited)
  const started = performance.now()
  const fields = { requestId: requestId(req), route: requestRoute(req.url) }
  diagnostic(component, 'ws.upgrade-request', fields)
  socket.once('end', () => diagnostic(component, 'ws.peer-ended', fields))
  socket.once('error', error => diagnostic(component, 'ws.error', { ...fields, error: errorKind(error) }))
  socket.once('close', () => diagnostic(component, 'ws.closed', { ...fields, durationMs: Math.round(performance.now() - started) }))
}

/** Heartbeats reveal process liveness and event-loop stalls, including periods without traffic. */
export function runtimeHeartbeat(component: string): () => void {
  let previous = performance.now()
  diagnostic(component, 'process.start', { ppid: process.ppid, runtime: process.versions.bun ? `bun-${process.versions.bun}` : process.version })
  const timer = setInterval(() => {
    const now = performance.now()
    diagnostic(component, 'process.heartbeat', {
      uptimeSeconds: Math.round(process.uptime()), eventLoopDelayMs: Math.max(0, Math.round(now - previous - 10_000)),
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    })
    previous = now
  }, 10_000)
  timer.unref()
  return () => clearInterval(timer)
}
