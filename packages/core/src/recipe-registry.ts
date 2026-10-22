// The recipe registry client: list the recipes this Box may fetch, download one version, check it
// against the catalog digest and unpack it into an immutable, versioned cache. Used by the `box`
// CLI (`box recipe`, `box registry`) and the server (the Recipe Gallery's catalog). Node built-ins
// only, so the CLI can load it before anything is built.
//
// Security contract:
// - the access key is sent only to the configured registry origin, never on a redirect (redirects
//   are refused), and never logged or returned;
// - an archive is accepted only when its sha256 matches the catalog entry, then unpacked by a
//   bounded tar reader that accepts regular files and directories under `registry.json`,
//   `recipes/<id>/` and `features/<id>/` only: no links, devices, absolute paths or `..`;
// - a cached version is written once (temp directory + rename) and never modified afterwards, so an
//   adapted Box keeps the exact source it adapted from for later three-way merges.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { BoxRegistry } from './box-json.js'

/** The gitignored cache, relative to the Box root: `.recipes/<id>/<version>/`. */
export const RECIPE_CACHE_DIR = '.recipes'

const ID = /^[a-z][a-z0-9-]*$/
const VERSION = /^[0-9a-f]{40}$/
const MAX_ARCHIVE = 64 * 1024 * 1024
const MAX_UNPACKED = 256 * 1024 * 1024
const MAX_ENTRIES = 20_000
const TIMEOUT_MS = 30_000
/** Marker written last into a finished cache directory: the verified digest. */
const VERIFIED = '.verified'

export interface RegistryVersion {
  version: string
  sha256: string
  size: number
  core: string
  powerups: string[]
  publishedAt: string
  yanked?: boolean
  yankedReason?: string
}

export interface RegistryRecipe {
  id: string
  title: string
  latest: string
  versions: RegistryVersion[]
}

export type RegistryErrorCode = 'key-rejected' | 'not-found' | 'unreachable' | 'bad-response' | 'digest-mismatch' | 'unsafe-archive'

