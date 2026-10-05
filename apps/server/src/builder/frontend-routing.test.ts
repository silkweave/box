import { describe, expect, it } from 'vitest'
import { createDevAccessCache, isPreviewDocument, isViteOnlyRequest, isViteSocket, shouldCompressDevResponse } from './frontend-routing.js'
import { applicationHeaders } from './supervisor-http.js'

const url = (path: string): URL => new URL(path, 'http://local')

describe('built-mode frontend routing', () => {
  it('recognises the paths only Vite answers', () => {
    for (const path of ['/@vite/client', '/@fs/box/features/crm/web/index.tsx', '/@id/__x00__react', '/@react-refresh', '/src/main.tsx', '/node_modules/.vite/deps/react.js', '/__open-in-editor', '/index.html?html-proxy&index=0.js']) {
      expect(isViteOnlyRequest(url(path)), path).toBe(true)
    }
    for (const path of ['/', '/assets/app-1.js', '/signals', '/srcs', '/api/auth/me', '/index.html', '/app-icon-512.png']) {
      expect(isViteOnlyRequest(url(path)), path).toBe(false)
    }
  })

  it('marks framed document loads and Vite sockets', () => {
    expect(isPreviewDocument({ method: 'GET', headers: { 'sec-fetch-dest': 'iframe' } })).toBe(true)
    expect(isPreviewDocument({ method: 'GET', headers: { 'sec-fetch-dest': 'document' } })).toBe(false)
    expect(isPreviewDocument({ method: 'POST', headers: { 'sec-fetch-dest': 'iframe' } })).toBe(false)
    expect(isPreviewDocument({ method: 'GET', headers: {} })).toBe(false)
    expect(isViteSocket({ 'sec-websocket-protocol': 'vite-hmr' })).toBe(true)
    expect(isViteSocket({ 'sec-websocket-protocol': 'vite-ping' })).toBe(true)
    expect(isViteSocket({})).toBe(false)
  })

  it('never forwards a client-supplied frontend header to the app', () => {
    const headers = applicationHeaders({ headers: { 'x-box-frontend': 'dev', host: 'box' }, socket: { remoteAddress: '127.0.0.1' } } as never)
    expect(headers['x-box-frontend']).toBeUndefined()
  })

  it('caches the admin decision per cookie for a bounded time', async () => {
    let clock = 0
    let calls = 0
    const cache = createDevAccessCache(async cookie => { calls += 1; return cookie === 'admin' }, { ttlMs: 100, now: () => clock })
    expect(await cache.allowed(undefined)).toBe(false)
    expect(await cache.allowed('admin')).toBe(true)
    expect(await cache.allowed('admin')).toBe(true)
    expect(await cache.allowed('member')).toBe(false)
    expect(await cache.allowed('member')).toBe(false)
    expect(calls).toBe(2)
    clock = 101
    expect(await cache.allowed('admin')).toBe(true)
    expect(calls).toBe(3)
    cache.clear()
    expect(await cache.allowed('admin')).toBe(true)
    expect(calls).toBe(4)
  })

  it('compresses uncompressed Vite text for remote clients only', () => {
    const base = { acceptEncoding: 'gzip, br', clientIp: '100.64.0.7', status: 200, headers: { 'content-type': 'text/javascript' } }
    expect(shouldCompressDevResponse(base)).toBe(true)
    expect(shouldCompressDevResponse({ ...base, clientIp: '127.0.0.1' })).toBe(false)
    expect(shouldCompressDevResponse({ ...base, clientIp: '::1' })).toBe(false)
    expect(shouldCompressDevResponse({ ...base, acceptEncoding: 'br' })).toBe(false)
    expect(shouldCompressDevResponse({ ...base, status: 304 })).toBe(false)
    expect(shouldCompressDevResponse({ ...base, headers: { 'content-type': 'text/javascript', 'content-encoding': 'br' } })).toBe(false)
    expect(shouldCompressDevResponse({ ...base, headers: { 'content-type': 'image/png' } })).toBe(false)
    expect(shouldCompressDevResponse({ ...base, headers: { 'content-type': 'text/event-stream' } })).toBe(false)
  })
})
