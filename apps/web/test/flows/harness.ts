// Gate C's vocabulary: a flow spec drives the REAL web app (router, providers, server) of this
// checkout's running dev Box through a transition that broke before, as a signed-in principal, and
// checks what a person would see: text, address, focus, dialogs and how many requests went out.
// Specs live beside this file as `*.spec.ts`; `run.ts` signs in and runs them in headless Chromium.
//
// Repeatable by construction: a spec forces failures, delays and empty-then-populated reads with
// `page.route` (see `interceptTrpc`) instead of depending on the instance's state, and deletes what
// it creates through `cleanup`; browser storage it changes dies with its own context. Every locator
// must match exactly once (`one`), so a probe cannot pass on the wrong element.

import type { BrowserContext, Locator, Page, Route } from 'playwright-core'

/** `admin` signs in as `toby`, `member` as `ds-member`. */
export type Principal = 'admin' | 'member'
export const PRINCIPALS: Record<Principal, string> = { admin: 'toby', member: 'ds-member' }

export interface FlowSpec {
  name: string
  /** Defaults to `admin`. */
  as?: Principal
  /** Defaults to 1280 x 900. */
  viewport?: { width: number; height: number }
  run: (ctx: FlowContext) => Promise<void>
}

export interface FlowContext {
  page: Page
  context: BrowserContext
  /** The Box's origin, e.g. `http://localhost:8190`. */
  base: string
  /** Open `path` (with any `#hash`) and wait until the app shell has rendered. */
  open: (path: string) => Promise<void>
  /** Run after the spec, pass or fail, in reverse order: delete created records, restore storage. */
  cleanup: (fn: () => Promise<unknown>) => void
}

export class SpecFailure extends Error {}

export function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new SpecFailure(message)
}

/** The one match of `locator`, waiting up to `timeout` ms (dev Vite can stall on a reload) for it to appear; fails on none or several. */
export async function one(locator: Locator, what: string, timeout = 15000): Promise<Locator> {
  await locator.first().waitFor({ state: 'attached', timeout }).catch(() => undefined)
  const n = await locator.count()
  check(n === 1, `${what}: expected exactly one match, found ${n}`)
  return locator
}

/** Passes once `locator` matches nothing (it went away or never came); fails after `timeout` ms. */
export async function none(locator: Locator, what: string, timeout = 8000): Promise<void> {
  const until = Date.now() + timeout
  while ((await locator.count()) > 0) {
    check(Date.now() < until, `${what}: still present after ${timeout}ms`)
    await new Promise((ok) => setTimeout(ok, 100))
  }
}

/** Polls `read` until `ok(value)`; fails with the last value seen. */
export async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string, timeout = 8000): Promise<T> {
  const until = Date.now() + timeout
  let last = await read()
  while (!ok(last)) {
    check(Date.now() < until, `${what}: got ${JSON.stringify(last)} after ${timeout}ms`)
    await new Promise((r) => setTimeout(r, 100))
    last = await read()
  }
  return last
}

