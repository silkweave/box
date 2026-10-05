import { createHash } from 'node:crypto'
import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders } from 'node:http'

/**
 * Built-mode ("dual") routing. Everyone loads the promoted release; only an admin's Builder Preview
 * loads the live Vite module graph while a Builder session runs. The supervisor decides per
 * request and tells the app with a trusted header it strips from every client request.
 */
export const FRONTEND_HEADER = 'x-box-frontend'

// Paths only Vite's dev server answers. A release tab never asks for them.
const VITE_ONLY = /^\/(?:@vite\/|@fs\/|@id\/|@react-refresh$|@vite-plugin-[^/]+|__open-in-editor$|node_modules\/|src\/)/

export function isViteOnlyRequest(url: URL): boolean {
  return VITE_ONLY.test(url.pathname) || (url.pathname === '/index.html' && url.searchParams.has('html-proxy'))
}

/**
 * A document navigation inside a frame. Only the Builder shell frames the application (the app's
 * CSP allows `frame-ancestors 'self'` for HTML), so this marks the Preview iframe, including its
 * reloads. A browser without Fetch Metadata falls back to the release, which is safe.
 */
export function isPreviewDocument(req: Pick<IncomingMessage, 'method' | 'headers'>): boolean {
  return (req.method === 'GET' || req.method === 'HEAD') && req.headers['sec-fetch-dest'] === 'iframe'
}

/** Vite's HMR client opens its socket with the `vite-hmr` (or `vite-ping`) subprotocol. */
export function isViteSocket(headers: IncomingHttpHeaders): boolean {
  return /\bvite-(?:hmr|ping)\b/.test(String(headers['sec-websocket-protocol'] ?? ''))
}

/**
 * A short positive and negative cache in front of the admin check, so a Preview loading hundreds
 * of modules costs one `/api/auth/me` round trip, not hundreds. Keyed by a digest of the cookie.
 */
export function createDevAccessCache(check: (cookie: string) => Promise<boolean>, options: { ttlMs?: number; now?: () => number; max?: number } = {}) {
  const ttlMs = options.ttlMs ?? 10_000
  const now = options.now ?? Date.now
  const max = options.max ?? 256
  const entries = new Map<string, { allowed: boolean; until: number }>()
  return {
    async allowed(cookie: string | undefined): Promise<boolean> {
      if (!cookie) return false
      const key = createHash('sha256').update(cookie).digest('base64url')
      const hit = entries.get(key)
      if (hit && hit.until > now()) return hit.allowed
      const allowed = await check(cookie)
      if (entries.size >= max) entries.delete(entries.keys().next().value!)
      entries.set(key, { allowed, until: now() + ttlMs })
      return allowed
    },
    clear(): void { entries.clear() },
  }
}

const COMPRESSIBLE = /\b(?:javascript|ecmascript|css|html|json|svg\+xml|typescript)\b/

/**
 * Whether to gzip a Vite response on the way out. Vite sends its unminified module graph
 * uncompressed, which is tens of megabytes over a remote link; loopback clients skip the CPU.
 */
export function shouldCompressDevResponse(input: { acceptEncoding: string | string[] | undefined; clientIp: string; status: number | undefined; headers: OutgoingHttpHeaders }): boolean {
  if (input.status !== 200) return false
  if (/^(?:127\.|::1$|::ffff:127\.)/.test(input.clientIp)) return false
  if (!/\bgzip\b/.test(String(input.acceptEncoding ?? ''))) return false
  if (input.headers['content-encoding']) return false
  const type = String(input.headers['content-type'] ?? '')
  return COMPRESSIBLE.test(type) && !type.includes('event-stream')
}
