// The path-mount port. Lets a feature serve a top-level URL prefix itself, ahead of the SPA, in both
// topologies: the dev proxy to Vite and the production ServeStatic catch-all never see a mounted
// path. Artifacts is the first user: it serves trusted, agent-authored static trees at
// `/artifacts/<slug>/...` while `/artifacts` itself stays a client route.
//
// The standard inversion (SEAM: dependents register into dependencies). A feature registers from
// its server module's onModuleInit; apps/server/src/main.ts dispatches at request time, so the
// registration order against app.use() does not matter. Core authenticates every mounted request
// with the Box session (or a bearer token) before the handler runs: a mount is never public.

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Principal, PrincipalCredential } from './auth/principal.js'

export interface PathMountRequest {
  req: IncomingMessage
  res: ServerResponse
  /** Request path with the query string removed, still percent-encoded. */
  path: string
  principal: Principal
  credential: PrincipalCredential
}

export interface PathMount {
  /** Stable id (the feature's). */
  id: string
  /** Path prefix this mount owns, with both slashes: `/artifacts/`. The bare `/artifacts` stays the SPA's. */
  prefix: string
  handle: (ctx: PathMountRequest) => Promise<void> | void
}

const mounts = new Map<string, PathMount>()

const PREFIX = /^\/[a-z0-9][a-z0-9-]*\/$/
/** Prefixes that belong to core, Vite or the shipped SPA files. Mounting one would shadow them. */
const RESERVED_ROOTS = new Set([
  'api', 'trpc', 'mcp', 'agent', 'builder', 'builder-agent', 'builder-browser', 'builder-assets',
  'login', 'assets', 'src', 'node_modules', 'settings',
])

/** Register a mount. Returns the unregister. */
export function registerPathMount(mount: PathMount): () => void {
  if (!PREFIX.test(mount.prefix)) throw new Error(`path mount "${mount.id}": prefix must look like /name/`)
  if (RESERVED_ROOTS.has(mount.prefix.slice(1, -1))) throw new Error(`path mount "${mount.id}": ${mount.prefix} is reserved`)
  for (const other of mounts.values()) {
    if (other.prefix === mount.prefix) throw new Error(`path mount "${mount.id}": ${mount.prefix} already mounted by "${other.id}"`)
  }
  if (mounts.has(mount.id)) throw new Error(`path mount "${mount.id}" registered twice`)
  mounts.set(mount.id, mount)
  return () => {
    if (mounts.get(mount.id) === mount) mounts.delete(mount.id)
  }
}

/** The mount owning `path` (query already stripped), if any. */
export function findPathMount(path: string): PathMount | undefined {
  for (const mount of mounts.values()) if (path.startsWith(mount.prefix)) return mount
  return undefined
}

/**
 * Where an unauthenticated browser is sent: the SPA's sign-in gate, which returns to `path` after
 * sign-in (apps/web/src/App.tsx reads `next`). Only same-origin absolute paths are ever produced.
 */
export function pathMountSigninUrl(pathAndQuery: string): string {
  const safe = pathAndQuery.startsWith('/') && !pathAndQuery.startsWith('//') ? pathAndQuery : '/'
  return `/?next=${encodeURIComponent(safe)}`
}

/**
 * Headers for trusted, agent-authored content served from a mount. Replaces the strict global CSP
 * (which the supervisor also sets, so it must be overwritten rather than removed) with one that
 * allows any source, inline code and eval, keeps framing to this origin, and opens the permission
 * features a prototype may need. Call after the global setSecurityHeaders.
 */
export function setTrustedContentHeaders(res: ServerResponse): void {
  res.setHeader(
    'Content-Security-Policy',
    "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'self'",
  )
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Permissions-Policy', 'geolocation=(self), microphone=(self), camera=(self), fullscreen=(self)')
  res.setHeader('Referrer-Policy', 'same-origin')
}
