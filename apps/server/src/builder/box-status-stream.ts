import { watchFile, unwatchFile } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'

/** The socket surface the stream uses, so tests can drive it without a network. */
export type StatusClient = Pick<WebSocket, 'send' | 'ping' | 'terminate' | 'bufferedAmount' | 'on' | 'once'>

const HEARTBEAT_MS = 15_000
/** A status frame is a few hundred bytes; a client this far behind is gone or stalled. */
const MAX_BUFFERED_BYTES = 64 * 1024

/**
 * One file watcher and heartbeat for all tabs, owned by the stable supervisor. Each tab follows it
 * over a WebSocket at /api/box-status/events: a WebSocket does not take one of the browser's six
 * HTTP/1.1 connections per host, which every tab of a profile shares. Each frame is the full status
 * as JSON; the client reconnects on close and receives a fresh snapshot.
 */
export function createBoxStatusStream(file: string, read: () => { maintenance: boolean; release?: string | null; notice?: unknown }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 })
  const clients = new Set<StatusClient>()
  const alive = new WeakMap<StatusClient, boolean>()
  let watching = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let last: string | undefined
  const encode = () => {
    // Undefined fields drop out of the frame: a dev Box has no release, a Box outside maintenance no notice.
    const { maintenance, release, notice } = read()
    return JSON.stringify({ maintenance, release, notice: notice ?? undefined })
  }
  function stop() {
    if (watching) unwatchFile(file, refresh)
    watching = false
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = undefined
    last = undefined
  }
  function disconnect() {
    stop()
    for (const client of clients) client.terminate()
    clients.clear()
  }
  function send(client: StatusClient, frame: string) {
    // Slow/disconnected clients reconnect for a fresh snapshot; never accumulate a queue.
    if (client.bufferedAmount > MAX_BUFFERED_BYTES) { client.terminate(); return }
    client.send(frame)
  }
  function refresh() {
    try {
      const next = encode()
      if (next === last) return
      last = next
      for (const client of clients) send(client, next)
    } catch { disconnect() } // Reconnect instead of asserting stale state after a read error.
  }
  function open(client: StatusClient) {
    const snapshot = encode()
    if (!watching) {
      // Stat the stable path: atomic replacements and native watcher limits are safe.
      watchFile(file, { interval: 500, persistent: false }, refresh)
      watching = true
      heartbeat = setInterval(() => {
        refresh() // Also recover from a missed filesystem notification.
        for (const each of clients) {
          // A client that missed the previous ping's pong is gone (sleep, network change).
          if (alive.get(each) === false) { each.terminate(); continue }
          alive.set(each, false)
          each.ping()
        }
      }, HEARTBEAT_MS)
      heartbeat.unref()
    }
    refresh()
    clients.add(client)
    alive.set(client, true)
    client.on('pong', () => alive.set(client, true))
    client.on('error', () => client.terminate())
    client.once('close', () => { clients.delete(client); if (!clients.size) stop() })
    send(client, snapshot)
    last = snapshot
  }
  return {
    open,
    upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
      wss.handleUpgrade(req, socket, head, ws => { try { open(ws) } catch { ws.terminate() } })
    },
    /** Push a change that did not come from the control file, such as a promoted web release. */
    refresh(): void { if (clients.size) refresh() },
    close(): void { disconnect(); wss.close() },
  }
}
