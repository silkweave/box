import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { isStreamingAction } from '@silkweave/core'
import { trpc } from '@silkweave/nestjs/trpc'
import { buildRouter, createActionLogger } from '@silkweave/trpc'
import { applyWSSHandler } from '@trpc/server/adapters/ws'
import { WebSocketServer } from 'ws'
import { sameOrigin } from '@silkweave/box-core'

type TrpcAdapter = ReturnType<typeof trpc>
type RegisterArgs = Parameters<TrpcAdapter['register']>[0]

/** Live feeds are small JSON frames; the client sends only subscribe and stop messages. */
const MAX_PAYLOAD_BYTES = 64 * 1024

/**
 * The tRPC adapter plus one WebSocket per tab for live subscriptions.
 *
 * Browsers allow six HTTP/1.1 connections per host, shared by every tab of a profile, and each SSE
 * subscription holds one for its whole life. A WebSocket does not count against that limit, so the
 * dashboard's long-lived feeds (changes, chat) share one socket per tab instead. Queries,
 * mutations and SSE subscriptions keep the plain `/trpc` HTTP handler.
 *
 * The socket router holds only the streaming actions, built from the same actions as the HTTP
 * router, so every subscription runs its controller's guards exactly as it does over SSE. The guard
 * sees the upgrade request: its cookie identifies the caller for the life of the socket, and a
 * fresh upgrade (reconnect) re-reads it. Browsers send the page's cookies on a cross-site upgrade
 * and the upgrade carries no CSRF header, so the upgrade must come from this Box's own origin.
 */
export function trpcWithSocket(options: Parameters<typeof trpc>[0]): { adapter: TrpcAdapter; upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void; close(): void } {
  const http = trpc(options)
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES })
  let ready = false
  const adapter: TrpcAdapter = {
    ...http,
    register(args: RegisterArgs) {
      http.register(args)
      const { baseContext } = args
      const logger = createActionLogger()
      applyWSSHandler({
        wss,
        router: buildRouter(args.actions.filter(isStreamingAction)),
        createContext: ({ req }) => ({ silkweaveContext: baseContext.fork({ logger, request: req }) }),
        // Server pings find sockets whose peer vanished (a sleeping laptop, a dropped network).
        keepAlive: { enabled: true, pingMs: 30_000, pongWaitMs: 10_000 },
      })
      ready = true
    },
  }
  return {
    adapter,
    upgrade(req, socket, head) {
      if (!ready || !sameOrigin(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    },
    close() {
      for (const client of wss.clients) client.terminate()
      wss.close()
    },
  }
}
