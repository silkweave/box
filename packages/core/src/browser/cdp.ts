// Shared connector for driving a teammate's REAL, HUMAN-LOGGED-IN Chrome, via chromatrix.
//
// Instead of launching a fresh Playwright browser (clean fingerprint, no sessions) or juggling
// per-service API tokens, we drive the persistent headed Chrome that chromatrix runs on the browser
// host - one long-lived browser per teammate ("identity"), each with its own profile and logins.
// See docs/BROWSERS.md for the setup and the safety rules.
//
// The unit of access is a LEASED TAB, not the whole browser: we ask chromatrix for a tab of our
// own, it mints a scoped CDP URL, and the gateway's ACL denies us every target outside that
// lease. Concurrent jobs therefore no longer fight over one shared tab - but a lease that is
// never released leaks a tab and a window, so every connect must be paired with detach().
//
// Any service can use this: connect for an identity, open a page, drive it, detach. Reddit is the
// first consumer (its OAuth API path is blocked); LinkedIn article drafting, engagement verify and
// the LinkedIn comment poll use the same path.

import { chromium, type Browser, type BrowserContext } from 'playwright-core'
import { boxJson } from '../box-config.js'

function setting(name: 'url' | 'identity' | 'token', fallback?: string): string {
  const value = boxJson().browsers[name]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (value !== undefined && value !== null) throw new Error(`browsers.${name} must be a nonempty string`)
  if (fallback !== undefined) return fallback
  throw new Error(`Set browsers.${name} in box.local.json`)
}

export const CHROMATRIX_URL = (): string => setting('url', 'http://127.0.0.1:8830')
export const DEFAULT_IDENTITY = (): string => setting('identity', 'default')
const chromatrixToken = (): string => setting('token')

async function api<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${CHROMATRIX_URL()}/api/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${chromatrixToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`chromatrix ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`)
  return (await res.json()) as T
}

/** A leased tab plus the Playwright connection driving it. Always release() when done. */
interface Lease {
  identity: string
  targetId: string
  cdpUrl: string
}

// Browser -> its lease, so detach() can release the tab without changing every call site's shape.
const leases = new WeakMap<Browser, Lease>()

/**
 * Lease a tab for `identity` and attach Playwright to it.
 *
 * `compat: true` is REQUIRED for Playwright: it asks chromatrix to mint a CDP URL that gets the
 * unmitigated protocol. Without it the gateway's fidelity mitigations suppress `Runtime.enable`,
 * and the first navigation strands Playwright waiting for a main-world execution context that
 * never arrives (goto resolves, then title()/textContent() hang forever).
 *
 * The returned Browser is a CONNECTION over a leased tab, not a process we own - never launch or
 * kill it. Pair every call with detach(), which closes the connection AND releases the lease.
 */
export async function connectCDP(identity: string = DEFAULT_IDENTITY()): Promise<Browser> {
  // Not idempotent: a 409 means "already running", which is exactly what we want. Any other
  // failure will resurface as a clearer error from tab/allocate below.
  await api('identity/start', { id: identity }).catch(() => undefined)

  let lease: Lease
  try {
    const res = await api<{ cdpUrl: string; targetId: string }>('tab/allocate', {
      identity,
      agentId: `box-${process.pid}-${Date.now()}`,
      compat: true,
    })
    lease = { identity, targetId: res.targetId, cdpUrl: res.cdpUrl }
  } catch (err) {
    throw new Error(
      `Could not lease a chromatrix tab for "${identity}" at ${CHROMATRIX_URL()}.\n` +
      `  • Is the gateway up?  curl ${CHROMATRIX_URL()}/api/sessions -H "Authorization: Bearer <token>"\n` +
        `  • A bare 500 from tab/allocate almost always means the identity is not running.\n` +
        `  • Running the Box off the browser host? Point browsers.url at its tailnet origin\n` +
        `  • Is "${identity}" a real identity registered with the gateway? (see browsers.users in box.json)\n` +
        `Underlying: ${(err as Error).message}`,
    )
  }

  try {
    const browser = await chromium.connectOverCDP(lease.cdpUrl)
    leases.set(browser, lease)
    return browser
  } catch (err) {
    // Don't leak the tab we just leased if Playwright can't attach to it.
    await releaseLease(lease)
    throw new Error(`Leased a chromatrix tab for "${identity}" but Playwright could not attach.\nUnderlying: ${(err as Error).message}`)
  }
}

async function releaseLease(lease: Lease): Promise<void> {
  await api('tab/release', { identity: lease.identity, targetId: lease.targetId }).catch(() => undefined)
}

/**
 * The browser's first context - the identity's real, logged-in session. We attach to it (shared
 * cookies, warmed fingerprint) rather than creating a fresh context, which would be
 * unauthenticated and defeat the point of using the persistent profile.
 */
export function firstContext(browser: Browser): BrowserContext {
  const [ctx] = browser.contexts()
  if (!ctx) throw new Error('CDP browser exposed no contexts - is the identity actually running?')
  return ctx
}

/**
 * Detach WITHOUT closing the identity's browser, and release the leased tab. browser.close() on a
 * connectOverCDP browser tears down the Playwright connection only; it does not terminate the
 * Chrome process. Skipping the release would leave the tab (and its window) leased forever.
 *
 * `keepTab` is the one exception: releasing a tab CLOSES it, so a flow whose whole point is to
 * leave a page up for a human (redditLogin) must keep it. That deliberately holds the lease -
 * the human ends it by closing the tab from the chromatrix dashboard.
 */
export async function detach(browser: Browser, opts: { keepTab?: boolean } = {}): Promise<void> {
  const lease = leases.get(browser)
  try {
    await browser.close()
  } finally {
    if (lease) {
      leases.delete(browser)
      if (!opts.keepTab) await releaseLease(lease)
    }
  }
}

/** Lease a tab, run `fn`, and always detach + release - the shape every consumer should prefer. */
export async function withBrowser<T>(identity: string, fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await connectCDP(identity)
  try {
    return await fn(browser)
  } finally {
    await detach(browser)
  }
}
