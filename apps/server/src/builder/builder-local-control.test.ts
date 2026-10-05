import { request } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { builderLocalControlPath, startBuilderLocalControl } from './builder-local-control.js'
import { FrontendControlError, type SupervisedFrontendStatus } from './supervised-application.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function call(socketPath: string, method: string, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method, path }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) as Record<string, unknown> }))
    })
    req.on('error', reject)
    req.end()
  })
}

async function start(frontend: () => Promise<SupervisedFrontendStatus>, restartFrontend: () => Promise<SupervisedFrontendStatus>) {
  // Unix socket paths are short; a deep tmpdir would overflow them.
  const instance = mkdtempSync(join(tmpdir(), 'blc-'))
  roots.push(instance)
  mkdirSync(join(instance, 'builder'))
  const close = await startBuilderLocalControl(instance, {
    status: () => ({ status: 'running' }),
    frontend,
    restart: async () => ({ status: 'running' }),
    restartFrontend,
    refresh: async () => undefined,
  })
  return { socket: builderLocalControlPath(instance), close }
}

describe('Builder local control frontend operations', () => {
  it('reports the frontend mode and state beside the application status', async () => {
    const built: SupervisedFrontendStatus = { mode: 'built', server: 'release', status: 'built', path: '/box/data/web/releases/x/index.html', builtAt: '2026-09-29T00:00:00.000Z', preview: { status: 'stopped', port: 5191 } }
    const { socket, close } = await start(async () => built, async () => built)
    try {
      await expect(call(socket, 'GET', '/app-status')).resolves.toEqual({ status: 200, body: { ok: true, application: { status: 'running' }, frontend: built } })
    } finally { await close() }
  })

  it('restarts the frontend and passes a refusal through with its status code', async () => {
    const dev: SupervisedFrontendStatus = { mode: 'dev', server: 'vite', status: 'running', port: 5191 }
    let refuse = false
    const { socket, close } = await start(async () => dev, async () => {
      if (refuse) throw new FrontendControlError(409, 'no Vite in built mode')
      return dev
    })
    try {
      const restarted = await call(socket, 'POST', '/frontend-restart')
      expect(restarted).toMatchObject({ status: 200, body: { ok: true, frontend: dev } })
      refuse = true
      await expect(call(socket, 'POST', '/frontend-restart')).resolves.toEqual({ status: 409, body: { message: 'no Vite in built mode' } })
    } finally { await close() }
  })

  it('still answers status when the frontend probe fails', async () => {
    const { socket, close } = await start(async () => { throw new Error('probe failed') }, async () => { throw new Error('unused') })
    try {
      await expect(call(socket, 'GET', '/app-status')).resolves.toEqual({ status: 200, body: { ok: true, application: { status: 'running' } } })
    } finally { await close() }
  })
})
