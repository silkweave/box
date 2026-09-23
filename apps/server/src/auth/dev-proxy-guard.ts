// What the Box origin lets through to the Vite dev server, decided before http-proxy sees the
// request. The dev proxy in main.ts forwards every non-reserved path to Vite, and Vite serves
// files: `/@fs/<absolute path>` for anything outside apps/web, plus the transform pipeline's
// `?raw`, `?url` and `?inline` readers. Vite bounds that with `server.fs.allow` (apps/web/vite.config.ts),
// but its check is a string comparison on its own decoding of the URL, it does not follow symlinks,
// and every few months a bypass in exactly that code gets a CVE. On 2026-09-23 the checkout root
// was in the allow list and an anonymous `/@fs/<root>/box.local.json` returned the session secret.
//
// This layer is deliberately NOT an authentication step for `/@fs/`. The login page is the SPA,
// and it loads the whole dashboard module graph before anyone signs in: packages/, features/,
// apps/web, and the Bun store under node_modules/ (fonts, Vite's client). A signed-in member needs
// exactly the same four directories, so "outside them but signed in" is never a legitimate
// request, and letting a session through would turn any member cookie into a read of
// `auth.sessionSecret` the day Vite's own check fails again. Same allow-set as vite.config.ts,
// enforced a second time, on the real path, with the oddities Vite has been bitten by refused
// outright. Keep the two lists in step.
//
// The one authenticated path is `/__open-in-editor`, Vite's launch-editor hook: not a file oracle,
// but a remote "open this file in the maintainer's editor" for whoever can reach the origin.

import { realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Directories under the checkout root that the dev server may serve to anyone: what the browser
 *  module graph reaches through `/@fs/` (measured on the login page, 2026-09-23: packages/,
 *  features/ and the Bun store), plus apps/web itself. The same list as `server.fs.allow` in
 *  apps/web/vite.config.ts; nothing in the browser graph imports apps/server, and that is the
 *  side that reads instance state. Change both files together. */
export const DEV_SOURCE_DIRS = ['apps/web', 'packages', 'features', 'node_modules'] as const

/** Inside the allowed directories but never served: tests park throwaway instance directories
 *  (a data.db, a box.json) under node_modules/.cache, and nothing a browser loads lives there. */
export const DEV_SOURCE_DENY = ['node_modules/.cache'] as const

export type DevProxyVerdict = 'forward' | 'session' | 'refuse'

/** Realpaths of the directories anyone may read through Vite, and of those refused within them. */
export interface DevSourceScope {
  roots: readonly string[]
  deny?: readonly string[]
}

/** Resolve a path to where the filesystem will actually read it: the realpath of the deepest
 *  existing ancestor, with the missing tail appended unchanged. `null` when nothing on the path
 *  exists (not even `/`, which only happens for garbage). A symlink anywhere on the existing part
 *  is followed, which is the whole point: Vite compares the requested string, not the target. */
export function resolveRealPath(path: string): string | null {
  const tail: string[] = []
  let current = path
  for (;;) {
    try {
      return tail.length ? join(realpathSync.native(current), ...tail) : realpathSync.native(current)
    } catch {
      const parent = dirname(current)
      if (parent === current) return null
      tail.unshift(basename(current))
      current = parent
    }
  }
}

const realDirs = (repoRoot: string, dirs: readonly string[]): string[] => {
  const out: string[] = []
  for (const dir of dirs) {
    try { out.push(realpathSync.native(join(repoRoot, dir))) } catch { /* not present in this checkout */ }
  }
  return out
}

/** The realpath of each allowed and denied directory under `repoRoot` (the checkout may itself
 *  sit behind a symlink, `/tmp` on macOS does). Missing directories are dropped rather than guessed. */
export function devSourceScope(repoRoot: string): DevSourceScope {
  return { roots: realDirs(repoRoot, DEV_SOURCE_DIRS), deny: realDirs(repoRoot, DEV_SOURCE_DENY) }
}

const FS_PREFIX = '/@fs/'
const OPEN_IN_EDITOR = '/__open-in-editor'
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

const decode = (raw: string): string | null => {
  try { return decodeURIComponent(raw) } catch { return null }
}

const inside = (roots: readonly string[], real: string): boolean =>
  roots.some((root) => real === root || real.startsWith(root.endsWith('/') ? root : `${root}/`))

/**
 * Decide what the dev proxy does with a request target, from the raw `req.url`.
 *
 *  - `forward`: hand to Vite as-is.
 *  - `session`: forward only for a caller with a valid Box session.
 *  - `refuse`: answer 403 here; Vite never sees it.
 *
 * Rules, most general first. The request target must be origin-form (`/...`) and must not carry a
 * fragment: browsers never send `#`, Vite rejects it since CVE-2025-32395, and it is how one of
 * its checks was confused. Any path is percent-decoded ONCE and refused if it does not decode, if
 * it contains control characters, or if it contains a `..` segment (Vite never emits one, and the
 * static servers behind it are the code that has had to be patched for them).
 *
 * `/@fs/` paths are held to the strict form Vite emits on POSIX: `/@fs/` followed by an absolute
 * path without a leading second slash, without `.` or empty segments or a trailing slash, without
 * backslashes, colons or a residual `%` after decoding (a doubly encoded `..` is a literal `%2e%2e`
 * to us and a `..` to whoever decodes next). What survives is resolved through `resolve` (symlinks
 * followed) and must land inside one of `scope.roots` and outside every `scope.deny`. The query
 * string is irrelevant: `?raw`, `?url`, `?inline` and `?import` change the representation of the
 * file the path names, never the file.
 *
 * Everything else that is not `/@fs/` (root-relative `/src/…`, `/node_modules/.vite/deps/…`,
 * `/@id/…` virtual modules, `/@vite/client`, public assets, SPA routes) is forwarded: Vite resolves
 * those against apps/web, its static server refuses to leave that root, and its transform pipeline
 * checks `fs.allow` on the resolved file. `/__open-in-editor` needs a session.
 */
export function classifyDevProxyRequest(
  rawUrl: string,
  scope: DevSourceScope,
  resolve: (path: string) => string | null = resolveRealPath,
): DevProxyVerdict {
  if (!rawUrl.startsWith('/') || rawUrl.includes('#')) return 'refuse'
  const path = rawUrl.split('?', 1)[0]!
  const decoded = decode(path)
  if (decoded === null || CONTROL_CHARS.test(decoded)) return 'refuse'
  const segments = decoded.split('/')
  if (segments.includes('..')) return 'refuse'

  if (!decoded.startsWith(FS_PREFIX)) {
    if (decoded === OPEN_IN_EDITOR || decoded.startsWith(`${OPEN_IN_EDITOR}/`)) return 'session'
    return 'forward'
  }

  if (decoded.includes('%') || decoded.includes('\\') || decoded.includes(':')) return 'refuse'
  const rest = decoded.slice(FS_PREFIX.length)
  if (rest.startsWith('/')) return 'refuse'
  const parts = rest.split('/')
  if (parts.some((part) => part === '' || part === '.')) return 'refuse'
  const real = resolve(`/${rest}`)
  if (real === null || inside(scope.deny ?? [], real)) return 'refuse'
  return inside(scope.roots, real) ? 'forward' : 'refuse'
}

export interface DevProxyGuardOptions {
  /** What anyone may read through Vite; see `devSourceScope`. */
  scope: DevSourceScope
  /** Does this request carry a valid Box session? Only consulted for `session` verdicts. */
  authenticate: (req: IncomingMessage) => Promise<boolean>
  /** Called for every request that is not forwarded, with the verdict that stopped it. */
  onRefuse?: (req: IncomingMessage, verdict: Exclude<DevProxyVerdict, 'forward'>) => void
  resolve?: (path: string) => string | null
}

const refuse = (res: ServerResponse): void => {
  res.statusCode = 403
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end('Restricted')
}

/** The middleware half: applies `classifyDevProxyRequest`, answers refusals itself, and calls
 *  `forward` for everything Vite should see. Authentication errors refuse; they never fall open. */
export function createDevProxyGuard(options: DevProxyGuardOptions): (req: IncomingMessage, res: ServerResponse, forward: () => void) => void {
  const { scope, authenticate, onRefuse, resolve } = options
  return (req, res, forward) => {
    const verdict = classifyDevProxyRequest(req.url ?? '/', scope, resolve)
    if (verdict === 'forward') { forward(); return }
    if (verdict === 'refuse') { onRefuse?.(req, verdict); refuse(res); return }
    authenticate(req).then((ok) => {
      if (ok) forward()
      else { onRefuse?.(req, verdict); refuse(res) }
    }, () => { onRefuse?.(req, verdict); refuse(res) })
  }
}
