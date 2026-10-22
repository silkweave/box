// Shared connector for driving a teammate's REAL, HUMAN-LOGGED-IN browser, via Shuttle.
//
// Instead of launching a fresh Playwright browser (clean fingerprint, no sessions) or juggling
// per-service API tokens, we drive Shuttle on the browser host: one browser in which every
// teammate is an AGENT with its own persistent, isolated storage (cookies, logins). See
// docs/BROWSERS.md for the setup and the safety rules.
//
// The unit of access is a SESSION, not the whole browser: we open a Shuttle session for an agent,
// allocate a tab in it, and attach Playwright to the session's own CDP endpoint, which only sees
// that session's tabs and that agent's storage. Concurrent jobs therefore never fight over one tab,
// but Shuttle has no idle reaper: a session that is never closed keeps its tabs open, so every
// connect must be paired with detach(). Sessions this Box leaves behind (a crashed process, a page
// kept up for a human) are recorded and swept on the next connect.
//
// Any service can use this: connect for an agent, open a page, drive it, detach. Reddit is the
// first consumer (its OAuth API path is blocked); other browser-driven reads, such as the LinkedIn
// comment poll, use the same path.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import { boxJson } from '../box-config.js'
import { dataPath } from '../io.js'

function setting(name: 'url' | 'identity' | 'token'): string | undefined {
  const value = boxJson().browsers[name]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value !== undefined && value !== null) throw new Error(`browsers.${name} must be a nonempty string`)
  return undefined
}

/**
 * Shuttle's MCP endpoint. `browsers.url` may name the endpoint itself or only the browser's origin
 * (`http://host:port`), in which case `/mcp` is appended.
 */
export function BROWSER_URL(): string {
  const raw = setting('url') ?? 'http://127.0.0.1:9222/mcp'
  const url = new URL(raw)
  if (url.pathname === '' || url.pathname === '/') url.pathname = '/mcp'
  return url.toString()
}

/** The Shuttle agent a lease uses when the caller names none. */
export const DEFAULT_IDENTITY = (): string => setting('identity') ?? 'default'

/**
 * Call one Shuttle MCP tool statelessly (no `initialize`) and return its parsed result. The body may
 * be plain JSON or SSE `data:` lines; a JSON-RPC error or `isError: true` result throws with the
 * tool's message. A bearer token is sent only when `browsers.token` is set (Shuttle network mode).
 */