export class RegistryError extends Error {
  readonly code: RegistryErrorCode
  constructor(code: RegistryErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'RegistryError'
  }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>

async function request(registry: BoxRegistry, path: string, fetchImpl: Fetch, useToken = true): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json, application/gzip' }
  if (useToken && registry.token) headers.authorization = `Bearer ${registry.token}`
  let response: Response
  try {
    // `manual`: a redirect is never followed, so the key cannot travel to another origin.
    response = await fetchImpl(`${registry.url}${path}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (error) {
    throw new RegistryError('unreachable', `The recipe registry at ${registry.url} could not be reached (${error instanceof Error ? error.message : String(error)})`)
  }
  if (response.status === 401) throw new RegistryError('key-rejected', 'The registry did not accept this access key (it may be mistyped, expired or revoked). Set a new one with: box registry key')
  if (response.status === 404) throw new RegistryError('not-found', 'not found')
  if (response.status >= 300 && response.status < 400) throw new RegistryError('bad-response', `The registry answered with a redirect (${response.status}); refusing to follow it`)
  if (!response.ok) throw new RegistryError('bad-response', `The registry answered ${response.status}`)
  return response
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function parseCatalog(raw: unknown): RegistryRecipe[] {
  if (!isRecord(raw) || !Array.isArray(raw.recipes)) throw new RegistryError('bad-response', 'The registry catalog is not in the expected shape')
  const recipes: RegistryRecipe[] = []
  for (const item of raw.recipes as unknown[]) {
    if (!isRecord(item) || typeof item.id !== 'string' || !ID.test(item.id) || typeof item.latest !== 'string' || !Array.isArray(item.versions)) continue
    const versions: RegistryVersion[] = []
    for (const v of item.versions as unknown[]) {
      if (!isRecord(v) || typeof v.version !== 'string' || !VERSION.test(v.version) || typeof v.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(v.sha256)) continue
      versions.push({
        version: v.version, sha256: v.sha256, size: Number(v.size) || 0, core: String(v.core ?? ''),
        powerups: Array.isArray(v.powerups) ? (v.powerups as unknown[]).filter((p): p is string => typeof p === 'string' && ID.test(p)) : [],
        publishedAt: String(v.publishedAt ?? ''),
        ...(v.yanked ? { yanked: true, yankedReason: String(v.yankedReason ?? '') } : {}),
      })
    }
    recipes.push({ id: item.id, title: typeof item.title === 'string' ? item.title : item.id, latest: item.latest, versions })
  }
  return recipes
}

/** The recipes this Box may fetch: the open ones plus those its access key grants. */
export async function registryCatalog(registry: BoxRegistry, fetchImpl: Fetch = fetch): Promise<RegistryRecipe[]> {
  const response = await request(registry, '/v1/catalog', fetchImpl)
  let body: unknown
  try { body = await response.json() } catch { throw new RegistryError('bad-response', 'The registry catalog is not JSON') }
  return parseCatalog(body)
}

/** Whether the registry accepts `token`, and how many recipes it lists with and without it. */
export async function checkRegistryKey(registry: BoxRegistry, fetchImpl: Fetch = fetch): Promise<{ withKey: number; open: number }> {
  const withKey = (await registryCatalog(registry, fetchImpl)).length
  const open = (await registryCatalog({ url: registry.url, token: null }, fetchImpl)).length
  return { withKey, open }
}

export function pickVersion(recipe: RegistryRecipe, version?: string): RegistryVersion {
  const wanted = version ?? recipe.latest
  const found = recipe.versions.find(v => v.version === wanted)
  if (!found) throw new RegistryError('not-found', `The registry has no version ${wanted} of ${recipe.id}`)
  return found
}

export const recipeCachePath = (root: string, id: string, version: string): string => join(root, RECIPE_CACHE_DIR, id, version)

export interface FetchedRecipe {
  id: string
  version: string
  sha256: string
  core: string
  powerups: string[]
  /** The cache directory: `<path>/recipes/<id>/` (docs) and `<path>/features/<id>/` (source). */
  path: string
  /** True when this call downloaded it; false when the verified cache already held it. */
  downloaded: boolean
}

/** A cache directory that finished unpacking with digest `sha256`, or null. */
export function cachedRecipe(root: string, id: string, version: string, sha256?: string): string | null {
  const dir = recipeCachePath(root, id, version)
  const marker = join(dir, VERIFIED)
  if (!existsSync(marker)) return null
  const recorded = readFileSync(marker, 'utf8').trim()
  return sha256 && recorded !== sha256 ? null : dir
}

/**
 * Fetch `id` at `version` (default: the catalog's latest) into `.recipes/<id>/<version>/`, verified.
 * An already verified cache is reused without a download.
 */
export async function fetchRecipe(root: string, registry: BoxRegistry, id: string, version?: string, fetchImpl: Fetch = fetch): Promise<FetchedRecipe> {
  if (!ID.test(id)) throw new RegistryError('not-found', `${JSON.stringify(id)} is not a recipe id`)
  if (version !== undefined && !VERSION.test(version)) throw new RegistryError('not-found', `${JSON.stringify(version)} is not a registry version (a 40-character SHA)`)
  const recipe = (await registryCatalog(registry, fetchImpl)).find(r => r.id === id)
  if (!recipe) throw new RegistryError('not-found', `The registry has no recipe ${id} that this Box may fetch`)
  const entry = pickVersion(recipe, version)
  const result = { id, version: entry.version, sha256: entry.sha256, core: entry.core, powerups: entry.powerups }
  const cached = cachedRecipe(root, id, entry.version, entry.sha256)
  if (cached) return { ...result, path: cached, downloaded: false }

  const response = await request(registry, `/v1/recipes/${id}/${entry.version}.tgz`, fetchImpl)
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_ARCHIVE) throw new RegistryError('unsafe-archive', `${id} is larger than ${MAX_ARCHIVE} bytes`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > MAX_ARCHIVE) throw new RegistryError('unsafe-archive', `${id} is larger than ${MAX_ARCHIVE} bytes`)
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== entry.sha256) throw new RegistryError('digest-mismatch', `${id}@${entry.version} does not match the catalog digest (got ${digest}, expected ${entry.sha256}); nothing was unpacked`)

  const dir = recipeCachePath(root, id, entry.version)
  const temp = `${dir}.tmp-${process.pid}-${Date.now()}`
  try {
    unpackRecipeArchive(bytes, temp, id)
    const manifest = JSON.parse(readFileSync(join(temp, 'registry.json'), 'utf8')) as Record<string, unknown>
    if (manifest.id !== id || manifest.version !== entry.version) throw new RegistryError('unsafe-archive', `${id}@${entry.version}: registry.json names ${String(manifest.id)}@${String(manifest.version)}`)
    writeFileSync(join(temp, VERIFIED), `${digest}\n`)
    // Another fetch may have finished first; its verified copy is the same bytes.
    if (cachedRecipe(root, id, entry.version, digest)) rmSync(temp, { recursive: true, force: true })
    else {
      rmSync(dir, { recursive: true, force: true })
      renameSync(temp, dir)
    }
  } catch (error) {
    rmSync(temp, { recursive: true, force: true })
    if (error instanceof RegistryError) throw error
    throw new RegistryError('unsafe-archive', `${id}@${entry.version} could not be unpacked: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { ...result, path: dir, downloaded: true }
}

/** The archive-relative path an entry may have, or an error. Only the recipe's own folders. */
export function safeEntryPath(raw: string, id: string): string {
  if (raw.includes('\0') || raw.includes('\\')) throw new RegistryError('unsafe-archive', `unsafe path ${JSON.stringify(raw)}`)
  const path = raw.replace(/^(\.\/)+/, '').replace(/\/+$/, '')
  if (path === '' || path === '.') return ''
  if (path.startsWith('/')) throw new RegistryError('unsafe-archive', `absolute path ${JSON.stringify(raw)}`)
  const parts = path.split('/')
  if (parts.some(part => part === '' || part === '.' || part === '..')) throw new RegistryError('unsafe-archive', `unsafe path ${JSON.stringify(raw)}`)
  const allowed = path === 'registry.json' || ((parts[0] === 'recipes' || parts[0] === 'features') && (parts.length === 1 || parts[1] === id))
  if (!allowed) throw new RegistryError('unsafe-archive', `${JSON.stringify(raw)} is outside recipes/${id} and features/${id}`)
  return path
}

const field = (block: Buffer, start: number, length: number): string => {
  const raw = block.subarray(start, start + length)
  const end = raw.indexOf(0)
  return raw.subarray(0, end === -1 ? raw.length : end).toString('utf8')
}
const octal = (block: Buffer, start: number, length: number): number => {
  const text = field(block, start, length).trim()
  if (!/^[0-7]*$/.test(text)) throw new RegistryError('unsafe-archive', 'malformed tar header')
  return text ? parseInt(text, 8) : 0
}

/** Pax extended header records: `<len> key=value\n`. Only `path` matters here. */
function paxPath(data: Buffer): string | undefined {
  let offset = 0
  let path: string | undefined
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset)
    if (space === -1) break
    const length = parseInt(data.subarray(offset, space).toString('utf8'), 10)
    if (!length || length < 0) break
    const record = data.subarray(space + 1, offset + length - 1).toString('utf8')
    const eq = record.indexOf('=')
    if (eq > 0 && record.slice(0, eq) === 'path') path = record.slice(eq + 1)
    offset += length
  }
  return path
}

