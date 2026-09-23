import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requestApplicationControl } from '../app-control.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

test('application control uses the bounded local supervisor endpoints', async () => {
  const root = mkdtempSync(join(tmpdir(), 'box-app-control-'))
  roots.push(root)
  const socket = join(root, 'control.sock')
  const calls: string[] = []
  const server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, application: { status: 'running' }, message: 'Application restarted' }))
  })
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(socket, () => { chmodSync(socket, 0o600); resolve() }))
  try {
    assert.equal((await requestApplicationControl(socket, 'status')).application?.status, 'running')
    assert.equal((await requestApplicationControl(socket, 'restart')).application?.status, 'running')
    assert.deepEqual(calls, ['GET /app-status', 'POST /app-restart'])
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

describe('application control failures', () => {
  test('explains that an unreachable supervisor must not be replaced by a second Box', async () => {
    const root = mkdtempSync(join(tmpdir(), 'box-app-control-missing-'))
    roots.push(root)
    await assert.rejects(requestApplicationControl(join(root, 'missing.sock'), 'restart'), /Do not start a second Box or stop box dev/)
  })
})
