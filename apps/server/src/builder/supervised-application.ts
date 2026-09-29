import { diagnostic, errorKind } from '../diagnostics/runtime.js'
import { spawn as nodeSpawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { join } from 'node:path'

export type SupervisedApplicationStatus = {
  status: 'starting' | 'running' | 'stopped' | 'failed'
  message?: string
}

/**
 * How the web frontend is served, so agents can check instead of guessing. `box dev` runs a Vite
 * child the supervisor can restart; `box start` serves the built bundle in apps/web/dist, which
 * only changes when it is rebuilt.
 */
export type SupervisedFrontendStatus =
  | { mode: 'dev'; server: 'vite'; status: 'running' | 'stopped' | 'failed'; port: number; message?: string }
  | { mode: 'built'; server: 'bundle'; status: 'built' | 'missing'; path: string; builtAt?: string }

/** Refused operation with an HTTP status the local control socket passes through. */
export class FrontendControlError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message) }
}

export const BUILT_FRONTEND_RESTART_MESSAGE =
  'This Box serves the built web bundle (box start), so there is no Vite dev server to restart. '
  + 'Rebuild with box build, then reload the preview; backend changes still need box app restart.'

export interface SupervisedChild {
  readonly pid?: number
  readonly stdout?: NodeJS.ReadableStream | null
  readonly stderr?: NodeJS.ReadableStream | null
  once(event: 'spawn', listener: () => void): this
  once(event: 'error', listener: (error: Error) => void): this
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  kill(signal?: NodeJS.Signals): boolean
}

export interface SupervisedApplicationOptions {
  repoRoot: string
  internalPort: number
  vitePort: number
  dev?: boolean
  probe?: (url: string) => Promise<boolean>
  probeVite?: (url: string) => Promise<boolean>
  readinessTimeoutMs?: number
  readinessPollMs?: number
  spawn?: (command: string, args: string[], options: { cwd: string; detached: true; stdio: 'inherit' | ['ignore', 'pipe', 'pipe'] }) => SupervisedChild
  onOutput?: (source: 'app' | 'vite', level: 'info' | 'warn', line: string) => void
  killProcessGroup?: (pid: number, signal: NodeJS.Signals) => void
  killTimeoutMs?: number
  startVite?: () => Promise<void> | void
  closeVite?: () => Promise<void> | void
}

const defaultSpawn = (command: string, args: string[], options: { cwd: string; detached: true; stdio: 'inherit' | ['ignore', 'pipe', 'pipe'] }): SupervisedChild =>
  nodeSpawn(command, args, options) as unknown as SupervisedChild

const defaultKillProcessGroup = (pid: number, signal: NodeJS.Signals): void => {
  // Every child is detached and receives its own process group. Negative pid is deliberate: it
  // terminates the Bun wrapper and all of its Nest/Vite descendants, but no unrelated process.
  process.kill(process.platform === 'win32' ? pid : -pid, signal)
}

const exitMessage = (code: number | null, signal: NodeJS.Signals | null): string =>
  signal ? `Box server exited with ${signal}` : `Box server exited with code ${code ?? 'unknown'}`

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Owns the editable Box server and its stable, independent Vite process. */
export class SupervisedApplication {
  readonly #repoRoot: string
  readonly #internalPort: number
  readonly #vitePort: number
  readonly #dev: boolean
  readonly #probe: (url: string) => Promise<boolean>
  readonly #probeVite: (url: string) => Promise<boolean>
  readonly #readinessTimeoutMs: number
  readonly #readinessPollMs: number
  readonly #spawn: NonNullable<SupervisedApplicationOptions['spawn']>
  readonly #killProcessGroup: NonNullable<SupervisedApplicationOptions['killProcessGroup']>
  readonly #killTimeoutMs: number
  readonly #startViteCallback?: () => Promise<void> | void
  readonly #closeViteCallback?: () => Promise<void> | void
  readonly #onOutput?: NonNullable<SupervisedApplicationOptions['onOutput']>
  #status: SupervisedApplicationStatus = { status: 'stopped' }
  #child: SupervisedChild | undefined
  #exitPromise: Promise<void> | undefined
  #exitPromiseResolve: (() => void) | undefined
  #startPromise: Promise<SupervisedApplicationStatus> | undefined
  #stopPromise: Promise<SupervisedApplicationStatus> | undefined
  #stopRequested = false
  #maintenance = false
  #viteChild: SupervisedChild | undefined
  #viteExitPromise: Promise<void> | undefined
  #viteExitResolve: (() => void) | undefined
  #viteStarted = false
  #viteFailure: string | undefined

