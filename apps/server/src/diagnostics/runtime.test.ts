import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorKind, requestId, requestRoute, traceHttp } from './runtime.js'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('runtime diagnostics', () => {
  it('omits credentials, query payloads, dynamic identifiers and filesystem paths', () => {
    expect(requestRoute('/login?link=secret')).toBe('/login')
    expect(requestRoute('/login/bl2.secret')).toBe('/login/:path')
    expect(requestRoute('/?token=secret')).toBe('/')
    expect(requestRoute('/chat/private-room')).toBe('/chat/:path')
    expect(requestRoute('/@fs/Users/private/secret')).toBe('/@fs/:path')
    expect(requestRoute('/trpc/chatMessages?input=secret')).toBe('/trpc/chatMessages')
    expect(requestRoute('/api/builder-control/restart')).toBe('/api/builder-control/restart')
    expect(errorKind(new Error('bearer secret'))).toBe('Error')
    expect(errorKind({ code: 'token=secret' })).toBe('Error')
  })

  it('correlates requests and distinguishes stalled headers from an open stream, then cleans up', () => {
    vi.useFakeTimers()
    const output = vi.spyOn(console, 'info').mockImplementation(() => {})
    const req = Object.assign(new EventEmitter(), { url: '/trpc/changesFeed?input=secret', method: 'GET', headers: { cookie: 'secret', 'x-box-request-id': '12345678-1234-1234-1234-123456789abc' } }) as unknown as IncomingMessage
    const res = Object.assign(new EventEmitter(), { headersSent: false, statusCode: 200 }) as unknown as ServerResponse
    traceHttp('app', req, res, true)
    expect(requestId(req)).toBe('12345678-1234-1234-1234-123456789abc')
    vi.advanceTimersByTime(10_000)
    Object.defineProperty(res, 'headersSent', { value: true })
    vi.advanceTimersByTime(10_000)
    res.emit('close')
    const count = output.mock.calls.length
    vi.advanceTimersByTime(30_000)
    expect(output.mock.calls.length).toBe(count)
    const rows = output.mock.calls.map(([line]) => JSON.parse(line))
    expect(rows.map(row => row.event)).toEqual(['http.start', 'http.wait', 'http.open', 'http.closed-before-finish'])
    expect(JSON.stringify(rows)).not.toContain('secret')
    expect(rows.every(row => row.requestId === requestId(req))).toBe(true)
  })

  it('does not trust externally supplied correlation IDs and finishes exactly once', () => {
    const output = vi.spyOn(console, 'info').mockImplementation(() => {})
    const req = Object.assign(new EventEmitter(), { url: '/', method: 'GET', headers: { 'x-box-request-id': '12345678-1234-1234-1234-123456789abc' } }) as unknown as IncomingMessage
    const res = Object.assign(new EventEmitter(), { headersSent: true, statusCode: 200 }) as unknown as ServerResponse
    traceHttp('supervisor', req, res)
    res.emit('finish')
    res.emit('close')
    expect(requestId(req)).not.toBe(req.headers['x-box-request-id'])
    expect(output.mock.calls.map(([line]) => JSON.parse(line).event)).toEqual(['http.start', 'http.finish'])
  })
})
