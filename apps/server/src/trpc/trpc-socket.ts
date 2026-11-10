import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { isStreamingAction, type Action, type SilkweaveContext } from '@silkweave/core'
import { trpc } from '@silkweave/nestjs/trpc'
import { buildRouter, createActionLogger, mapError } from '@silkweave/trpc'
import { initTRPC } from '@trpc/server'
import { applyWSSHandler } from '@trpc/server/adapters/ws'
import { WebSocketServer } from 'ws'
import { sameOrigin } from '@silkweave/box-core'
import { withCallContext } from '../auth/call-context.js'

type TrpcAdapter = ReturnType<typeof trpc>
type RegisterArgs = Parameters<TrpcAdapter['register']>[0]

/** Live feeds are small JSON frames; the client sends only subscribe and stop messages. */
const MAX_PAYLOAD_BYTES = 64 * 1024

/**
 * The socket's router: each streaming action as a subscription whose call context carries tRPC's
 * `signal`, which aborts when the client stops that subscription or its socket closes. The adapter's
 * own router drops the signal, so a feed parked in a wait would hold its listeners until its next
 * wake. Procedure keys come from the adapter's router, so both routers name an action the same way.
 */
function socketRouter(actions: Action[]) {
  const t = initTRPC.context<{ silkweaveContext: SilkweaveContext }>().create()
  const record: Record<string, ReturnType<typeof subscription>> = {}
  function subscription(action: Action) {
    const run = action.run as (input: unknown, context: SilkweaveContext) => AsyncIterable<unknown>
    return t.procedure.input(action.input as never).subscription(async function* ({ input, ctx, signal }) {
      try {
        for await (const chunk of run(input, ctx.silkweaveContext.fork({ signal }))) {
          if (signal?.aborted) return
          yield chunk
        }
      } catch (error) {
        throw mapError(error)
      }
    })
  }
  for (const action of actions) {
    const [key] = Object.keys((buildRouter([action]) as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures)
    record[key!] = subscription(action)
  }
  return t.router(record)
}

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
    register(registered: RegisterArgs) {
      // Every call, over HTTP (batches included) and over the socket, runs in its own request frame.
      const args = { ...registered, actions: registered.actions.map(withCallContext) }
      http.register(args)
      const { baseContext } = args
      const logger = createActionLogger()
      applyWSSHandler({
        wss,
        router: socketRouter(args.actions.filter(isStreamingAction)),
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