export async function browserTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const token = setting('token')
  const res = await fetch(BROWSER_URL(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Shuttle ${name} -> ${res.status} ${text.slice(0, 300)}`)
  const message = parseRpcBody(text)
  if (message.error) throw new Error(`Shuttle ${name}: ${message.error.message ?? JSON.stringify(message.error)}`)
  const result = message.result ?? {}
  const body = (result.content ?? []).map((part) => part.text ?? '').join('')
  if (result.isError) throw new Error(`Shuttle ${name}: ${body || 'tool error'}`)
  if (result.structuredContent !== undefined) return result.structuredContent as T
  try {
    return JSON.parse(body) as T
  } catch {
    return body as T
  }
}

interface RpcMessage {
  result?: { content?: { text?: string }[]; structuredContent?: unknown; isError?: boolean }
  error?: { message?: string }
}

/** A JSON-RPC response body: whole JSON, or SSE whose last `data:` payload carries the response. */
function parseRpcBody(text: string): RpcMessage {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as RpcMessage
  const payloads = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
  for (const payload of payloads.reverse()) {
    const message = JSON.parse(payload) as RpcMessage & { id?: unknown }
    if (message.result !== undefined || message.error !== undefined) return message
  }
  throw new Error(`Shuttle returned no JSON-RPC response: ${trimmed.slice(0, 200)}`)
}

/** An open Shuttle session plus the tab allocated in it. Always release when done. */
interface Lease {
  identity: string
  sessionId: string
  targetId: string
  cdpEndpoint: string
}

// Browser -> its lease, so detach() can close the session without changing every call site's shape.
const leases = new WeakMap<Browser, Lease>()

/**
 * Open a Shuttle session for agent `identity`, allocate a tab in it and attach Playwright to the
 * session's CDP endpoint (not the tab's), so Playwright sees the agent's one persistent context with
 * the allocated page in it.
 *
 * The returned Browser is a CONNECTION to a session, not a process we own: never launch or kill it.
 * Pair every call with detach(), which closes the connection AND the session.
 */
export async function connectCDP(identity: string = DEFAULT_IDENTITY()): Promise<Browser> {
  await sweepStaleLeases()

  let lease: Lease
  try {
    const session = await browserTool<{ sessionId: string; cdpEndpoint: string }>('open-session', { agent: identity })
    recordLease({ sessionId: session.sessionId, identity, pid: process.pid, openedAt: new Date().toISOString() })
    try {
      const tab = await browserTool<{ targetId: string }>('allocate-tab', { sessionId: session.sessionId })
      lease = { identity, sessionId: session.sessionId, targetId: tab.targetId, cdpEndpoint: session.cdpEndpoint }
    } catch (err) {
      await releaseLease(session.sessionId)
      throw err
    }
  } catch (err) {
    throw new Error(
      `Could not open a Shuttle session for agent "${identity}" at ${BROWSER_URL()}.\n` +
        `  • Is Shuttle running? Its list-sessions tool must answer at that URL.\n` +
        `  • Is "${identity}" an existing Shuttle agent? (list-agents; see browsers.users in box.json)\n` +
        `  • Running the Box off the browser host? Point browsers.url at the host and set browsers.token (network mode).\n` +
        `Underlying: ${(err as Error).message}`,
    )
  }

  try {
    const browser = await chromium.connectOverCDP(lease.cdpEndpoint)
    leases.set(browser, lease)
    return browser
  } catch (err) {
    // Don't leak the session we just opened if Playwright can't attach to it.
    await releaseLease(lease.sessionId)
    throw new Error(`Opened a Shuttle session for "${identity}" but Playwright could not attach.\nUnderlying: ${(err as Error).message}`)
  }
}

/** Close a session (and every tab in it). Release errors are swallowed: an unknown id is already gone. */
async function releaseLease(sessionId: string): Promise<void> {
  await browserTool('close-session', { sessionId }).catch(() => undefined)
  forgetLease(sessionId)
}

/**
 * The browser's first context: the agent's real, logged-in storage. We attach to it (shared
 * cookies, warmed fingerprint) rather than creating a fresh context, which would be
 * unauthenticated and defeat the point of using the agent's persistent storage.
 */
export function firstContext(browser: Browser): BrowserContext {
  const [ctx] = browser.contexts()
  if (!ctx) throw new Error('CDP session exposed no contexts - is the Shuttle agent available?')
  return ctx
}

/**
 * Detach and close the Shuttle session. browser.close() on a connectOverCDP browser only drops the
 * Playwright connection; the session's tabs stay until close-session, so skipping the release would
 * leave them open forever.
 *
 * `keepTab` is the one exception: closing the session CLOSES its tabs, so a flow whose whole point is
 * to leave a page up for a human (redditLogin) keeps the session open. The human works in the Shuttle
 * window and closes the tab there; the next connect sweeps the emptied session.
 */
export async function detach(browser: Browser, opts: { keepTab?: boolean } = {}): Promise<void> {
  const lease = leases.get(browser)
  try {
    await browser.close()
  } finally {
    if (lease) {
      leases.delete(browser)
      if (opts.keepTab) recordLease({ sessionId: lease.sessionId, identity: lease.identity, pid: process.pid, openedAt: new Date().toISOString(), kept: true })
      else await releaseLease(lease.sessionId)
    }
  }
}

/** Open a session, run `fn`, and always detach + close: the shape every consumer should prefer. */
export async function withBrowser<T>(identity: string, fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await connectCDP(identity)
  try {
    return await fn(browser)
  } finally {
    await detach(browser)
  }
}

// ---------------- Stale lease sweep ----------------
//
// Shuttle keeps a session until someone closes it. The Box records every session it opens in
// `data/browser-leases.json` and, before each new lease, closes the ones it left behind: those whose
// owning process is gone, and kept sessions once the human has closed their tabs or a day has passed.
// Sessions opened by anyone else (people, other agents) are never touched.

interface LeaseRecord {
  sessionId: string
  identity: string
  pid: number
  openedAt: string
  kept?: boolean
}

const KEPT_MAX_AGE_MS = 24 * 60 * 60 * 1000
const ledgerPath = (): string => dataPath('browser-leases.json')

function readLedger(): LeaseRecord[] {
  try {
    if (!existsSync(ledgerPath())) return []
    const parsed = JSON.parse(readFileSync(ledgerPath(), 'utf8')) as unknown
    return Array.isArray(parsed) ? (parsed as LeaseRecord[]).filter((r) => r && typeof r.sessionId === 'string') : []
  } catch {
    return []
  }
}

function writeLedger(records: LeaseRecord[]): void {
  try {
    mkdirSync(dirname(ledgerPath()), { recursive: true })
    const tmp = `${ledgerPath()}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(records, null, 2) + '\n')
    renameSync(tmp, ledgerPath())
  } catch {
    /* the ledger is best-effort bookkeeping; a lease never fails on it */
  }
}

function recordLease(record: LeaseRecord): void {
  writeLedger([...readLedger().filter((r) => r.sessionId !== record.sessionId), record])
}

function forgetLease(sessionId: string): void {
  const records = readLedger()
  const next = records.filter((r) => r.sessionId !== sessionId)
  if (next.length !== records.length) writeLedger(next)
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Close the sessions this Box left behind. Best-effort: a sweep never blocks a new lease. */
export async function sweepStaleLeases(now: number = Date.now()): Promise<string[]> {
  const records = readLedger()
  if (!records.length) return []
  let open: Map<string, { tabs?: unknown[] }>
  try {
    const listed = await browserTool<{ sessions?: { sessionId: string; tabs?: unknown[] }[] }>('list-sessions')
    open = new Map((listed.sessions ?? []).map((s) => [s.sessionId, s]))
  } catch {
    return []
  }
  const closed: string[] = []
  for (const record of records) {
    const session = open.get(record.sessionId)
    if (!session) {
      forgetLease(record.sessionId)
      continue
    }
    const stale = record.kept
      ? (session.tabs ?? []).length === 0 || now - Date.parse(record.openedAt) > KEPT_MAX_AGE_MS
      : !processAlive(record.pid)
    if (stale) {
      await releaseLease(record.sessionId)
      closed.push(record.sessionId)
    }
  }
  return closed
}
