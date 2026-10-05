import { watchFile, unwatchFile } from 'node:fs'
import type { ServerResponse } from 'node:http'

/** One file watcher and heartbeat for all tabs, owned by the stable supervisor. */
export function createBoxStatusStream(file: string, read: () => { maintenance: boolean; release?: string | null }) {
  const clients = new Set<ServerResponse>()
  let watching = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let last: string | undefined
  const encode = () => {
    const { maintenance, release } = read()
    return `data: ${JSON.stringify(release === undefined ? { maintenance } : { maintenance, release })}\n\n`
  }
  function stop() {
    if (watching) unwatchFile(file, refresh)
    watching = false
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = undefined
    last = undefined
  }
  function close() {
    stop()
    for (const client of clients) client.destroy()
    clients.clear()
  }
  function send(client: ServerResponse, frame: string) {
    // Slow/disconnected clients reconnect for a fresh snapshot; never accumulate a queue.
    if (!client.write(frame)) client.destroy()
  }
  function refresh() {
    try {
      const next = encode()
      if (next === last) return
      last = next
      for (const client of clients) send(client, next)
    } catch { close() } // Reconnect instead of asserting stale state after a read error.
  }
  return {
    open(res: ServerResponse) {
      const snapshot = encode()
      if (!watching) {
        // Stat the stable path: atomic replacements and native watcher limits are safe.
        watchFile(file, { interval: 500, persistent: false }, refresh)
        watching = true
        heartbeat = setInterval(() => {
          refresh() // Also recover from a missed filesystem notification.
          for (const client of clients) send(client, ': keepalive\n\n')
        }, 15_000)
        heartbeat.unref()
      }
      refresh()
      res.writeHead(200, {
        'content-type': 'text/event-stream', 'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      })
      clients.add(res)
      res.once('close', () => { clients.delete(res); if (!clients.size) stop() })
      send(res, `retry: 3000\n\n${snapshot}`)
      last = snapshot
    },
    /** Push a change that did not come from the control file, such as a promoted web release. */
    refresh(): void { if (clients.size) refresh() },
    close,
  }
}
