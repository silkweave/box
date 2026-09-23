import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { applicationHeaders, previewResponseHeaders } from './supervisor-http.js'

const request = (remoteAddress: string, headers: IncomingMessage['headers']) => ({ headers, socket: { remoteAddress } }) as Pick<IncomingMessage, 'headers' | 'socket'>

describe('supervisor forwarding boundary', () => {
  it('does not turn forged forwarding headers from a remote peer into trusted loopback claims', () => {
    const headers = applicationHeaders(request('192.0.2.8', {
      'x-forwarded-for': '127.0.0.1', 'x-forwarded-proto': 'https', forwarded: 'for=127.0.0.1',
      cookie: 'test-session', host: 'box.example',
    }))
    expect(headers['x-forwarded-for']).toBe('192.0.2.8')
    expect(headers['x-forwarded-proto']).toBe('http')
    expect(headers.forwarded).toBeUndefined()
    expect(headers.cookie).toBe('test-session')
    expect(headers.host).toBe('box.example')
  })
  it('preserves the trusted local reverse proxy final hop and secure transport', () => {
    const headers = applicationHeaders(request('127.0.0.1', { 'x-forwarded-for': 'forged, 192.0.2.9', 'x-forwarded-proto': 'https' }))
    expect(headers['x-forwarded-for']).toBe('192.0.2.9')
    expect(headers['x-forwarded-proto']).toBe('https')
  })
})


it('allows same-origin preview HTML without allowing foreign embedding or changing API headers', () => {
  const html = previewResponseHeaders({ 'content-type': 'text/html', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'" })
  expect(html['x-frame-options']).toBe('SAMEORIGIN')
  expect(html['content-security-policy']).toBe("default-src 'self'; frame-ancestors 'self'; base-uri 'none'")
  const api = { 'content-type': 'application/json', 'x-frame-options': 'DENY' }
  expect(previewResponseHeaders(api)).toBe(api)
})
