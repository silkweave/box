import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { startBuilderBrowserLocal } from './builder-browser-local.js'

const roots: string[] = []
const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function instance(): string {
  const root = mkdtempSync(join(tmpdir(), 'bb-'))
  roots.push(root)
  mkdirSync(join(root, 'builder'))
  return root
}
function call(root: string, body: unknown, method = 'POST', path = '/execute'): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: join(root, 'builder/browser.sock'), method, path }, res => {
      let text = ''
      res.on('data', chunk => { text += String(chunk) })
      res.on('error', reject)
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text) }))
    })
    req.on('error', reject)
    req.end(method === 'GET' ? undefined : JSON.stringify(body))
  })
}
it('uses an owner-only socket and requires an explicit session before dispatch', async () => {
  const root = instance()
  const execute = vi.fn(async () => ({ nodes: [] }))
  closers.push(await startBuilderBrowserLocal(root, { execute, revoke: vi.fn() }))
  expect(statSync(join(root, 'builder/browser.sock')).mode & 0o777).toBe(0o600)
  expect((await call(root, { command: { op: 'snapshot' } })).status).toBe(409)
  expect(execute).not.toHaveBeenCalled()
  expect((await call(root, {}, 'GET')).status).toBe(404)
  expect(await call(root, { sessionId: 'session', command: { op: 'snapshot' } })).toEqual({ status: 200, body: { nodes: [] } })
  expect(execute).toHaveBeenCalledWith('session', { op: 'snapshot' })
})
it('preserves an occupied non-socket path', async () => {
  const root = instance()
  writeFileSync(join(root, 'builder/browser.sock'), 'keep')
  await expect(startBuilderBrowserLocal(root, { execute: vi.fn(), revoke: vi.fn() })).rejects.toThrow('non-socket')
})