  constructor(options: SupervisedApplicationOptions) {
    if (!Number.isSafeInteger(options.internalPort) || options.internalPort < 1 || options.internalPort > 65_535) throw new Error('internalPort must be a port number')
    if (!Number.isSafeInteger(options.vitePort) || options.vitePort < 1 || options.vitePort > 65_535) throw new Error('vitePort must be a port number')
    const killTimeoutMs = options.killTimeoutMs ?? 5_000
    const readinessTimeoutMs = options.readinessTimeoutMs ?? 20_000
    const readinessPollMs = options.readinessPollMs ?? 100
    if (!Number.isSafeInteger(killTimeoutMs) || killTimeoutMs <= 0) throw new Error('killTimeoutMs must be a positive integer')
    if (!Number.isSafeInteger(readinessTimeoutMs) || readinessTimeoutMs <= 0) throw new Error('readinessTimeoutMs must be a positive integer')
    if (!Number.isSafeInteger(readinessPollMs) || readinessPollMs <= 0) throw new Error('readinessPollMs must be a positive integer')
    this.#repoRoot = options.repoRoot
    this.#internalPort = options.internalPort
    this.#vitePort = options.vitePort
    this.#dev = options.dev ?? true
    this.#probe = options.probe ?? (async (url) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Math.min(1_000, readinessTimeoutMs))
      try { return (await fetch(url, { signal: controller.signal })).ok }
      finally { clearTimeout(timer) }
    })
    this.#probeVite = options.probeVite ?? (async (url) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), Math.min(1_000, readinessTimeoutMs))
      try { return (await fetch(url, { signal: controller.signal })).ok }
      finally { clearTimeout(timer) }
    })
    this.#readinessTimeoutMs = readinessTimeoutMs
    this.#readinessPollMs = readinessPollMs
    this.#spawn = options.spawn ?? defaultSpawn
    this.#killProcessGroup = options.killProcessGroup ?? defaultKillProcessGroup
    this.#killTimeoutMs = killTimeoutMs
    this.#startViteCallback = options.startVite
    this.#closeViteCallback = options.closeVite
    this.#onOutput = options.onOutput
  }

  get status(): SupervisedApplicationStatus { return { ...this.#status } }
  get dev(): boolean { return this.#dev }

  /** Live frontend state: probes Vite in dev mode, inspects the served bundle otherwise. */
  async frontendStatus(): Promise<SupervisedFrontendStatus> {
    if (!this.#dev) {
      const path = join(this.#repoRoot, 'apps', 'web', 'dist', 'index.html')
      try { return { mode: 'built', server: 'bundle', status: 'built', path, builtAt: statSync(path).mtime.toISOString() } }
      catch { return { mode: 'built', server: 'bundle', status: 'missing', path } }
    }
    const base = { mode: 'dev', server: 'vite', port: this.#vitePort } as const
    if (!this.#viteStarted) return this.#viteFailure ? { ...base, status: 'failed', message: this.#viteFailure } : { ...base, status: 'stopped' }
    let answering = false
    try { answering = await this.#probeVite(`http://127.0.0.1:${this.#vitePort}/`) } catch { /* reported below */ }
    return answering ? { ...base, status: 'running' } : { ...base, status: 'failed', message: `Vite is not answering on port ${this.#vitePort}` }
  }

  /** Restart only the Vite dev server. Built mode has none and is refused with the supported path. */
  async restartFrontend(): Promise<SupervisedFrontendStatus> {
    if (!this.#dev) throw new FrontendControlError(409, BUILT_FRONTEND_RESTART_MESSAGE)
    diagnostic('lifecycle', 'vite.restart', { childPid: this.#viteChild?.pid })
    await this.restartVite()
    return this.frontendStatus()
  }
  get maintenance(): boolean { return this.#maintenance }

  async start(maintenance = false): Promise<SupervisedApplicationStatus> {
    if (this.#status.status === 'running') return this.status
    if (this.#startPromise) return this.#startPromise
    diagnostic('lifecycle', 'app.start', { maintenance, internalPort: this.#internalPort })
    this.#maintenance = maintenance
    this.#status = { status: 'starting' }
    this.#stopRequested = false
    const args = [
      '--no-env-file', '--conditions=@silkweave/box-source', 'apps/server/src/main.ts',
      ...(this.#dev ? ['--dev'] : []), `--internal-port=${this.#internalPort}`,
      ...(maintenance ? ['--maintenance'] : []),
    ]
    const startPromise = this.#startChild(args)
    this.#startPromise = startPromise
    try { return await startPromise } finally {
      if (this.#startPromise === startPromise) this.#startPromise = undefined
    }
  }

  async stop(): Promise<SupervisedApplicationStatus> {
    if (this.#stopPromise) return this.#stopPromise
    const child = this.#child
    if (!child || !this.#exitPromise) return this.status
    diagnostic('lifecycle', 'app.stop', { childPid: child.pid })
    this.#stopRequested = true
    const stopPromise = this.#stopChild(child, this.#exitPromise)
    this.#stopPromise = stopPromise
    try { return await stopPromise } finally {
      if (this.#stopPromise === stopPromise) this.#stopPromise = undefined
    }
  }

  async restart(maintenance?: boolean): Promise<SupervisedApplicationStatus> {
    diagnostic('lifecycle', 'app.restart', { childPid: this.#child?.pid, maintenance })
    const nextMaintenance = maintenance ?? this.#maintenance
    if (this.#child) await this.stop()
    return this.start(nextMaintenance)
  }

  async withStopped<T>(operation: () => Promise<T> | T): Promise<T> {
    diagnostic('lifecycle', 'app.offline-operation.start')
    const hadChild = this.#child !== undefined
    const wasActive = hadChild || this.#status.status === 'starting' || this.#status.status === 'running'
    const previousMaintenance = this.#maintenance
    if (hadChild) await this.stop()
    let value: T | undefined
    let operationFailed = false
    let operationError: unknown
    try { value = await operation() } catch (error) { operationFailed = true; operationError = error }
    let restartError: unknown
    if (wasActive) {
      try { await this.start(previousMaintenance) } catch (error) { restartError = error }
    }
    diagnostic('lifecycle', 'app.offline-operation.finish', { operationFailed, restartFailed: restartError !== undefined })
    if (operationFailed) throw operationError
    if (restartError !== undefined) throw restartError
    return value as T
  }

  async startVite(): Promise<void> {
    if (!this.#dev || this.#viteStarted) return
    this.#viteFailure = undefined
    if (this.#startViteCallback) {
      try { await this.#startViteCallback() }
      catch (error) { this.#viteFailure = error instanceof Error ? error.message : String(error); throw error }
      this.#viteStarted = true
      return
    }
    const args = [
      '--no-env-file', 'run', 'dev',
      '--host', '127.0.0.1', '--port', String(this.#vitePort), '--strictPort',
    ]
    const child = this.#spawn(process.execPath, args, { cwd: join(this.#repoRoot, 'apps/web'), detached: true, stdio: this.#onOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
    this.#capture(child, 'vite')
    diagnostic('lifecycle', 'vite.spawn', { childPid: child.pid, port: this.#vitePort })
    this.#viteChild = child
    this.#viteExitPromise = new Promise<void>((resolve) => { this.#viteExitResolve = resolve })
    const started = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    child.once('exit', (code, signal) => {
      diagnostic('lifecycle', 'vite.exit', { childPid: child.pid, code, signal })
      // An exit while running is a crash until closeVite() says it was requested.
      if (this.#viteStarted) this.#viteFailure = `Vite exited with ${signal ?? `code ${code ?? 'unknown'}`}`
      this.#viteChild = undefined
      this.#viteStarted = false
      this.#viteExitResolve?.()
      this.#viteExitResolve = undefined
    })
    try {
      await started
      await this.#waitForUrl(this.#viteExitPromise, `http://127.0.0.1:${this.#vitePort}/`, this.#probeVite, 'Vite')
      this.#viteStarted = true
    } catch (error) {
      if (this.#viteChild === child) {
        try { await this.#stopChildProcess(child, this.#viteExitPromise!, 'Vite') } catch { /* preserve startup failure */ }
      }
      this.#viteStarted = false
      this.#viteFailure = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async closeVite(): Promise<void> {
    if (!this.#viteStarted || (!this.#closeViteCallback && !this.#viteChild)) return
    if (this.#closeViteCallback) {
      await this.#closeViteCallback()
      this.#viteStarted = false
      return
    }
    const child = this.#viteChild
    const exited = this.#viteExitPromise
    if (child && exited) await this.#stopChildProcess(child, exited, 'Vite')
    this.#viteStarted = false
    this.#viteFailure = undefined
  }

  async restartVite(): Promise<void> {
    await this.closeVite()
    await this.startVite()
  }

  async close(): Promise<void> {
    await this.closeVite()
    await this.stop()
  }

  async #startChild(args: string[]): Promise<SupervisedApplicationStatus> {
    let child: SupervisedChild
    try {
      child = this.#spawn(process.execPath, args, { cwd: this.#repoRoot, detached: true, stdio: this.#onOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
      this.#capture(child, 'app')
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      this.#status = { status: 'failed', message: failure.message }
      throw failure
    }
    diagnostic('lifecycle', 'app.spawn', { childPid: child.pid })
    this.#child = child
    const exited = new Promise<void>((resolve) => { this.#exitPromiseResolve = resolve })
    this.#exitPromise = exited
    let spawned = false
    child.once('spawn', () => { spawned = true })
    child.once('error', (error) => {
      diagnostic('lifecycle', 'app.error', { childPid: child.pid, error: errorKind(error) })
      if (!spawned) {
        this.#child = undefined
        this.#status = { status: 'failed', message: error.message }
        this.#exitPromiseResolve?.()
        this.#exitPromiseResolve = undefined
      }
      else if (this.#child === child) this.#status = { status: 'failed', message: error.message }
    })
    child.once('exit', (code, signal) => {
      diagnostic('lifecycle', 'app.exit', { childPid: child.pid, code, signal, expected: this.#stopRequested })
      if (this.#child !== child) return
      this.#child = undefined
      this.#status = this.#stopRequested ? { status: 'stopped' } : { status: 'failed', message: exitMessage(code, signal) }
      this.#stopRequested = false
      this.#exitPromiseResolve?.()
      this.#exitPromiseResolve = undefined
    })
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve)
        child.once('error', reject)
      })
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      this.#status = { status: 'failed', message: failure.message }
      throw failure
    }
    try {
      await this.#waitForUrl(exited, `http://127.0.0.1:${this.#internalPort}/api/auth/instance`, this.#probe, 'Box server')
      if (this.#child !== child) throw new Error('Box server exited before becoming ready')
      this.#status = { status: 'running' }
      return this.status
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      if (this.#child === child) {
        this.#stopRequested = true
        try { await this.#stopChild(child, exited) } catch { /* preserve readiness failure */ }
      }
      this.#status = { status: 'failed', message: failure.message }
      throw failure
    }
  }

  async #waitForUrl(
    exited: Promise<void> | undefined,
    url: string,
    probe: (url: string) => Promise<boolean>,
    label: string,
  ): Promise<void> {
    const started = performance.now()
    let attempts = 0
    let lastLog = started
    diagnostic('lifecycle', 'readiness.start', { target: label })
    const deadline = Date.now() + this.#readinessTimeoutMs
    while (Date.now() < deadline) {
      attempts++
      try {
        if (await probe(url)) {
          diagnostic('lifecycle', 'readiness.ready', { target: label, attempts, durationMs: Math.round(performance.now() - started) })
          return
        }
      } catch { /* retry until the bounded deadline */ }
      if (performance.now() - lastLog >= 1_000) {
        diagnostic('lifecycle', 'readiness.wait', { target: label, attempts, durationMs: Math.round(performance.now() - started) })
        lastLog = performance.now()
      }
      if (exited && await Promise.race([exited.then(() => true), sleep(this.#readinessPollMs).then(() => false)])) {
        throw new Error(`${label} exited before becoming ready`)
      }
    }
    diagnostic('lifecycle', 'readiness.timeout', { target: label, attempts, durationMs: Math.round(performance.now() - started) })
    throw new Error(`${label} did not become ready within ${this.#readinessTimeoutMs}ms`)
  }

  #capture(child: SupervisedChild, source: 'app' | 'vite'): void {
    if (!this.#onOutput) return
    const connect = (stream: NodeJS.ReadableStream | null | undefined, level: 'info' | 'warn') => {
      if (!stream) return
      let pending = ''
      stream.setEncoding?.('utf8')
      stream.on('data', (chunk: string | Buffer) => {
        pending += chunk.toString()
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() ?? ''
        for (const line of lines) if (line) this.#onOutput?.(source, level, line)
      })
      stream.on('end', () => { if (pending) this.#onOutput?.(source, level, pending) })
    }
    connect(child.stdout, 'info')
    connect(child.stderr, 'warn')
  }

  async #stopChild(child: SupervisedChild, exited: Promise<void>): Promise<SupervisedApplicationStatus> {
    await this.#stopChildProcess(child, exited, 'Box server')
    return this.status
  }

  async #stopChildProcess(child: SupervisedChild, exited: Promise<void>, label: string): Promise<void> {
    const pid = child.pid
    if (pid === undefined) throw new Error(`${label} child has no pid; refusing to touch an unknown process`)
    diagnostic('lifecycle', 'child.signal', { target: label, childPid: pid, signal: 'SIGTERM' })
    try { this.#killProcessGroup(pid, 'SIGTERM') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    if (await this.#waitForExit(exited)) return
    diagnostic('lifecycle', 'child.signal', { target: label, childPid: pid, signal: 'SIGKILL' })
    try { this.#killProcessGroup(pid, 'SIGKILL') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    if (!(await this.#waitForExit(exited))) throw new Error(`${label} did not exit after SIGKILL`)
  }

  async #waitForExit(exited: Promise<void>): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), this.#killTimeoutMs) })
    const result = await Promise.race([exited.then(() => true as const), timedOut])
    if (timer) clearTimeout(timer)
    return result
  }
}
