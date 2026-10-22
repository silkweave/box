import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, expect, test } from 'vitest'
import { fetchRecipe, RegistryError, registryCatalog, safeEntryPath, unpackRecipeArchive } from './recipe-registry.js'

const dirs: string[] = []
const temp = (): string => { const dir = mkdtempSync('/tmp/box-registry-'); dirs.push(dir); return dir }
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

const VERSION = 'a'.repeat(40)

/** A minimal ustar archive: [path, body, type] entries. */
function tar(entries: Array<[string, string, string?]>): Buffer {
  const blocks: Buffer[] = []
  for (const [path, body, type = '0'] of entries) {
    const header = Buffer.alloc(512)
    header.write(path, 0, 100, 'utf8')
    header.write('0000644\0', 100)
    header.write('0000000\0', 108)
    header.write('0000000\0', 116)
    const data = Buffer.from(body)
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124)
    header.write('00000000000\0', 136)
    header.write('        ', 148)
    header.write(type, 156)
    header.write('ustar\0', 257)
    header.write('00', 263)
    let sum = 0
    for (const byte of header) sum += byte
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

const manifest = (id = 'crm', version = VERSION): [string, string] => ['./registry.json', JSON.stringify({ id, version, core: version, powerups: [] })]

test('entry paths stay inside the recipe and its source', () => {
  expect(safeEntryPath('./recipes/crm/RECIPE.md', 'crm')).toBe('recipes/crm/RECIPE.md')
  expect(safeEntryPath('./features/crm/core/index.ts', 'crm')).toBe('features/crm/core/index.ts')
  expect(safeEntryPath('./', 'crm')).toBe('')
  for (const bad of ['/etc/passwd', 'recipes/../../x', 'recipes/crm/../../x', 'features/other/x', 'apps/server/x', 'recipes\\crm\\x', 'box.local.json']) {
    expect(() => safeEntryPath(bad, 'crm')).toThrow(RegistryError)
  }
})

test('unpacks regular files and refuses links and escaping paths', () => {
  const dest = join(temp(), 'out')
  unpackRecipeArchive(tar([manifest(), ['./recipes/crm/RECIPE.md', '# CRM\n'], ['./features/crm/core/index.ts', 'export {}\n']]), dest, 'crm')
  expect(readFileSync(join(dest, 'recipes/crm/RECIPE.md'), 'utf8')).toBe('# CRM\n')
  expect(() => unpackRecipeArchive(tar([manifest(), ['./features/crm/link', '', '2']]), join(temp(), 'a'), 'crm')).toThrow(/not a regular file/)
  expect(() => unpackRecipeArchive(tar([manifest(), ['../escape', 'x']]), join(temp(), 'b'), 'crm')).toThrow(RegistryError)
  expect(() => unpackRecipeArchive(tar([['./recipes/crm/RECIPE.md', '# CRM\n']]), join(temp(), 'c'), 'crm')).toThrow(/no registry.json/)
})

function fakeRegistry(archive: Buffer, options: { sha?: string; status?: number } = {}) {
  const sha = options.sha ?? createHash('sha256').update(archive).digest('hex')
  const seen: Array<{ url: string; auth: string | null; redirect: unknown }> = []
  const fetchImpl = async (url: string, init: RequestInit): Promise<Response> => {
    const headers = init.headers as Record<string, string>
    seen.push({ url, auth: headers.authorization ?? null, redirect: init.redirect })
    if (options.status) return new Response(null, { status: options.status, headers: { location: 'https://elsewhere.example' } })
    if (url.endsWith('/v1/catalog')) {
      return Response.json({ recipes: [{ id: 'crm', title: 'CRM', latest: VERSION, versions: [{ version: VERSION, sha256: sha, size: archive.length, core: VERSION, powerups: ['stripe'], publishedAt: '2026-10-22T00:00:00Z' }] }] })
    }
    return new Response(new Uint8Array(archive), { headers: { 'content-length': String(archive.length) } })
  }
  return { fetchImpl, seen }
}

const registry = { url: 'https://registry.example', token: 'tok_abcdefghijklmnop' }

test('fetches into a verified versioned cache and reuses it', async () => {
  const root = temp()
  const archive = tar([manifest(), ['./recipes/crm/RECIPE.md', '# CRM\n']])
  const { fetchImpl, seen } = fakeRegistry(archive)
  const first = await fetchRecipe(root, registry, 'crm', undefined, fetchImpl)
  expect(first).toMatchObject({ id: 'crm', version: VERSION, downloaded: true, powerups: ['stripe'] })
  expect(first.path).toBe(join(root, '.recipes', 'crm', VERSION))
  expect(existsSync(join(first.path, 'recipes/crm/RECIPE.md'))).toBe(true)
  expect(seen.every(call => call.auth === `Bearer ${registry.token}` && call.redirect === 'manual')).toBe(true)
  const again = await fetchRecipe(root, registry, 'crm', undefined, fetchImpl)
  expect(again.downloaded).toBe(false)
})

test('a digest mismatch unpacks nothing', async () => {
  const root = temp()
  const { fetchImpl } = fakeRegistry(tar([manifest()]), { sha: 'b'.repeat(64) })
  await expect(fetchRecipe(root, registry, 'crm', undefined, fetchImpl)).rejects.toMatchObject({ code: 'digest-mismatch' })
  expect(existsSync(join(root, '.recipes', 'crm', VERSION))).toBe(false)
})

test('a manifest naming another recipe is refused', async () => {
  const root = temp()
  const { fetchImpl } = fakeRegistry(tar([manifest('other')]))
  await expect(fetchRecipe(root, registry, 'crm', undefined, fetchImpl)).rejects.toMatchObject({ code: 'unsafe-archive' })
  expect(existsSync(join(root, '.recipes', 'crm', VERSION))).toBe(false)
})

test('redirects are refused and a rejected key is named', async () => {
  await expect(registryCatalog(registry, fakeRegistry(tar([]), { status: 302 }).fetchImpl)).rejects.toMatchObject({ code: 'bad-response' })
  await expect(registryCatalog(registry, fakeRegistry(tar([]), { status: 401 }).fetchImpl)).rejects.toMatchObject({ code: 'key-rejected' })
  const anonymous = fakeRegistry(tar([]))
  await registryCatalog({ url: registry.url, token: null }, anonymous.fetchImpl)
  expect(anonymous.seen[0]!.auth).toBeNull()
})
