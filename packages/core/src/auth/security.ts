// App-layer hardening for a Box that is reachable beyond the machine it runs on: strict security
// headers (the SPA is fully self-contained, so a tight CSP is free) and a tiny in-memory
// fixed-window rate limiter. Applied by `apps/server/src/main.ts` to every response, so it holds
// for a Box with no features installed. See docs/SERVER.md and docs/AUTH.md.

import type { ServerResponse } from 'node:http'

/** Content-Security-Policy: only same-origin, inline styles/scripts allowed (the SPA inlines both),
 *  no framing, no object embeds. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  // Avatars (users.image / collaborators.image) are arbitrary https URLs (a company CDN, a gravatar) - allow
  // any https image. Images are low XSS risk; scripts/styles/connect stay locked to 'self'.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

export interface SecurityHeaderOptions {
  /** Emit the strict CSP. Off in dev (Vite HMR needs eval/ws + an inline dev client). Default true. */
  csp?: boolean
  /** Emit HSTS (only meaningful once served over HTTPS/public). Default false. */
  hsts?: boolean
}

export function setSecurityHeaders(res: ServerResponse, opts: SecurityHeaderOptions = {}): void {
  const { csp = true, hsts = false } = opts
  if (csp) res.setHeader('Content-Security-Policy', CSP)
  if (hsts) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()')
}

/** A loopback peer - the only peer whose `x-forwarded-*` headers are worth believing.
 *  Shared with `requestIsSecure` (auth/session.ts), which made this check first. */
export function isLoopbackPeer(addr: string | null | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

/**
 * Whether a browser request comes from this Box's own pages: no cross-site fetch metadata, and an
 * `Origin` (when present) naming the host it was sent to. The guard for cookie-authenticated
 * requests that carry no CSRF header, such as WebSocket upgrades, which browsers send cross-site
 * with the page's cookies. A request without `Origin` is not a browser page and passes.
 */
export function sameOrigin(req: { headers: Record<string, string | string[] | undefined> }): boolean {
  const origin = req.headers.origin
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  if (!origin) return true
  try { return new URL(String(origin)).host === req.headers.host } catch { return false }
}

/** The structural shape `clientIp` needs, so core takes no express/node http type dependency. */
export interface PeerRequest {
  socket?: { remoteAddress?: string | null }
  headers?: Record<string, unknown>
}

/**
 * The address to key a rate-limit bucket on.
 *
 * `x-forwarded-for` is honoured ONLY from a loopback peer, and then only its RIGHTMOST hop. Both
 * halves are load-bearing, and both were wrong before 2026-09-15:
 *
 *  - Trusting any peer meant a caller varied the header per request, landed in a fresh bucket every
 *    time, and defeated all three limiters (`api:`, `login:`, `link:`). That is the whole point of
 *    having them.
 *  - Taking the FIRST hop is the wrong end. A client can prepend whatever it likes; a proxy APPENDS
 *    the peer it saw. `tailscale serve` is a Go httputil.ReverseProxy, which appends - so the
 *    rightmost hop is the one our own proxy wrote, and the only one a client cannot forge.
 *
 * Trade-off, and it is the same one `requestIsSecure` already accepts: behind a proxy that is NOT
 * on loopback (a container network), every client collapses into one bucket keyed on the proxy.
 * That fails toward over-limiting a shared bucket, never toward an unlimited one.
 */
export function clientIp(req: PeerRequest): string {
  const peer = req.socket?.remoteAddress ?? ''
  if (!isLoopbackPeer(peer)) return peer || 'unknown'
  const xff = req.headers?.['x-forwarded-for']
  const raw = Array.isArray(xff) ? xff.join(',') : typeof xff === 'string' ? xff : ''
  const hops = raw
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)
  return hops[hops.length - 1] || peer || 'unknown'
}

// Fixed-window limiter keyed by an arbitrary bucket string (IP for login, session id for actions).
const hits = new Map<string, { count: number; resetAt: number }>()

/** Returns true if the caller is WITHIN the limit (and records the hit); false if over. */
export function rateLimit(bucket: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const cur = hits.get(bucket)
  if (!cur || now > cur.resetAt) {
    hits.set(bucket, { count: 1, resetAt: now + windowMs })
    return true
  }
  cur.count += 1
  return cur.count <= limit
}

// Opportunistic cleanup so the map can't grow unbounded on a long-lived process.
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k)
}, 60_000).unref()
