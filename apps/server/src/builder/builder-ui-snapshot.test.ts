import { createServer, request } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { builderUiVersion, currentBuilderUi, prepareBuilderUi, serveBuilderUi } from './builder-ui-snapshot.js'
import { startBuilderLocalControl } from './builder-local-control.js'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
const fixture = (): string => { const path = mkdtempSync('/tmp/builder-ui-'); directories.push(path); return path }
const build = (brand: string) => async (_root: string, args: string[]): Promise<void> => {
  const target = args.find(arg => arg.startsWith('--outDir='))?.slice('--outDir='.length)
  if (!target) return
  mkdirSync(target, { recursive: true })
  const base = args.find(arg => arg.startsWith('--base='))?.slice('--base='.length)
  writeFileSync(join(target, 'index.html'), `<html><head><title>${brand}</title></head><body><img src="${base}brand.svg"></body></html>`)
  writeFileSync(join(target, 'brand.svg'), brand)
}

describe('Builder UI releases', () => {
  it('publishes versioned HTML and retains old artwork across refresh, including failed builds', async () => {
    const instance = fixture()
    let current = await prepareBuilderUi('/repo', instance, { build: build('before') })
    const before = current
    const server = createServer((req, res) => serveBuilderUi(current, new URL(req.url!, 'http://local').pathname, res))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    try {
      const oldPath = `/builder-assets/${builderUiVersion(before)}/brand.svg`
      const first = await fetch(origin + '/builder')
      expect(first.headers.get('cache-control')).toBe('no-store')
      expect(await first.text()).toContain(oldPath)
      current = await prepareBuilderUi('/repo', instance, { build: build('after'), fallback: false })
      expect(currentBuilderUi(instance)).toBe(current)
      expect(current).not.toBe(before)
      const oldAsset = await fetch(origin + oldPath)
      expect(oldAsset.headers.get('cache-control')).toContain('immutable')
      expect(await oldAsset.text()).toBe('before')
      expect(await (await fetch(origin + `/builder-assets/${builderUiVersion(current)}/brand.svg`)).text()).toBe('after')
      expect(await (await fetch(origin + '/builder')).text()).toContain('box-builder-ui')
      await expect(prepareBuilderUi('/repo', instance, { fallback: false, build: async () => { throw new Error('broken source') } })).rejects.toThrow('broken source')
      expect(currentBuilderUi(instance)).toBe(current)
      expect(readFileSync(join(current, 'index.html'), 'utf8')).toContain('after')
      expect((await fetch(origin + `/builder-assets/${builderUiVersion(current)}/%2e%2e%2f%2e%2e%2fui-current`)).status).toBe(404)
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })

  it('retains the legacy snapshot when startup cannot build', async () => {
    const instance = fixture()
    const legacy = join(instance, 'builder', 'ui')
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'index.html'), 'legacy')
    expect(await prepareBuilderUi('/repo', instance, { build: async () => { throw new Error('bad build') } })).toBe(legacy)
  })

  it('offers only refresh on the private local control socket and reports failures', async () => {
    const instance = fixture()
    mkdirSync(join(instance, 'builder'))
    let calls = 0
    const close = await startBuilderLocalControl(instance, async () => { if (++calls === 2) throw new Error('build failed') })
    const socketPath = join(instance, 'builder', 'ui-refresh.sock')
    const call = (path: string) => new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const req = request({ socketPath, method: 'POST', path }, res => {
        let body = ''
        res.on('data', data => { body += data })
        res.on('end', () => resolve({ status: res.statusCode, body }))
      }); req.on('error', reject); req.end()
    })
    try {
      expect(statSync(socketPath).mode & 0o777).toBe(0o600)
      expect((await call('/stop')).status).toBe(404)
      expect(calls).toBe(0)
      expect((await call('/refresh-ui')).status).toBe(200)
      const failure = await call('/refresh-ui')
      expect(failure.status).toBe(500)
      expect(failure.body).toContain('build failed')
    } finally { await close() }
  })
})