/**
 * Unpack a gzipped ustar/pax archive into `dest` (created). Regular files and directories only;
 * every path passes `safeEntryPath`. Sizes and entry counts are bounded.
 */
export function unpackRecipeArchive(gz: Buffer, dest: string, id: string): void {
  let tar: Buffer
  try {
    tar = gunzipSync(gz, { maxOutputLength: MAX_UNPACKED })
  } catch (error) {
    throw new RegistryError('unsafe-archive', `not a readable gzip archive within ${MAX_UNPACKED} bytes (${error instanceof Error ? error.message : String(error)})`)
  }
  mkdirSync(dest, { recursive: true })
  let offset = 0
  let entries = 0
  let nextPath: string | undefined
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    if (++entries > MAX_ENTRIES) throw new RegistryError('unsafe-archive', `more than ${MAX_ENTRIES} entries`)
    const size = octal(header, 124, 12)
    const type = String.fromCharCode(header[156] ?? 0)
    const prefix = field(header, 345, 155)
    const name = field(header, 0, 100)
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > tar.length) throw new RegistryError('unsafe-archive', 'truncated tar entry')
    const data = tar.subarray(dataStart, dataEnd)
    offset = dataStart + Math.ceil(size / 512) * 512

    if (type === 'x') { nextPath = paxPath(data); continue }
    if (type === 'g') continue
    if (type === 'L') { nextPath = data.toString('utf8').replace(/\0+$/, ''); continue }
    const rawPath = nextPath ?? (prefix ? `${prefix}/${name}` : name)
    nextPath = undefined
    const path = safeEntryPath(rawPath, id)
    if (type === '5') { if (path) mkdirSync(join(dest, path), { recursive: true }); continue }
    if (type !== '0' && type !== '\0' && type !== '7') throw new RegistryError('unsafe-archive', `${JSON.stringify(rawPath)} is not a regular file or directory (type ${JSON.stringify(type)})`)
    if (!path) throw new RegistryError('unsafe-archive', 'a file entry without a name')
    const target = join(dest, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, data, { flag: 'wx', mode: (octal(header, 100, 8) & 0o111) ? 0o755 : 0o644 })
  }
  if (!existsSync(join(dest, 'registry.json'))) throw new RegistryError('unsafe-archive', 'the archive has no registry.json')
}
