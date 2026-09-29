import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeFrontend, parseAppArgs, requestApplicationControl } from '../app-control.ts'

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
    await requestApplicationControl(socket, 'restart-frontend')
    assert.deepEqual(calls, ['GET /app-status', 'POST /app-restart', 'POST /frontend-restart'])
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

describe('application control arguments and frontend report', () => {
  test('parses status, restart and the frontend restart', () => {
    assert.deepEqual(parseAppArgs(['status']), { action: 'status', json: false })
    assert.deepEqual(parseAppArgs(['status', '--json']), { action: 'status', json: true })
    assert.deepEqual(parseAppArgs(['restart']), { action: 'restart', json: false })
    assert.deepEqual(parseAppArgs(['restart', '--frontend']), { action: 'restart-frontend', json: false })
    assert.equal(parseAppArgs(['status', '--frontend']), undefined)
    assert.equal(parseAppArgs(['restart', '--hard']), undefined)
    assert.equal(parseAppArgs([]), undefined)
  })

  test('names the mode and the next step for each frontend state', () => {
    const built = describeFrontend({ mode: 'built', server: 'bundle', status: 'built', path: '/box/apps/web/dist/index.html', builtAt: '2026-09-29T00:00:00.000Z' })
    assert.equal(built.healthy, true)
    assert.match(built.lines[0]!, /Mode: built \(box start\).*\/box\/apps\/web\/dist, there is no Vite/)
    assert.match(built.lines[1]!, /box build/)
    assert.match(describeFrontend({ mode: 'built', server: 'bundle', status: 'missing', path: '/box/apps/web/dist/index.html' }).lines[1]!, /missing\. Run box build/)
    const down = describeFrontend({ mode: 'dev', server: 'vite', status: 'failed', port: 5191, message: 'Vite exited with code 1' })
    assert.equal(down.healthy, false)
    assert.match(down.lines[0]!, /Mode: dev \(box dev\).*port 5191/)
    assert.match(down.lines[1]!, /failed: Vite exited with code 1\. Run box app restart --frontend/)
    assert.match(describeFrontend(undefined).lines[0]!, /predates frontend status/)
  })
})
