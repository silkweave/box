// One request frame per action call (core request-context.ts). tRPC HTTP batches run several
// procedures in one HTTP request, and a tRPC WebSocket's messages arrive outside Express, so a
// frame per HTTP request is either shared across concurrent calls or absent. Wrapping each action's
// `run` gives every call its own empty holder for AuthGuard to fill, on every transport the
// silkweave adapters serve. A streaming action is rebound on every step (`bindStream`).
//
// An area refusal a core accessor throws inside a handler (`AreaAccessError`, W8 R3: the accessor
// decides) leaves here as a 403, as the guard's refusal does; the adapters map only their own errors
// and Nest's HttpException, so it would otherwise reach the caller as a 500.

import { HttpException } from '@nestjs/common'
import { isStreamingAction, SilkweaveError, type Action } from '@silkweave/core'
import { AreaAccessError, bindStream, freshRequestFrame, runInRequest } from '@silkweave/box-core'

/** The message of a Nest exception, as the adapters word it. */
function messageOf(e: HttpException): string {
  const response = e.getResponse()
  const raw = typeof response === 'string' ? response : (response as { message?: unknown } | null)?.message ?? e.message
  return Array.isArray(raw) ? raw.join(', ') : String(raw)
}

/**
 * A refusal as the error the adapters understand. An area refusal is a 403 `area_access`. A refusal
 * of the Nest guard layer reaches here as an `HttpException` (MCP passes it through unmapped, so
 * the tool error would carry no code) or, over tRPC, as the adapter's generic `http_error`; its
 * status says what it was, so it leaves as `forbidden` (403) or `unauthorized` (401), and a guard's
 * area refusal keeps `area_access`. Anything else is unchanged.
 */
function asRefusal(e: unknown): unknown {
  if (e instanceof AreaAccessError) return new SilkweaveError(e.message, 'area_access', 403)
  if (e instanceof HttpException && (e.getStatus() === 403 || e.getStatus() === 401)) {
    const body = e.getResponse()
    const area = typeof body === 'object' && (body as { error?: unknown }).error === 'area_access'
    return e.getStatus() === 403
      ? new SilkweaveError(messageOf(e), area ? 'area_access' : 'forbidden', 403)
      : new SilkweaveError(messageOf(e), 'unauthorized', 401)
  }
  if (e instanceof SilkweaveError && e.code === 'http_error') {
    if (e.statusCode === 403) return new SilkweaveError(e.message, 'forbidden', 403)
    if (e.statusCode === 401) return new SilkweaveError(e.message, 'unauthorized', 401)
  }
  return e
}

/**
 * Aborts when the caller of a stream is gone: the signal a transport put on the context (a
 * subscription over the socket), or the HTTP request closing under it (an SSE subscription).
 */
function callerGone(context: unknown): { signal: AbortSignal | undefined; release(): void } {
  const store = context as { getOptional?: <T>(key: string) => T | undefined } | null
  const given = store?.getOptional?.<AbortSignal>('signal')
  const request = store?.getOptional?.<{ once?: (e: string, f: () => void) => unknown; off?: (e: string, f: () => void) => unknown }>('request')
  if (!request?.once || !request.off) return { signal: given, release() {} }
  const ac = new AbortController()
  const onClose = () => ac.abort()
  request.once('close', onClose)
  return { signal: given ? AbortSignal.any([given, ac.signal]) : ac.signal, release: () => { request.off!('close', onClose) } }
}

/** `action` with its `run` opening a fresh request frame per call. */
export function withCallContext<A extends Action>(action: A): A {
  const run = action.run as (input: unknown, context: unknown) => unknown
  if (isStreamingAction(action)) {
    // An async generator function itself: adapters tell a stream by `run`'s constructor.
    return {
      ...action,
      run: async function* (input: unknown, context: unknown) {
        const gone = callerGone(context)
        const frame = freshRequestFrame()
        if (gone.signal && frame.kind === 'request') frame.holder.closed = gone.signal
        try {
          yield* bindStream(frame, () => run(input, context) as AsyncIterable<unknown>)
        } catch (e) {
          throw asRefusal(e)
        } finally {
          gone.release()
        }
      },
    }
  }
  return {
    ...action,
    run: async (input: unknown, context: unknown) => {
      try {
        return await runInRequest(() => run(input, context))
      } catch (e) {
        throw asRefusal(e)
      }
    },
  }
}

interface RegisteringAdapter<Args extends { actions: Action[] }> {
  register(args: Args): unknown
}

/** An adapter whose actions each run in their own request frame. */
export function withCallContexts<Args extends { actions: Action[] }, T extends RegisteringAdapter<Args>>(adapter: T): T {
  return {
    ...adapter,
    register: (args: Args) => adapter.register({ ...args, actions: args.actions.map(withCallContext) }),
  }
}
