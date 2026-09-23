import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { Readable } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import type { BuilderSupervisorAuthResult } from './builder-auth.js'

export interface BuilderGatewayHost {
  url: string
  key: string
  request(path: string, init?: RequestInit): Promise<Response>
}

export interface BuilderGatewayAuth {
  authenticate(sessionCookie: string | undefined): Promise<BuilderSupervisorAuthResult>
}

export type BuilderGatewayMutate = <T>(operation: () => Promise<T> | T) => Promise<T>
export type BuilderGatewayCommand = (sessionId: string, frame: unknown) => Promise<void>
export type BuilderGatewayProfiles = () => Promise<unknown[]>

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 2 * 1024 * 1024) throw new Error('Request body is too large')
    chunks.push(Buffer.from(chunk))
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object')
  return body as Record<string, unknown>
}
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  if (!origin) return true
  try { return new URL(origin).host === req.headers.host } catch { return false }
}

/** The editor intentionally omits secrets and instance storage. This is not an OS sandbox. */
export function builderFileAllowed(root: string, candidate: string): boolean {
  const rootAbsolute = resolve(root)
  const within = (base: string, path: string): boolean => {
    const rel = relative(base, path)
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false
    return !rel.split(sep).some(part => ['.git', 'data', 'node_modules', 'box.local.json', '.env'].includes(part) || part.startsWith('.env.'))
  }
  const path = resolve(rootAbsolute, candidate)
  if (!within(rootAbsolute, path)) return false
  let ancestor = path
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor)
  try {
    const rootReal = realpathSync(rootAbsolute)
    const ancestorReal = realpathSync(ancestor)
    return within(rootReal, ancestorReal)
  } catch { return false }
}

