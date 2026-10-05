import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, constants as zlib, gzip } from 'node:zlib'

/**
 * Frozen web releases for built (non-dev) mode. The Builder edits the live checkout in place, so the
 * bundle everyone else loads cannot be apps/web/dist: a checked Builder restart rebuilds that folder.
 * A release is only replaced by an explicit promote (or a boot outside a Builder session), and
 * older releases stay on disk so tabs opened before a promote can still load their lazy chunks.
 */

export type WebReleaseMeta = { version: string; createdAt: string; sourceSha: string | null; dirty: boolean }
export type WebRelease = WebReleaseMeta & { dir: string }

const VERSION = /^[a-f0-9-]{36}$/
const KEEP = 5
const COMPRESSIBLE = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt', '.map', '.wasm'])
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.map': 'application/json', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
}
const brotli = promisify(brotliCompress)
const gz = promisify(gzip)

export const webReleaseRoot = (instance: string): string => join(instance, 'web')

function readMeta(dir: string): WebReleaseMeta | undefined {
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8')) as WebReleaseMeta
    return VERSION.test(meta.version) && existsSync(join(dir, 'index.html')) ? meta : undefined
  } catch { return undefined }
}

/** The promoted release, or undefined on a first boot before any release was built. */
export function currentWebRelease(instance: string): WebRelease | undefined {
  const root = webReleaseRoot(instance)
  try {
    const version = readFileSync(join(root, 'current'), 'utf8').trim()
    if (!VERSION.test(version)) return undefined
    const dir = join(root, 'releases', version)
    const meta = readMeta(dir)
    return meta ? { ...meta, dir } : undefined
  } catch { return undefined }
}

/** Every complete release, newest first. */
export function listWebReleases(instance: string): WebRelease[] {
  const parent = join(webReleaseRoot(instance), 'releases')
  let names: string[]
  try { names = readdirSync(parent) } catch { return [] }
  return names.filter(name => VERSION.test(name))
    .map(name => { const dir = join(parent, name); const meta = readMeta(dir); return meta && { ...meta, dir } })
    .filter((release): release is WebRelease => Boolean(release))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

async function precompress(dir: string): Promise<void> {
  const files: string[] = []
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const next = join(path, entry.name)
      if (entry.isDirectory()) walk(next)
      else if (COMPRESSIBLE.has(extname(entry.name)) && statSync(next).size >= 1024) files.push(next)
    }
  }
  walk(dir)
  // Compressed once per release, so request time costs no CPU. Brotli quality 9 is within a few
  // percent of 11 at a fraction of the time on multi-megabyte workers. Two files at a time: this
  // runs inside the long-lived supervisor, and compressing every file at once pushed its resident
  // memory from under 150 MB to almost 1 GB, which the allocator does not hand back promptly.
  const queue = [...files]
  const worker = async (): Promise<void> => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const body = readFileSync(file)
      const br = await brotli(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 9, [zlib.BROTLI_PARAM_SIZE_HINT]: body.length } })
      if (br.length < body.length) writeFileSync(`${file}.br`, br)
      const gzipped = await gz(body, { level: 9 })
      if (gzipped.length < body.length) writeFileSync(`${file}.gz`, gzipped)
    }
  }
  await Promise.all([worker(), worker()])
}

export type WebReleaseBuild = (cwd: string, args: string[]) => Promise<void>

/** Build, compress and publish a release, then move the pointer. A failed build changes nothing. */
export async function prepareWebRelease(root: string, instance: string, options: {
  build: WebReleaseBuild
  source?: { sha: string | null; dirty: boolean }
  keep?: number
}): Promise<WebRelease> {
  const parent = webReleaseRoot(instance)
  const releases = join(parent, 'releases')
  const version = randomUUID()
  const staging = join(parent, `next-${version}`)
  const target = join(releases, version)
  const pointer = join(parent, `current-${version}`)
  mkdirSync(releases, { recursive: true })
  try {
    await options.build(join(root, 'apps/web'), ['run', 'build', '--mode=release', '--base=/', `--outDir=${staging}`, '--emptyOutDir'])
    const index = join(staging, 'index.html')
    if (!existsSync(index)) throw new Error('Web release build produced no index')
    const html = readFileSync(index, 'utf8')
    if (!html.includes('</head>')) throw new Error('Web release build produced invalid HTML')
    writeFileSync(index, html.replace('</head>', `<meta name="box-web-release" content="${version}"></head>`))
    const meta: WebReleaseMeta = { version, createdAt: new Date().toISOString(), sourceSha: options.source?.sha ?? null, dirty: options.source?.dirty ?? false }
    writeFileSync(join(staging, 'release.json'), `${JSON.stringify(meta, null, 2)}\n`)
    await precompress(staging)
    renameSync(staging, target)
    writeFileSync(pointer, version)
    renameSync(pointer, join(parent, 'current'))
    pruneWebReleases(instance, options.keep ?? KEEP)
    return { ...meta, dir: target }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    rmSync(pointer, { force: true })
    throw error
  }
}

