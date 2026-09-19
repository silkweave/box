import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer, type RawData } from 'ws'

/**
 * A READ-ONLY window onto a worker session's attach socket, for a caller who may watch the session
 * but must not drive it (a room's reader looking at that room's @nova turn - agent.mount.ts).
 *
 * WHY A RELAY AND NOT A GATE. workerdeck's attach socket is bidirectional: the socket that replays
 * the transcript also accepts `user_message`, `permission_decision`, `interrupt`, `clear_context`,
 * `set_permission_mode`, `set_model`, `tool_call_result` and `close`, and `handleCommand` in
 * @workerdeck/server 1.1.0 honors every one of them without consulting who is attached - `canSee`
 * is checked once, at the handshake. So a URL gate can only ever say "attach" or "do not attach";
 * there is no HTTP-level way to hand someone the downstream half of a WebSocket. And the panel's
 * `readOnly` prop is a client-side courtesy, not a control.
 *
 * The only read-only attach is one whose inbound side goes nowhere. That is what this is: this
 * server terminates the browser's socket itself, opens its OWN attach to the loopback listener as the
 * host (the boot key never leaves the process), forwards every frame the worker sends, and drops
 * every frame the browser sends. The browser's socket never reaches workerdeck at all, so the
 * guarantee is structural - there is no code path that forwards a browser frame, rather than a
 * list of frame types that are refused.
 *
 * Inbound frames are DROPPED, not punished with a close. The viewer's own client sends frames on
 * its own initiative in at least one legitimate case: @workerdeck/react answers a
 * `tool_call_request` with `tool_call_error` when it has no tool host (which is exactly how the
 * dialog mounts it). Closing on that would make a well-behaved viewer flap; dropping it keeps the
 * one property that matters, which is that nothing a viewer sends can reach the session.
 */

/** `noServer`: never listens; `clientTracking` off: nothing here needs a roster, and the set would only leak. */
const wss = new WebSocketServer({ noServer: true, clientTracking: false })

/** Codes `ws` will accept from `close()`. An abnormal upstream end reports 1005/1006, which cannot be re-sent, so it is restated as 1011. */
const relayCloseCode = (code: number): number =>
  code === 1000 || code === 1001 || code === 1008 || code === 1011 || (code >= 3000 && code <= 4999) ? code : 1011

/** How long the loopback handshake may take before the browser is told 502. In-process, so this is only ever a bug guard. */
const UPSTREAM_HANDSHAKE_MS = 10_000

export interface ReadOnlyRelay {
  /** The loopback attach URL, boot key included (`agent.mount.ts` builds it). */
  upstreamUrl: string
  req: IncomingMessage
  socket: Duplex
  head: Buffer
}

export function relayReadOnly({ upstreamUrl, req, socket, head }: ReadOnlyRelay): void {
  const upstream = new WebSocket(upstreamUrl, { handshakeTimeout: UPSTREAM_HANDSHAKE_MS })
  let client: WebSocket | undefined
  let settled = false
  // Frames that arrive between the upstream `open` and the browser handshake completing. The
  // worker sends `attached` plus the replay the instant it accepts the socket, and `ws` may deliver
  // those before this side has a client to hand them to; losing them would lose the transcript.
  const pending: Array<{ data: RawData; binary: boolean }> = []

  /** Refuse the browser's handshake with a bare HTTP status, the same way the worker itself does. */
  const refuse = (status: number, text: string): void => {
    if (settled) return
    settled = true
    if (socket.writable) socket.write(`HTTP/1.1 ${status} ${text}\r\n\r\n`)
    socket.destroy()
  }

  upstream.on('message', (data, binary) => {
    if (!client) {
      pending.push({ data, binary })
      return
    }
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary })
  })
  upstream.once('unexpected-response', (_request, response) => {
    // The worker answered the handshake in HTTP: 404 for a session it will not show, 401 for a
    // bad key. Mirror the status rather than inventing one, so the browser sees what a direct
    // attach would have seen.
    refuse(response.statusCode ?? 502, response.statusMessage || 'Bad Gateway')
    response.resume()
    upstream.terminate()
  })
  upstream.once('error', () => {
    if (client) client.close(1011, 'upstream error')
    else refuse(502, 'Bad Gateway')
  })
  // The browser went away before the upstream opened: nothing to relay to. After the handshake the
  // client's own 'close' covers this; closing an already-closed socket is a no-op in `ws`.
  socket.once('close', () => upstream.close())

  upstream.once('open', () => {
    if (settled) {
      upstream.close()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      settled = true
      client = ws
      for (const frame of pending.splice(0)) ws.send(frame.data, { binary: frame.binary })
      // The whole point. See the module comment for why this is a drop and not a close.
      ws.on('message', () => undefined)
      ws.on('close', () => upstream.close())
      ws.on('error', () => upstream.close())
      upstream.once('close', (code, reason) => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(relayCloseCode(code), reason)
        }
      })
    })
  })
}