export function createBuilderGateway(options: {
  root: string
  host: BuilderGatewayHost
  auth: BuilderGatewayAuth
  /** Shared supervisor operation queue. Writes and runner commands recheck access inside it. */
  mutate?: BuilderGatewayMutate
  /** In-process command dispatch; the host marks runner state before this resolves. */
  command?: BuilderGatewayCommand
  /** Current-session profile metadata only; arbitrary profile catalog access is never proxied. */
  profiles?: BuilderGatewayProfiles
  current: () => { session: { id: string } | null }
}) {
  const { host, auth } = options
  const mutate = options.mutate ?? (async <T>(operation: () => Promise<T> | T): Promise<T> => await operation())
  const sockets = new Set<WebSocket>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 })
  const pathOf = (req: IncomingMessage): URL => new URL(req.url ?? '/', 'http://local')
  const profileMetadata = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const source = value as Record<string, unknown>
    if (typeof source.name !== 'string' || !source.name) return null
    const result: Record<string, unknown> = { name: source.name }
    for (const key of ['engine', 'description', 'defaultModel', 'available', 'unavailableReason', 'managed']) {
      if (source[key] !== undefined && (typeof source[key] === 'string' || typeof source[key] === 'boolean')) result[key] = source[key]
    }
    for (const key of ['defaults', 'capabilities']) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) result[key] = source[key]
    }
    return result
  }
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const identity = await auth.authenticate(req.headers.cookie)
    if (!identity.ok) { json(res, 403, { message: 'Builder requires a signed-in admin' }); return }
    const url = pathOf(req)
    const path = url.pathname.replace(/^\/builder-agent/, '')
    const method = req.method ?? 'GET'
    const write = !['GET', 'HEAD'].includes(method)
    if (!sameOrigin(req) || (write && req.headers['x-box-csrf'] !== '1')) {
      json(res, 403, { message: 'Invalid Builder request' }); return
    }
    const current = options.current()
    const sessionPath = current.session && `/v1/sessions/${encodeURIComponent(current.session.id)}`
    // Exact route families: new WorkerDeck APIs do not become public implicitly. File paths are
    // checked by WorkerDeck as session files, while control-plane and provider routes stay closed.
    let sessionRead = false
    if (sessionPath && (path === sessionPath || path.startsWith(`${sessionPath}/`))) {
      const suffix = path.slice(sessionPath.length + 1)
      try {
        const decoded = decodeURIComponent(suffix)
        const segments = decoded.split('/')
        const hasTraversal = segments.some(segment => segment === '.' || segment === '..' || segment.includes('\0'))
        const singleId = (prefix: string): boolean => segments.length === 2 && segments[0] === prefix && Boolean(segments[1])
        sessionRead = path === sessionPath || !hasTraversal && (
          decoded === 'files' || decoded.startsWith('files/') && decoded.length > 'files/'.length ||
          /^events\/[1-9][0-9]*\/result$/.test(decoded) ||
          singleId('attachments') || singleId('produced') || decoded === 'project/icon'
        )
      } catch { sessionRead = false }
    }
    const fsRead = method === 'GET' && ['/v1/fs/roots', '/v1/fs/list', '/v1/fs/find', '/v1/fs/read'].includes(path)
    const profilesRead = method === 'GET' && path === '/v1/profiles' && options.profiles !== undefined
    const fsWrite = path === '/v1/fs/write' && method === 'PUT'
    if ((!write && !fsRead && !sessionRead && !profilesRead) || (write && !fsWrite)) {
      json(res, 404, { message: 'Builder route is not exposed' }); return
    }
    if (profilesRead) {
      const profiles = await options.profiles!()
      json(res, 200, { profiles: profiles.flatMap(profile => { const metadata = profileMetadata(profile); return metadata ? [metadata] : [] }) })
      return
    }
    let body: string | undefined
    if (fsRead || fsWrite) {
      let parsed: Record<string, unknown> | null = null
      if (fsWrite) {
        try { parsed = await readJson(req) } catch (error) {
          json(res, 400, { message: error instanceof Error ? error.message : 'Invalid JSON body' }); return
        }
      }
      const target = parsed?.path ?? url.searchParams.get('path') ?? url.searchParams.get('base') ?? options.root
      if (typeof target !== 'string' || !builderFileAllowed(options.root, target)) {
        json(res, 403, { message: 'This path is outside the Builder editor' }); return
      }
      if (parsed) body = JSON.stringify(parsed)
    }
    const forward = async (): Promise<void> => {
      const response = await host.request(`${path}${url.search}`, { method, body, headers: body ? { 'content-type': 'application/json' } : undefined })
      if (fsRead && response.ok) {
        const result = await response.json() as Record<string, unknown>
        for (const key of ['roots', 'entries', 'matches']) if (Array.isArray(result[key])) {
          result[key] = (result[key] as unknown[]).filter(entry => {
            if (!entry || typeof entry !== 'object' || typeof (entry as { path?: unknown }).path !== 'string') return false
            return builderFileAllowed(options.root, (entry as { path: string }).path)
          })
        }
        for (const key of ['path', 'base']) if (typeof result[key] === 'string' && !builderFileAllowed(options.root, result[key])) delete result[key]
        if (path === '/v1/fs/roots') result.canWrite = current.session !== null
        json(res, response.status, result)
        return
      }
      res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' })
      if (response.body) Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res)
      else res.end()
    }
    if (write) {
      await mutate(async () => {
        const checked = await auth.authenticate(req.headers.cookie)
        if (!checked.ok || checked.principal.id !== identity.principal.id || !current.session || options.current().session?.id !== current.session.id) {
          json(res, 403, { message: 'Builder access expired' }); return
        }
        await forward()
      })
      return
    }
    await forward()
  }
  async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const identity = await auth.authenticate(req.headers.cookie)
    const current = options.current()
    const url = pathOf(req)
    const expected = current.session && `/builder-agent/v1/sessions/${encodeURIComponent(current.session.id)}/ws`
    if (!identity.ok || !sameOrigin(req) || !expected || url.pathname !== expected) { socket.destroy(); return }
    const upstreamUrl = new URL(`${host.url}${url.pathname.replace('/builder-agent', '')}`)
    upstreamUrl.protocol = 'ws:'
    upstreamUrl.searchParams.set('key', host.key)
    for (const key of ['afterSeq', 'truncateResults', 'imageRefs']) if (url.searchParams.has(key)) upstreamUrl.searchParams.set(key, url.searchParams.get(key)!)
    wss.handleUpgrade(req, socket, head, client => {
      sockets.add(client)
      const upstream = new WebSocket(upstreamUrl, { handshakeTimeout: 10_000, maxPayload: 8 * 1024 * 1024 })
      let queue = Promise.resolve()
      let queued = 0
      const alive = async (): Promise<boolean> => {
        const checked = await auth.authenticate(req.headers.cookie)
        return checked.ok && checked.principal.id === identity.principal.id && options.current().session?.id === current.session?.id
      }
      const timer = setInterval(() => { void alive().then(ok => { if (!ok) client.close(1008, 'Builder access expired') }).catch(() => client.close(1011)) }, 5_000)
      timer.unref()
      upstream.on('message', (data, binary) => {
        if (client.bufferedAmount > 8 * 1024 * 1024) { client.close(1013, 'Client is too slow'); return }
        if (client.readyState === WebSocket.OPEN) client.send(data, { binary })
      })
      client.on('message', (data, binary) => {
        if (++queued > 32) { client.close(1008, 'Too many pending commands'); return }
        queue = queue.then(async () => {
          const frame = JSON.parse(data.toString()) as { type?: string }
          // Closing belongs to the lifecycle endpoint so control state never goes stale.
          await mutate(async () => {
            const checked = await auth.authenticate(req.headers.cookie)
            if (!checked.ok || checked.principal.id !== identity.principal.id || !(await alive())) return
            if (frame.type === 'close' || frame.type === 'shell_command' || frame.type === 'tool_call_result' || frame.type === 'tool_call_error') {
              throw new Error(`Builder command ${frame.type} is unavailable`)
            }
            if (options.command) {
              await options.command(current.session!.id, frame)
              return
            }
            if (upstream.readyState !== WebSocket.OPEN) return
            await new Promise<void>((resolve, reject) => {
              upstream.send(data, { binary }, error => error ? reject(error) : resolve())
            })
          })
        }).catch(error => {
          if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'protocol_error', message: error instanceof Error ? error.message : 'Builder command failed' }))
        }).finally(() => { queued-- })
      })
      client.on('close', () => { clearInterval(timer); sockets.delete(client); upstream.terminate() })
      client.on('error', () => upstream.terminate())
      upstream.on('close', () => client.close(1000))
      upstream.on('error', () => client.close(1011, 'Builder connection failed'))
    })
  }
  return { handle, upgrade, close: () => { for (const socket of sockets) socket.terminate(); wss.close() } }
}
