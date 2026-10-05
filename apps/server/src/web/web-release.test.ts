import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { acceptedEncodings, currentWebRelease, listWebReleases, prepareWebRelease, serveWebApp, serveWebAsset } from './web-release.js'

const directories: string[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve))
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true })
})
const fixture = (): string => { const path = mkdtempSync('/tmp/web-release-'); directories.push(path); return path }

/** A fake `vite build` writing an index and one hashed chunk named after `tag`. */
const build = (tag: string, calls: string[][] = []) => async (_cwd: string, args: string[]): Promise<void> => {
  calls.push(args)
  const target = args.find(arg => arg.startsWith('--outDir='))!.slice('--outDir='.length)
  mkdirSync(join(target, 'assets'), { recursive: true })
  writeFileSync(join(target, 'index.html'), `<html><head><title>${tag}</title></head><body><script src="/assets/app-${tag}.js"></script></body></html>`)
  writeFileSync(join(target, 'assets', `app-${tag}.js`), `console.log(${JSON.stringify(tag)});\n`.repeat(200))
  writeFileSync(join(target, 'app-icon-512.png'), 'png')
}

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`
}

describe('web releases', () => {
  it('publishes a release-mode build with metadata, a version meta tag and precompressed files', async () => {
    const instance = fixture()
    const calls: string[][] = []
    const release = await prepareWebRelease('/repo', instance, { build: build('one', calls), source: { sha: 'abc123', dirty: false } })
    expect(calls[0]).toEqual(expect.arrayContaining(['run', 'build', '--mode=release', '--base=/']))
    expect(currentWebRelease(instance)).toMatchObject({ version: release.version, sourceSha: 'abc123', dirty: false })
    expect(readFileSync(join(release.dir, 'index.html'), 'utf8')).toContain(`<meta name="box-web-release" content="${release.version}">`)
    const chunk = join(release.dir, 'assets', 'app-one.js')
    expect(brotliDecompressSync(readFileSync(`${chunk}.br`)).toString()).toBe(readFileSync(chunk, 'utf8'))
    expect(gunzipSync(readFileSync(`${chunk}.gz`)).toString()).toBe(readFileSync(chunk, 'utf8'))
    expect(existsSync(join(release.dir, 'app-icon-512.png.br'))).toBe(false)
  })

  it('leaves the current release untouched when a build fails', async () => {
    const instance = fixture()
    const first = await prepareWebRelease('/repo', instance, { build: build('one') })
    await expect(prepareWebRelease('/repo', instance, { build: async () => { throw new Error('vite failed') } })).rejects.toThrow('vite failed')
    expect(currentWebRelease(instance)?.version).toBe(first.version)
    expect(listWebReleases(instance)).toHaveLength(1)
  })

  it('keeps the newest releases and serves stale chunks from them', async () => {
    const instance = fixture()
    for (const tag of ['a', 'b', 'c']) await prepareWebRelease('/repo', instance, { build: build(tag), keep: 2 })
    expect(listWebReleases(instance)).toHaveLength(2)
    const origin = await serve((req, res) => {
      const path = new URL(req.url!, 'http://local').pathname
      if (!serveWebApp(instance, join(instance, 'missing-dist'), req, res, path)) { res.statusCode = 405; res.end() }
    })
    const stale = await fetch(`${origin}/assets/app-b.js`, { headers: { 'accept-encoding': 'br' } })
    expect(stale.status).toBe(200)
    expect(stale.headers.get('cache-control')).toContain('immutable')
    expect(stale.headers.get('content-encoding')).toBe('br')
    expect(await stale.text()).toContain('"b"')
    expect((await fetch(`${origin}/assets/app-a.js`)).status).toBe(404)
    const route = await fetch(`${origin}/crm/acme`)
    expect(route.headers.get('cache-control')).toBe('no-cache')
    expect(await route.text()).toContain('<title>c</title>')
    expect(await (await fetch(`${origin}/app-icon-512.png`)).text()).toBe('png')
    expect((await fetch(`${origin}/release.json`)).headers.get('content-type')).toContain('text/html')
    expect((await fetch(`${origin}/assets/..%2f..%2fcurrent`)).status).toBe(404)
  })

  it('falls back to apps/web/dist before the first release', async () => {
    const instance = fixture()
    const dist = join(instance, 'dist')
    mkdirSync(join(dist, 'assets'), { recursive: true })
    writeFileSync(join(dist, 'index.html'), '<html><head></head><body>legacy</body></html>')
    writeFileSync(join(dist, 'assets', 'old.js'), 'old')
    const origin = await serve((req, res) => { serveWebApp(instance, dist, req, res, new URL(req.url!, 'http://local').pathname) })
    expect(await (await fetch(`${origin}/signals`)).text()).toContain('legacy')
    expect(await (await fetch(`${origin}/assets/old.js`)).text()).toBe('old')
    const empty = fixture()
    const missing = await serve((req, res) => { serveWebApp(empty, join(empty, 'none'), req, res, '/') })
    expect(missing.length).toBeGreaterThan(0)
    expect((await fetch(missing)).status).toBe(503)
  })

  it('serves an asset only when a release has it', async () => {
    const instance = fixture()
    await prepareWebRelease('/repo', instance, { build: build('one') })
    const origin = await serve((req, res) => {
      if (!serveWebAsset(instance, req, res, new URL(req.url!, 'http://local').pathname)) { res.statusCode = 418; res.end() }
    })
    const gzip = await fetch(`${origin}/assets/app-one.js`, { headers: { 'accept-encoding': 'gzip' } })
    expect(gzip.headers.get('content-encoding')).toBe('gzip')
    expect(gzip.headers.get('vary')).toBe('Accept-Encoding')
    expect((await fetch(`${origin}/assets/app-one.js.br`)).status).toBe(418)
    expect((await fetch(`${origin}/assets/nope.js`)).status).toBe(418)
  })

  it('negotiates encodings and honours q=0', () => {
    expect([...acceptedEncodings('gzip, deflate, br')]).toEqual(['gzip', 'br'])
    expect([...acceptedEncodings('br;q=0, gzip')]).toEqual(['gzip'])
    expect([...acceptedEncodings(undefined)]).toEqual([])
  })
})