/** Keep the current release plus the newest others, so recent tabs still load their chunks. */
export function pruneWebReleases(instance: string, keep = KEEP): void {
  const current = currentWebRelease(instance)?.version
  const others = listWebReleases(instance).filter(release => release.version !== current)
  for (const release of others.slice(Math.max(0, keep - 1))) rmSync(release.dir, { recursive: true, force: true })
}

/** br, then gzip, then identity; an explicit q=0 refuses that coding. */
export function acceptedEncodings(header: string | string[] | undefined): Set<'br' | 'gzip'> {
  const accepted = new Set<'br' | 'gzip'>()
  for (const part of String(header ?? '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';')
    if (params.some(param => /^\s*q=0(\.0*)?\s*$/.test(param))) continue
    if (name === 'br' || name === 'gzip') accepted.add(name)
    if (name === '*') { accepted.add('br'); accepted.add('gzip') }
  }
  return accepted
}

/** Resolve a URL path inside a directory, refusing traversal and symlinks out of it. */
function fileIn(dir: string, pathname: string): string | undefined {
  let decoded: string
  try { decoded = decodeURIComponent(pathname) } catch { return undefined }
  if (decoded.includes('\0')) return undefined
  const path = resolve(dir, `.${decoded}`)
  if (!path.startsWith(`${dir}${sep}`) || relative(dir, path).split(sep).some(part => part.startsWith('.'))) return undefined
  try {
    if (!statSync(path).isFile()) return undefined
    if (!realpathSync(path).startsWith(`${realpathSync(dir)}${sep}`)) return undefined
  } catch { return undefined }
  return path
}

/** Send one file with negotiated precompressed encoding. */
export function sendReleaseFile(req: Pick<IncomingMessage, 'headers' | 'method'>, res: ServerResponse, path: string, cacheControl: string): void {
  const ext = extname(path)
  const accepted = acceptedEncodings(req.headers['accept-encoding'])
  let body = path
  let encoding: 'br' | 'gzip' | undefined
  if (accepted.has('br') && existsSync(`${path}.br`)) { body = `${path}.br`; encoding = 'br' }
  else if (accepted.has('gzip') && existsSync(`${path}.gz`)) { body = `${path}.gz`; encoding = 'gzip' }
  res.statusCode = 200
  res.setHeader('content-type', TYPES[ext] ?? 'application/octet-stream')
  res.setHeader('content-length', statSync(body).size)
  res.setHeader('cache-control', cacheControl)
  if (COMPRESSIBLE.has(ext)) res.setHeader('vary', 'Accept-Encoding')
  if (encoding) res.setHeader('content-encoding', encoding)
  if (req.method === 'HEAD') { res.end(); return }
  createReadStream(body).on('error', () => res.destroy()).pipe(res)
}

const IMMUTABLE = 'public, max-age=31536000, immutable'

/**
 * Serve a hashed `/assets/*` file from the current release, falling back through retained releases
 * so a tab opened before a promote keeps working. Returns false when no release has the file.
 */
export function serveWebAsset(instance: string, req: Pick<IncomingMessage, 'headers' | 'method'>, res: ServerResponse, pathname: string): boolean {
  if (!pathname.startsWith('/assets/') || /\.(br|gz)$/.test(pathname)) return false
  const current = currentWebRelease(instance)
  const candidates = current ? [current.dir] : []
  let path = current && fileIn(current.dir, pathname)
  if (!path) {
    for (const release of listWebReleases(instance)) {
      if (candidates.includes(release.dir)) continue
      path = fileIn(release.dir, pathname)
      if (path) break
    }
  }
  if (!path) return false
  sendReleaseFile(req, res, path, IMMUTABLE)
  return true
}

/**
 * The SPA half of a built Box: a file from the release (or `fallbackDir` when no release exists
 * yet), a 404 for a missing hashed asset, and index.html for every other path so client routes
 * survive a reload. Returns false for methods it does not serve.
 */
export function serveWebApp(instance: string, fallbackDir: string, req: Pick<IncomingMessage, 'headers' | 'method'>, res: ServerResponse, pathname: string): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  if (pathname.startsWith('/assets/')) {
    if (serveWebAsset(instance, req, res, pathname)) return true
    const legacy = !currentWebRelease(instance) && fileIn(fallbackDir, pathname)
    if (legacy) { sendReleaseFile(req, res, legacy, IMMUTABLE); return true }
    // A stale hashed chunk must 404, not come back as index.html that the browser reports as an
    // inscrutable module parse error.
    res.statusCode = 404
    res.setHeader('cache-control', 'no-store')
    res.end()
    return true
  }
  const dir = currentWebRelease(instance)?.dir ?? fallbackDir
  if (pathname !== '/' && pathname !== '/index.html' && !/\.(br|gz)$/.test(pathname)) {
    const file = fileIn(dir, pathname)
    if (file && !file.endsWith(`${sep}release.json`)) { sendReleaseFile(req, res, file, 'no-cache'); return true }
  }
  const index = join(dir, 'index.html')
  if (!existsSync(index)) {
    res.statusCode = 503
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end('The Box web bundle is not built yet. Run box build, or wait for the first release to finish.')
    return true
  }
  sendReleaseFile(req, res, index, 'no-cache')
  return true
}