/** The current location hash without `#`. */
export const hashOf = (page: Page): string => new URL(page.url()).hash.replace(/^#/, '')

/** The one open dialog titled `name` (Radix sets its accessible name from the title). */
export const dialog = (page: Page, name: string): Locator => page.getByRole('dialog', { name, exact: true })

// --- tRPC interception --------------------------------------------------------------------------
// The web client batches queries (`/trpc/a,b?batch=1`), so a rule targets one procedure inside a
// batch: the others still reach the server and get their real answers.

export type TrpcRule =
  /** Answer with a 500 error for this procedure. */
  | { fail: true; message?: string }
  /** Rewrite the real `result.data` (return the new data). */
  | { rewrite: (data: unknown) => unknown }
  /** Answer with `data` without reaching the server (a write that must not happen). */
  | { respond: unknown }
  /** Let it through after `ms`. */
  | { delay: number }

export interface TrpcCall { name: string; type: 'query' | 'mutation' }

/**
 * Route `/trpc/**` through `decide`: return a rule for a call to change it, or undefined to leave it
 * alone. Every call is recorded in the returned `calls` (in order), so a spec can count requests.
 */
export async function interceptTrpc(page: Page, decide: (call: TrpcCall, seen: number) => TrpcRule | undefined): Promise<{ calls: TrpcCall[]; count: (name: string) => number }> {
  const calls: TrpcCall[] = []
  const unsplittable: string[] = []
  const count = (name: string): number => calls.filter((c) => c.name === name).length
  await page.route('**/trpc/**', async (route: Route) => {
    const req = route.request()
    const url = new URL(req.url())
    const names = decodeURIComponent(url.pathname.split('/trpc/')[1] ?? '').split(',').filter(Boolean)
    if (names.length === 0 || req.headers()['upgrade']) return route.fallback()
    const type = req.method() === 'POST' ? 'mutation' : 'query'
    const rules = names.map((name) => {
      const call = { name, type } as TrpcCall
      calls.push(call)
      return decide(call, count(name))
    })
    if (rules.every((r) => r === undefined)) return route.fallback()
    const delay = Math.max(0, ...rules.map((r) => (r && 'delay' in r ? r.delay : 0)))
    if (delay) await new Promise((ok) => setTimeout(ok, delay))
    const failure = (r: TrpcRule | undefined) => ({
      error: { message: (r && 'fail' in r && r.message) || 'Forced failure (Gate C)', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } },
    })
    const local = (r: TrpcRule | undefined): boolean => !!r && ('fail' in r || 'respond' in r)
    if (rules.every(local)) {
      const items = rules.map((r) => (r && 'respond' in r ? { result: { data: r.respond } } : failure(r)))
      const failed = rules.some((r) => r && 'fail' in r)
      const body = url.searchParams.has('batch') ? items : items[0]
      return route.fulfill({ status: failed ? (rules.length > 1 && !rules.every((r) => r && 'fail' in r) ? 207 : 500) : 200, contentType: 'application/json', body: JSON.stringify(body) })
    }
    // A batch cannot be split: a call answered locally would still reach the server with the rest.
    if (rules.some((r) => r && 'respond' in r)) {
      unsplittable.push(names.join(','))
      return route.abort()
    }
    const response = await route.fetch()
    if (!rules.some((r) => r && ('fail' in r || 'rewrite' in r))) return route.fulfill({ response })
    const json = (await response.json()) as unknown
    const batched = Array.isArray(json)
    const items = (batched ? json : [json]) as { result?: { data?: unknown } }[]
    const out = items.map((item, i) => {
      const r = rules[i]
      if (r && 'fail' in r) return failure(r)
      if (r && 'rewrite' in r && item.result) return { result: { ...item.result, data: r.rewrite(item.result.data) } }
      return item
    })
    const anyError = out.some((o) => 'error' in o)
    await route.fulfill({ status: anyError ? (batched ? 207 : 500) : 200, contentType: 'application/json', body: JSON.stringify(batched ? out : out[0]) })
  })
  return {
    calls,
    count: (name) => {
      check(unsplittable.length === 0, `a locally answered call was batched with others and had to be aborted: ${unsplittable.join('; ')}`)
      return count(name)
    },
  }
}

/** Call a tRPC procedure as the signed-in principal (for setup and cleanup, never for the asserted path). */
export async function trpcCall<T = unknown>(page: Page, type: 'query' | 'mutation', name: string, input: unknown): Promise<T> {
  return page.evaluate(
    async ({ type, name, input }) => {
      const res =
        type === 'query'
          ? await fetch(`/trpc/${name}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { 'x-box-csrf': '1' } })
          : await fetch(`/trpc/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-box-csrf': '1' }, body: JSON.stringify(input) })
      const body = (await res.json()) as { result?: { data?: unknown }; error?: { message?: string } }
      if (!res.ok || body.error) throw new Error(`${name}: ${body.error?.message ?? res.status}`)
      return body.result?.data
    },
    { type, name, input },
  ) as Promise<T>
}
