import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { BROWSER_MAX_RESULT_BYTES, browserPreviewPath, parseBrowserCommand, type BrowserCommand, type BrowserControlState, type BrowserGrant, type BrowserServerMessage } from '@silkweave/box-core/builder-browser'
import { WebSocket, WebSocketServer } from 'ws'
import type { BuilderSupervisorAuthResult } from './builder-auth.js'

export interface BuilderBrowserCurrent {
  session: { id: string } | null
}

export interface BuilderBrowserTimings {
  /** Maximum time without a browser-control action before its grant expires. */
  grantMs?: number
  /** Maximum time a browser command may remain pending. */
  commandMs?: number
  /** WebSocket heartbeat interval. */
  heartbeatMs?: number
  /** Supervisor lifecycle and authentication poll interval. */
  pollMs?: number
}

export interface BuilderBrowserOptions {
  auth: {
    authenticate(cookie: string | undefined): Promise<BuilderSupervisorAuthResult>
  }
  current: () => BuilderBrowserCurrent
  busy?: () => boolean
  timings?: BuilderBrowserTimings
}

const DEFAULT_GRANT_MS = 5 * 60_000
const DEFAULT_COMMAND_MS = 15_000
const DEFAULT_HEARTBEAT_MS = 5_000
const DEFAULT_POLL_MS = 5_000
const MAX_LIVENESS_MS = 15_000
const MAX_TEXT = 512

interface BrowserConnection {
  socket: WebSocket
  cookie: string | undefined
  principalId: string
  display: string
  tabId: string
  ready: boolean
  generation: string | null
  path: string
  pathAllowed: boolean
  lastPong: number
  queue: Promise<void>
}

interface PendingBrowserCommand {
  id: string
  connection: BrowserConnection
  sessionId: string
  grant: BrowserGrant
  command: BrowserCommand
  timer: ReturnType<typeof setTimeout>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function validText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT || value.includes('\0')) throw new Error(`Invalid ${name}`)
  return value
}

function isAdmin(result: BuilderSupervisorAuthResult): result is Extract<BuilderSupervisorAuthResult, { ok: true }> {
  return result.ok && result.principal.role === 'admin'
}

/**
 * Browser control is deliberately a small broker. It owns the tab/grant binding and forwards one
 * validated command at a time. It does not proxy WorkerDeck frames, retain DOM data, or run code in
 * the browser. The supervisor calls `revoke` before lifecycle mutations and `close` while shutting
 * down, so this module does not use the supervisor's operation queue.
 */
