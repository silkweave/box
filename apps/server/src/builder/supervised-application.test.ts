import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILT_FRONTEND_RESTART_MESSAGE, SupervisedApplication, type SupervisedChild } from './supervised-application.js'
import { APP_RESTART_EXIT_CODE } from './restart-exit.js'

const waitUntil = async (condition: () => boolean, timeoutMs = 1_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached')
    await new Promise(resolve => setTimeout(resolve, 2))
  }
}

class FakeChild extends EventEmitter implements SupervisedChild {
  readonly pid = 4242
  killed: NodeJS.Signals[] = []

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killed.push(signal)
    return true
  }

  spawn(): void { queueMicrotask(() => this.emit('spawn')) }
  exit(code: number | null = 0, signal: NodeJS.Signals | null = null): void { this.emit('exit', code, signal) }
}

describe('SupervisedApplication', () => {
  it('does not report running until the internal health endpoint is ready', async () => {
    let ready = false
    let requested = ''
    const child = new FakeChild()
    const app = new SupervisedApplication({
      repoRoot: '/box', internalPort: 8191, vitePort: 5191,
      readinessPollMs: 1,
      probe: async (url) => { requested = url; return ready },
      spawn: () => { child.spawn(); return child },
      killProcessGroup: () => child.exit(0, 'SIGTERM'),
    })
    const starting = app.start()
    await Promise.resolve()
    expect(app.status.status).toBe('starting')
    ready = true
    await expect(starting).resolves.toMatchObject({ status: 'running' })
    expect(requested).toBe('http://127.0.0.1:8191/api/auth/instance')
  })

  it('starts the Bun source entry with an internal port and optional maintenance flag', async () => {
    const captured: { command?: string; args?: string[]; cwd?: string } = {}
    const child = new FakeChild()
    const app = new SupervisedApplication({
      repoRoot: '/box',
      internalPort: 8191,
      vitePort: 5191,
      probe: async () => true,
      spawn: (command, args, options) => {
        captured.command = command
        captured.args = args
        captured.cwd = options.cwd
        child.spawn()
        return child
      },
    })

    await expect(app.start(true)).resolves.toMatchObject({ status: 'running' })
    expect(captured).toEqual({
      command: process.execPath,
      args: ['--no-env-file', '--conditions=@silkweave/box-source', 'apps/server/src/main.ts', '--dev', '--internal-port=8191', '--maintenance'],
      cwd: '/box',
    })
  })

  it('waits for the owned process group to exit before reporting stopped', async () => {
    const children: FakeChild[] = []
    const calls: Array<{ pid: number; signal: NodeJS.Signals }> = []
    const app = new SupervisedApplication({
      repoRoot: '/box', internalPort: 8191, vitePort: 5191,
      probe: async () => true,
      spawn: (_command, _args, _options) => {
        const child = new FakeChild()
        children.push(child)
        child.spawn()
        return child
      },
      killProcessGroup: (pid, signal) => { calls.push({ pid, signal }) },
    })
    await app.start()
    const child = children[0]!
    const stopping = app.stop()
    expect(app.status.status).toBe('running')
    expect(calls).toEqual([{ pid: 4242, signal: 'SIGTERM' }])
    child.exit(0, 'SIGTERM')
    await expect(stopping).resolves.toMatchObject({ status: 'stopped' })
    expect(app.status).toEqual({ status: 'stopped' })
  })

  it('escalates to SIGKILL only after the bounded graceful-stop timeout', async () => {
    const child = new FakeChild()
    const calls: NodeJS.Signals[] = []
    const app = new SupervisedApplication({
      repoRoot: '/box', internalPort: 8191, vitePort: 5191, killTimeoutMs: 2,
      probe: async () => true,
      spawn: () => { child.spawn(); return child },
      killProcessGroup: (_pid, signal) => {
        calls.push(signal)
        if (signal === 'SIGKILL') child.exit(0, signal)
      },
    })
    await app.start()
    await expect(app.stop()).resolves.toMatchObject({ status: 'stopped' })
    expect(calls).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('preserves the operation error when a restart also fails', async () => {
    const first = new FakeChild()
    let launches = 0
    const app = new SupervisedApplication({
      repoRoot: '/box', internalPort: 8191, vitePort: 5191,
      probe: async () => true,
      spawn: () => {
        launches += 1
        if (launches > 1) throw new Error('restart failed')
        first.spawn()
        return first
      },
      killProcessGroup: () => first.exit(0, 'SIGTERM'),
    })
    await app.start()

    await expect(app.withStopped(() => { throw new Error('operation failed') })).rejects.toThrow('operation failed')
    expect(launches).toBe(2)
  })

  it('surfaces a restart error when the stopped operation succeeded', async () => {
    const first = new FakeChild()
    let launches = 0
    const app = new SupervisedApplication({
      repoRoot: '/box', internalPort: 8191, vitePort: 5191,
      probe: async () => true,
      spawn: () => {
        launches += 1
        if (launches > 1) throw new Error('restart failed')
        first.spawn()
        return first
      },
      killProcessGroup: () => first.exit(0, 'SIGTERM'),
    })
    await app.start()

    await expect(app.withStopped(() => 'completed')).rejects.toThrow('restart failed')
  })

  it('can restart after a child has failed and exited', async () => {
    const children: FakeChild[] = []
    let launches = 0
    const app = new SupervisedApplication({
      repoRoot: '/box', internalPort: 8191, vitePort: 5191,
      probe: async () => true,
      spawn: () => {
        launches += 1
        const child = new FakeChild()
        children.push(child)
        child.spawn()
        return child
      },
      killProcessGroup: () => undefined,
    })
    await app.start()
    children[0]!.exit(1, null)
    expect(app.status.status).toBe('failed')
    await expect(app.restart()).resolves.toMatchObject({ status: 'running' })
    expect(launches).toBe(2)
  })

  it('starts a fresh server when a running one exits with the restart code, keeping maintenance', async () => {
    const children: FakeChild[] = []
    const argsSeen: string[][] = []
    const app = new SupervisedApplication({
      repoRoot: '/box', internalPort: 8191, vitePort: 5191,
      readinessPollMs: 1,
      probe: async () => true,
      spawn: (_command, args) => {
        argsSeen.push(args)
        const child = new FakeChild()
        children.push(child)
        child.spawn()
        return child
      },
      killProcessGroup: () => undefined,
    })
    await app.start(true)
    children[0]!.exit(APP_RESTART_EXIT_CODE, null)
    expect(app.status.status).not.toBe('running')
    await waitUntil(() => app.status.status === 'running')
    expect(children).toHaveLength(2)
    expect(argsSeen[1]).toContain('--maintenance')
  })

  it('leaves a crashed server failed, and a restart code during boot is a failed start', async () => {
    const children: FakeChild[] = []
    let ready = true
    const app = new SupervisedApplication({
      repoRoot: '/box', internalPort: 8191, vitePort: 5191,
      readinessPollMs: 1,
      probe: async () => ready,
      spawn: () => {
        const child = new FakeChild()
        children.push(child)
        child.spawn()
        return child
      },
      killProcessGroup: () => undefined,
    })
    await app.start()
    children[0]!.exit(1, null)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(app.status.status).toBe('failed')
    expect(children).toHaveLength(1)

    ready = false
    const booting = app.start()
    await new Promise(resolve => setTimeout(resolve, 5))
    children[1]!.exit(APP_RESTART_EXIT_CODE, null)
    await expect(booting).rejects.toThrow()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(app.status.status).toBe('failed')
    expect(children).toHaveLength(2)
  })

  it('does not start Vite again for application restarts', async () => {
    let starts = 0
    let closes = 0
    const withVite = new SupervisedApplication({
      repoRoot: '/box', internalPort: 8191, vitePort: 5191,
      spawn: (_command, _args, _options) => {
        const child = new FakeChild()
        child.spawn()
        return child
      },
      killProcessGroup: () => undefined,
      startVite: () => { starts += 1 },
      closeVite: () => { closes += 1 },
    })
    await withVite.startVite()
    await withVite.startVite()
    await withVite.closeVite()
    await withVite.closeVite()
    expect({ starts, closes }).toEqual({ starts: 1, closes: 1 })
  })

  it('starts and closes the default Vite child independently', async () => {
    const captured: string[][] = []
    const directories: string[] = []
    const vite = new FakeChild()
    const app = new SupervisedApplication({
      repoRoot: '/box', internalPort: 8191, vitePort: 5191,
      probeVite: async () => true,
      spawn: (_command, args, options) => { captured.push(args); directories.push(options.cwd); vite.spawn(); return vite },
      killProcessGroup: (_pid, signal) => vite.exit(0, signal),
    })
    await app.startVite()
    await app.closeVite()
    expect(captured[0]).toEqual(['--no-env-file', 'run', 'dev', '--host', '127.0.0.1', '--port', '5191', '--strictPort'])
    expect(directories[0]).toBe('/box/apps/web')
  })
})

describe('SupervisedApplication frontend status', () => {
  it('reports built mode with the bundle time, or a missing bundle, before the first release', async () => {
    const root = mkdtempSync(join(tmpdir(), 'box-frontend-status-'))
    try {
      const app = new SupervisedApplication({ repoRoot: root, instanceDir: join(root, 'data'), internalPort: 8191, vitePort: 5191, dev: false })
      await expect(app.frontendStatus()).resolves.toMatchObject({ mode: 'built', server: 'release', status: 'missing', preview: { status: 'stopped', port: 5191 } })
      mkdirSync(join(root, 'apps/web/dist'), { recursive: true })
      writeFileSync(join(root, 'apps/web/dist/index.html'), '<!doctype html>')
      const status = await app.frontendStatus()
      expect(status).toMatchObject({ mode: 'built', status: 'built', path: join(root, 'apps/web/dist/index.html') })
      expect(status.mode === 'built' && typeof status.builtAt).toBe('string')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('reports the promoted release and the Preview Vite state in built mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'box-frontend-release-'))
    try {
      const version = '00000000-0000-4000-8000-000000000001'
      const dir = join(root, 'data/web/releases', version)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.html'), '<!doctype html>')
      writeFileSync(join(dir, 'release.json'), JSON.stringify({ version, createdAt: '2026-10-05T00:00:00.000Z', sourceSha: 'abc', dirty: false }))
      writeFileSync(join(root, 'data/web/current'), version)
      let starts = 0
      const app = new SupervisedApplication({ repoRoot: root, instanceDir: join(root, 'data'), internalPort: 8191, vitePort: 5191, dev: false,
        probeVite: async () => true, startVite: () => { starts += 1 }, closeVite: () => undefined })
      await expect(app.frontendStatus()).resolves.toMatchObject({ mode: 'built', server: 'release', status: 'built', version, sourceSha: 'abc', preview: { status: 'stopped' } })
      await app.startVite()
      expect(starts).toBe(1)
      expect(app.viteRunning).toBe(true)
      await expect(app.frontendStatus()).resolves.toMatchObject({ preview: { status: 'running', port: 5191 } })
      await expect(app.restartFrontend()).resolves.toMatchObject({ mode: 'built' })
      expect(starts).toBe(2)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('refuses a frontend restart in built mode without a Preview Vite, with the supported path', async () => {
    const app = new SupervisedApplication({ repoRoot: '/box', internalPort: 8191, vitePort: 5191, dev: false })
    await expect(app.restartFrontend()).rejects.toMatchObject({ statusCode: 409, message: BUILT_FRONTEND_RESTART_MESSAGE })
  })

  it('probes Vite in dev mode and restarts only Vite', async () => {
    let answering = true
    let starts = 0
    let closes = 0
    const app = new SupervisedApplication({
      repoRoot: '/box', internalPort: 8191, vitePort: 5191,
      probeVite: async () => answering,
      startVite: () => { starts += 1 },
      closeVite: () => { closes += 1 },
    })
    await expect(app.frontendStatus()).resolves.toEqual({ mode: 'dev', server: 'vite', port: 5191, status: 'stopped' })
    await app.startVite()
    await expect(app.frontendStatus()).resolves.toMatchObject({ mode: 'dev', status: 'running' })
    answering = false
    await expect(app.frontendStatus()).resolves.toMatchObject({ status: 'failed', message: 'Vite is not answering on port 5191' })
    answering = true
    await expect(app.restartFrontend()).resolves.toMatchObject({ mode: 'dev', status: 'running' })
    expect({ starts, closes }).toEqual({ starts: 2, closes: 1 })
    expect(app.status.status).toBe('stopped')
  })

  it('reports a Vite start failure until the next successful start', async () => {
    let fail = true
    const app = new SupervisedApplication({
      repoRoot: '/box', internalPort: 8191, vitePort: 5191,
      probeVite: async () => true,
      startVite: () => { if (fail) throw new Error('port 5191 in use') },
    })
    await expect(app.startVite()).rejects.toThrow('port 5191 in use')
    await expect(app.frontendStatus()).resolves.toMatchObject({ status: 'failed', message: 'port 5191 in use' })
    fail = false
    await app.startVite()
    await expect(app.frontendStatus()).resolves.toMatchObject({ status: 'running' })
  })

  it('reports an unexpected Vite exit as a failure, but not a requested close', async () => {
    const vite = new FakeChild()
    const app = new SupervisedApplication({
      repoRoot: '/box', internalPort: 8191, vitePort: 5191,
      probeVite: async () => true,
      spawn: () => { vite.spawn(); return vite },
      killProcessGroup: (_pid, signal) => vite.exit(0, signal),
    })
    await app.startVite()
    vite.exit(1)
    await expect(app.frontendStatus()).resolves.toMatchObject({ status: 'failed', message: 'Vite exited with code 1' })
    const next = new FakeChild()
    const closing = new SupervisedApplication({
      repoRoot: '/box', internalPort: 8191, vitePort: 5191,
      probeVite: async () => true,
      spawn: () => { next.spawn(); return next },
      killProcessGroup: (_pid, signal) => next.exit(0, signal),
    })
    await closing.startVite()
    await closing.closeVite()
    await expect(closing.frontendStatus()).resolves.toMatchObject({ status: 'stopped' })
  })
})
