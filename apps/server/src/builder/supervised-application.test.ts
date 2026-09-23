import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { SupervisedApplication, type SupervisedChild } from './supervised-application.js'

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