export function createBuilderBrowser(options: BuilderBrowserOptions) {
  const grantMs = options.timings?.grantMs ?? DEFAULT_GRANT_MS
  const commandMs = options.timings?.commandMs ?? DEFAULT_COMMAND_MS
  const heartbeatMs = options.timings?.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  const pollMs = options.timings?.pollMs ?? DEFAULT_POLL_MS
  if (![grantMs, commandMs, heartbeatMs, pollMs].every(value => Number.isFinite(value) && value > 0)) throw new Error('Builder browser timings must be positive')

  const sockets = new Set<BrowserConnection>()
  const wss = new WebSocketServer({ noServer: true, maxPayload: BROWSER_MAX_RESULT_BYTES })
  let selected: BrowserConnection | null = null
  let grant: BrowserGrant | null = null
  let pending: PendingBrowserCommand | null = null
  let preparing: symbol | null = null
  let lastAction: BrowserControlState['lastAction'] = null
  let reason = 'No browser tab is ready'
  let closed = false
  let polling = false
  let grantTimer: ReturnType<typeof setTimeout> | undefined

  const timers = new Set<ReturnType<typeof setInterval>>()
  const unref = (timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>): void => {
    const candidate = timer as unknown as { unref?: () => void }
    candidate.unref?.()
  }

  const safePath = (value: unknown): string | null => browserPreviewPath(value)

  function state(forTabId = selected?.tabId ?? ''): BrowserControlState {
    return {
      tabId: forTabId,
      tabs: [...sockets].map(tab => ({
        id: tab.tabId,
        principalId: tab.principalId,
        display: tab.display,
        generation: tab.generation,
        path: tab.path,
      })),
      grant: grant ? { ...grant } : null,
      reason,
      pending: pending?.command.op ?? null,
      lastAction: lastAction ? { ...lastAction } : null,
    }
  }

  function send(socket: WebSocket, message: BrowserServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return
    try { socket.send(JSON.stringify(message)) } catch { /* close/error handlers clean up the socket */ }
  }

  function broadcast(): void {
    for (const connection of sockets) send(connection.socket, { type: 'state', state: state(connection.tabId) })
  }

  function sendError(connection: BrowserConnection, message: string): void {
    send(connection.socket, { type: 'error', message })
  }

  function clearGrantTimer(): void {
    if (grantTimer !== undefined) clearTimeout(grantTimer)
    grantTimer = undefined
  }

  function scheduleGrantExpiry(): void {
    clearGrantTimer()
    if (!grant) return
    const expected = grant
    const wait = Math.max(1, expected.expiresAt - Date.now())
    grantTimer = setTimeout(() => {
      if (grant !== expected) return
      if (Date.now() < expected.expiresAt) { scheduleGrantExpiry(); return }
      revoke('Browser grant expired')
    }, wait)
    unref(grantTimer)
  }

  function rejectPending(message: string): void {
    const current = pending
    if (!current) return
    pending = null
    clearTimeout(current.timer)
    current.reject(new Error(message))
  }

  /** Revoke is synchronous so lifecycle callers can invalidate control before mutating state. */
  function revoke(nextReason: string): void {
    clearGrantTimer()
    rejectPending(nextReason)
    preparing = null
    selected = null
    grant = null
    reason = nextReason
    broadcast()
  }

  function touchGrant(): void {
    if (!grant) return
    grant = { ...grant, expiresAt: Date.now() + grantMs }
    scheduleGrantExpiry()
  }

  function currentBinding(connection: BrowserConnection, expected: BrowserGrant): boolean {
    const current = options.current()
    return !closed && !options.busy?.() &&
      current.session?.id === expected.sessionId &&
      connection.principalId === expected.principalId &&
      selected === connection && grant?.nonce === expected.nonce &&
      grant?.generation === expected.generation && grant?.tabId === expected.tabId &&
      connection.ready && connection.pathAllowed && connection.generation === expected.generation &&
      connection.tabId === expected.tabId && expected.expiresAt > Date.now()
  }

  async function authenticatedBinding(connection: BrowserConnection, expected: BrowserGrant): Promise<boolean> {
    try {
      const checked = await options.auth.authenticate(connection.cookie)
      return isAdmin(checked) && checked.principal.id === connection.principalId && currentBinding(connection, expected)
    } catch { return false }
  }

  function commandPathAllowed(command: BrowserCommand): boolean {
    return command.op !== 'navigate' || safePath(command.path) !== null
  }

  function scheduleCommandTimeout(command: PendingBrowserCommand): void {
    command.timer = setTimeout(() => {
      if (pending !== command) return
      lastAction = { op: command.command.op, ok: false, at: Date.now() }
      revoke('Browser command timed out')
    }, commandMs)
    unref(command.timer)
  }

  function dispatch(connection: BrowserConnection, sessionId: string, command: BrowserCommand, binding: BrowserGrant): Promise<unknown> {
    if (pending) return Promise.reject(new Error('A browser command is already pending'))
    if (connection.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Browser tab is disconnected'))
    const id = randomUUID()
    const deadline = Date.now() + commandMs
    return new Promise<unknown>((resolve, reject) => {
      const current: PendingBrowserCommand = { id, connection, sessionId, grant: { ...binding }, command, timer: undefined as never, resolve, reject }
      pending = current
      touchGrant()
      current.grant = { ...grant! }
      scheduleCommandTimeout(current)
      broadcast()
      const message: BrowserServerMessage = { type: 'command', id, grant: current.grant, command, deadline }
      try {
        connection.socket.send(JSON.stringify(message), error => {
          if (error && pending === current) {
            lastAction = { op: command.op, ok: false, at: Date.now() }
            revoke('Browser tab disconnected')
          }
        })
      } catch {
        lastAction = { op: command.op, ok: false, at: Date.now() }
        revoke('Browser tab disconnected')
      }
    })
  }

  async function execute(sessionId: string, value: unknown): Promise<unknown> {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('Invalid browser session')
    const command = parseBrowserCommand(value)
    if (!commandPathAllowed(command)) throw new Error('Browser navigation path is unavailable')
    if (pending || preparing) throw new Error('A browser command is already pending')
    let currentGrant = grant
    let connection = selected
    if (!currentGrant || !connection) {
      const lifecycle = options.current()
      const candidate = lifecycle.session
        ? [...sockets].find(item => item.ready && item.pathAllowed && item.generation)
        : undefined
      if (candidate && lifecycle.session) {
        connection = candidate
        currentGrant = { sessionId: lifecycle.session.id, principalId: candidate.principalId, tabId: candidate.tabId, generation: candidate.generation!, nonce: randomUUID(), expiresAt: Date.now() + grantMs }
        selected = candidate
        grant = currentGrant
        reason = 'Browser control available'
        scheduleGrantExpiry()
        broadcast()
      }
    }
    if (!currentGrant || !connection) throw new Error('No Builder Preview tab is available for browser control')
    if (currentGrant.sessionId !== sessionId) throw new Error('Browser control is bound to another session')
    const preparation = Symbol('browser-command')
    preparing = preparation
    try {
      if (!(await authenticatedBinding(connection, currentGrant))) {
        revoke('Browser control authority changed')
        throw new Error('Browser control authority changed')
      }
      // Authentication is awaited above; recheck all mutable bindings immediately before dispatch.
      if (pending || grant !== currentGrant || selected !== connection || !currentBinding(connection, currentGrant)) {
        throw new Error('Browser control authority changed')
      }
      return dispatch(connection, sessionId, command, currentGrant)
    } finally {
      if (preparing === preparation) preparing = null
    }
  }

  async function handleResult(connection: BrowserConnection, frame: Record<string, unknown>): Promise<void> {
    const command = pending
    if (!command) { sendError(connection, 'No browser command is pending'); return }
    if (frame.type !== 'result' || frame.id !== command.id || frame.nonce !== command.grant.nonce || frame.generation !== command.grant.generation || connection !== command.connection) {
      sendError(connection, 'Stale or unauthorized browser result')
      return
    }
    if (typeof frame.ok !== 'boolean') { sendError(connection, 'Invalid browser result'); return }
    if (!(await authenticatedBinding(connection, command.grant))) {
      lastAction = { op: command.command.op, ok: false, at: Date.now() }
      revoke('Browser control authority changed')
      return
    }
    if (pending !== command) return
    touchGrant()
    const settled: BrowserServerMessage = { type: 'settled', id: command.id, nonce: command.grant.nonce, generation: command.grant.generation, ok: frame.ok }
    if (connection.socket.readyState !== WebSocket.OPEN) {
      lastAction = { op: command.command.op, ok: false, at: Date.now() }
      revoke('Browser tab disconnected')
      return
    }
    const delivered = await new Promise<boolean>(resolve => {
      try { connection.socket.send(JSON.stringify(settled), error => resolve(!error)) } catch { resolve(false) }
    })
    if (!delivered || pending !== command || !(await authenticatedBinding(connection, command.grant))) {
      if (pending === command) {
        lastAction = { op: command.command.op, ok: false, at: Date.now() }
        revoke('Browser control authority changed')
      }
      return
    }
    pending = null
    clearTimeout(command.timer)
    lastAction = { op: command.command.op, ok: frame.ok, at: Date.now() }
    reason = frame.ok ? 'Browser command completed' : (typeof frame.error === 'string' ? frame.error : 'Browser command failed')
    broadcast()
    if (frame.ok) command.resolve(frame.result)
    else command.reject(new Error(typeof frame.error === 'string' && frame.error ? frame.error : 'Browser command failed'))
  }

  async function handleFrame(connection: BrowserConnection, value: unknown): Promise<void> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { sendError(connection, 'Invalid browser frame'); return }
    const frame = value as Record<string, unknown>
    switch (frame.type) {
      case 'ready': {
        const generation = validText(frame.generation, 'generation')
        const path = safePath(frame.path)
        const changed = connection.ready && (connection.generation !== generation || connection.path !== (path ?? '/unavailable'))
        if (changed && selected === connection) revoke('Browser page changed')
        connection.ready = path !== null
        connection.pathAllowed = path !== null
        connection.generation = path === null ? null : generation
        connection.path = path ?? '/unavailable'
        reason = path === null ? 'Browser page is unavailable for control' : 'Browser tab is ready'
        broadcast()
        return
      }
      case 'unavailable': {
        if (selected === connection) revoke('Browser page is unavailable')
        connection.ready = false
        connection.pathAllowed = false
        connection.generation = null
        connection.path = '/unavailable'
        reason = 'Browser page is unavailable for control'
        broadcast()
        return
      }
      case 'revoke':
        if (selected === connection) revoke('Browser control released')
        return
      case 'result':
        await handleResult(connection, frame)
        return
      default:
        // In particular, tool_result/tool_call_result frames are never part of this protocol.
        sendError(connection, 'Unknown browser frame')
    }
  }

  function removeConnection(connection: BrowserConnection): void {
    if (!sockets.delete(connection)) return
    if (selected === connection) revoke('Browser tab disconnected')
    else broadcast()
  }

  async function poll(): Promise<void> {
    if (closed || polling) return
    polling = true
    try {
      const now = Date.now()
      const current = options.current()
      if (grant && (!current.session || current.session.id !== grant.sessionId || options.busy?.() || grant.expiresAt <= now)) {
        revoke(grant.expiresAt <= now ? 'Browser grant expired' : 'Builder lifecycle changed')
      }
      for (const connection of Array.from(sockets)) {
        if (now - connection.lastPong > Math.min(MAX_LIVENESS_MS, heartbeatMs * 3)) {
          connection.socket.terminate()
          continue
        }
        try {
          const checked = await options.auth.authenticate(connection.cookie)
          if (!isAdmin(checked) || checked.principal.id !== connection.principalId) {
            if (selected === connection) revoke('Builder access expired')
            connection.socket.close(1008, 'Builder access expired')
          }
        } catch {
          if (selected === connection) revoke('Builder access unavailable')
        }
      }
    } catch {
      if (selected) revoke('Builder lifecycle unavailable')
    } finally {
      polling = false
    }
  }

  function originAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin
    const host = req.headers.host
    if (typeof origin !== 'string' || !origin || typeof host !== 'string' || !host || req.headers['sec-fetch-site'] === 'cross-site') return false
    try {
      const parsed = new URL(origin)
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host.toLowerCase() === host.toLowerCase()
    } catch { return false }
  }

  async function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (closed || !originAllowed(req)) { socket.destroy(); return }
    let identity: BuilderSupervisorAuthResult
    try { identity = await options.auth.authenticate(req.headers.cookie) } catch { socket.destroy(); return }
    if (closed || socket.destroyed || socket.writableEnded) { socket.destroy(); return }
    const path = new URL(req.url ?? '/', 'http://local').pathname
    if (!isAdmin(identity) || !['/builder-browser', '/builder-browser/'].includes(path)) { socket.destroy(); return }
    wss.handleUpgrade(req, socket, head, client => {
      const connection: BrowserConnection = {
        socket: client,
        cookie: req.headers.cookie,
        principalId: identity.principal.id,
        display: identity.principal.display,
        tabId: randomUUID(),
        ready: false,
        generation: null,
        path: '/unavailable',
        pathAllowed: false,
        lastPong: Date.now(),
        queue: Promise.resolve(),
      }
      sockets.add(connection)
      client.on('pong', () => { connection.lastPong = Date.now() })
      client.on('message', data => {
        let frame: unknown
        try { frame = JSON.parse(data.toString()) } catch { sendError(connection, 'Invalid browser frame'); return }
        connection.queue = connection.queue.then(() => handleFrame(connection, frame)).catch(error => sendError(connection, errorMessage(error, 'Browser frame rejected')))
      })
      client.on('close', () => removeConnection(connection))
      client.on('error', () => removeConnection(connection))
      send(client, { type: 'state', state: state(connection.tabId) })
    })
  }

  const heartbeatTimer = setInterval(() => {
    for (const connection of sockets) {
      if (Date.now() - connection.lastPong > Math.min(MAX_LIVENESS_MS, heartbeatMs * 3)) { connection.socket.terminate(); continue }
      if (connection.socket.readyState === WebSocket.OPEN) { try { connection.socket.ping() } catch { connection.socket.terminate() } }
    }
  }, heartbeatMs)
  const pollTimer = setInterval(() => { void poll().catch(() => {}) }, pollMs)
  timers.add(heartbeatTimer)
  timers.add(pollTimer)
  unref(heartbeatTimer)
  unref(pollTimer)

  function close(): void {
    if (closed) return
    closed = true
    for (const timer of timers) clearInterval(timer)
    timers.clear()
    clearGrantTimer()
    rejectPending('Builder browser broker closed')
    selected = null
    grant = null
    for (const connection of sockets) connection.socket.terminate()
    sockets.clear()
    wss.close()
  }

  return { upgrade, execute, revoke, close }
}
