// The Box as a background service of the signed-in user: a systemd user unit on Linux (with
// lingering, so it survives logout and SSH disconnects and starts at boot), a launchd agent on macOS.
// The service runs the supervisor in built mode, as `box start` does; `box dev` needs it stopped.
//
//   box service install     write the unit, enable it and start it (again: rewrite and restart)
//   box service uninstall   stop it and remove the unit
//   box service start|stop|restart|status
//   box service logs [-f]   what the Box printed: the user journal (systemd), data/logs/service.log (launchd)
import { spawnSync, type SpawnSyncOptions } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { homedir, userInfo } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { commandError, commandHeader, commandLine, commandSuccess, commandValue, commandWarning } from './command-ui.js'
import { isMain, repoRoot } from './repo.js'

export type ServicePlatform = 'systemd' | 'launchd'

export interface ServiceSpec {
  root: string
  /** systemd unit name without `.service`, or launchd label. */
  name: string
  bun: string
  path: string
  /** launchd only: systemd writes to the journal. */
  log: string
}

export interface ServiceState {
  installed: boolean
  running: boolean
  pid?: number
  /** systemd ActiveState or launchd state, for the status line. */
  detail?: string
}

/** The supervisor command, relative to the Box root: the same entry point as `bun run start`. */
export const SUPERVISOR_ARGS = ['--no-env-file', '--no-orphans', '--conditions=@silkweave/box-source', 'apps/server/src/builder/supervisor.ts']

/** One name per checkout: the folder name plus a short hash of its path, so two Boxes never collide. */
export function serviceName(root: string, platform: ServicePlatform): string {
  const slug = basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'box'
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 8)
  return platform === 'systemd' ? `silkweave-box-${slug}-${hash}` : `dev.silkweave.box.${slug}-${hash}`
}

export function serviceSpec(root: string, platform: ServicePlatform, env: { bun?: string; path?: string } = {}): ServiceSpec {
  const bun = env.bun ?? process.execPath
  // The service starts with a bare environment: keep this shell's PATH (git, the PostgreSQL client
  // tools, claude, codex) and make sure the Bun running this command is on it.
  const parts = (env.path ?? process.env.PATH ?? '').split(':').filter(Boolean)
  const bunDir = dirname(bun)
  const path = [...(parts.includes(bunDir) ? [] : [bunDir]), ...parts, ...['/usr/local/bin', '/usr/bin', '/bin'].filter(dir => !parts.includes(dir))].join(':')
  return { root, name: serviceName(root, platform), bun, path, log: join(root, 'data', 'logs', 'service.log') }
}

/** systemd unit values: `%` is a specifier, and arguments with spaces or quotes need quoting. */
const systemdEscape = (value: string): string => value.replace(/%/g, '%%')
const systemdArg = (value: string): string => /[\s"'\\]/.test(value) ? `"${systemdEscape(value).replace(/(["\\])/g, '\\$1')}"` : systemdEscape(value)

export function systemdUnit(spec: ServiceSpec): string {
  return `# Written by box service install. Change it through the Box, not by hand.
[Unit]
Description=Silkweave Box (${systemdEscape(spec.root)})
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${systemdEscape(spec.root)}
Environment=${systemdArg(`PATH=${spec.path}`)}
ExecStart=${[spec.bun, ...SUPERVISOR_ARGS].map(systemdArg).join(' ')}
Restart=on-failure
RestartSec=10
# SIGTERM reaches the supervisor alone, which stops the app and the database in order.
KillMode=mixed
TimeoutStopSec=30
# Output goes to the journal, which rotates it: box service logs reads it.
SyslogIdentifier=silkweave-box

[Install]
WantedBy=default.target
`
}

const xml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function launchdPlist(spec: ServiceSpec): string {
  const args = [spec.bun, ...SUPERVISOR_ARGS].map(arg => `\t\t<string>${xml(arg)}</string>`).join('\n')
  // ProcessType Standard: Background would put the Box, its agents and box verify on efficiency
  // cores with throttled I/O (docs/GOTCHAS.md).
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Written by box service install. Change it through the Box, not by hand. -->
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${xml(spec.name)}</string>
\t<key>ProgramArguments</key>
\t<array>
${args}
\t</array>
\t<key>WorkingDirectory</key>
\t<string>${xml(spec.root)}</string>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>PATH</key>
\t\t<string>${xml(spec.path)}</string>
\t</dict>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<dict>
\t\t<key>SuccessfulExit</key>
\t\t<false/>
\t</dict>
\t<key>ProcessType</key>
\t<string>Standard</string>
\t<key>ThrottleInterval</key>
\t<integer>10</integer>
\t<key>ExitTimeOut</key>
\t<integer>30</integer>
\t<key>StandardOutPath</key>
\t<string>${xml(spec.log)}</string>
\t<key>StandardErrorPath</key>
\t<string>${xml(spec.log)}</string>
</dict>
</plist>
`
}

type Run = (command: string, args: string[], options?: SpawnSyncOptions) => { status: number | null; stdout: string; stderr: string }
const exec: Run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000, ...options })
  return { status: result.error ? null : result.status, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
}

/**
 * Where this host can run the Box as a user service, or why not. Linux needs a reachable systemd
 * user manager (WSL without systemd, containers and minimal hosts have none).
 */
export function servicePlatform(run: Run = exec, platform: NodeJS.Platform = process.platform): { platform: ServicePlatform } | { platform: null; reason: string } {
  if (platform === 'darwin') return { platform: 'launchd' }
  if (platform !== 'linux') return { platform: null, reason: `background services are not supported on ${platform}` }
  const probe = run('systemctl', ['--user', 'show-environment'])
  if (probe.status === 0) return { platform: 'systemd' }
  return { platform: null, reason: 'this Linux has no systemd user manager (systemctl --user does not answer)' }
}

function unitPath(spec: ServiceSpec, platform: ServicePlatform): string {
  return platform === 'systemd'
    ? join(homedir(), '.config', 'systemd', 'user', `${spec.name}.service`)
    : join(homedir(), 'Library', 'LaunchAgents', `${spec.name}.plist`)
}

const uid = (): number => userInfo().uid
const launchdTarget = (spec: ServiceSpec) => `gui/${uid()}/${spec.name}`

export function parseSystemdShow(text: string): ServiceState {
  const fields = Object.fromEntries(text.split('\n').map(line => line.split(/=(.*)/s, 2) as [string, string]).filter(([key]) => key))
  const installed = fields.LoadState === 'loaded'
  const pid = Number(fields.MainPID)
  return { installed, running: fields.ActiveState === 'active', ...(pid > 0 && { pid }), ...(fields.ActiveState && { detail: fields.ActiveState }) }
}

export function parseLaunchdPrint(text: string): Omit<ServiceState, 'installed'> {
  const state = /^\s*state = (.+)$/m.exec(text)?.[1]?.trim()
  const pid = Number(/^\s*pid = (\d+)$/m.exec(text)?.[1])
  return { running: state === 'running', ...(pid > 0 && { pid }), ...(state && { detail: state }) }
}

export function serviceState(spec: ServiceSpec, platform: ServicePlatform, run: Run = exec): ServiceState {
  if (!existsSync(unitPath(spec, platform))) return { installed: false, running: false }
  if (platform === 'systemd') {
    const shown = run('systemctl', ['--user', 'show', `${spec.name}.service`, '-p', 'LoadState,ActiveState,MainPID'])
    return { ...parseSystemdShow(shown.stdout), installed: true }
  }
  const printed = run('launchctl', ['print', launchdTarget(spec)])
  if (printed.status !== 0) return { installed: true, running: false, detail: 'not loaded' }
  return { installed: true, ...parseLaunchdPrint(printed.stdout) }
}

/** The service for this checkout when it is installed and running; `box dev` and `box start` check it. */
export function runningService(root: string): { name: string } | null {
  const host = servicePlatform()
  if (!host.platform) return null
  const spec = serviceSpec(root, host.platform)
  return serviceState(spec, host.platform).running ? { name: spec.name } : null
}

const LOG_LIMIT = 50 * 1024 * 1024

/** launchd appends forever and reopens the file on each start: keep one previous log when it gets big. */
export function rotateLog(log: string, limit = LOG_LIMIT): boolean {
  try {
    if (statSync(log).size < limit) return false
    renameSync(log, `${log}.1`)
    return true
  } catch { return false }
}

/** Wait until the service's process is gone: the supervisor takes a few seconds to stop the app and database. */
async function waitStopped(spec: ServiceSpec, platform: ServicePlatform, run: Run, timeoutMs = 40_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!serviceState(spec, platform, run).running) return true
    await new Promise(next => setTimeout(next, 250))
  }
  return false
}

function must(result: ReturnType<Run>, what: string): void {
  if (result.status !== 0) throw new Error(`${what} failed: ${(result.stderr || result.stdout).trim() || `exit ${result.status}`}`)
}

/**
 * Keep the user manager (and with it the Box) running without a login session: without lingering,
 * systemd stops the Box when the last SSH session ends. Enabling it for oneself may need sudo.
 */
function ensureLinger(run: Run, interactive: boolean): 'already' | 'enabled' | 'failed' {
  const user = userInfo().username
  if (/^Linger=yes$/m.test(run('loginctl', ['show-user', user, '-p', 'Linger']).stdout)) return 'already'
  if (run('loginctl', ['enable-linger', user]).status === 0) return 'enabled'
  if (interactive && run('sudo', ['loginctl', 'enable-linger', user], { stdio: 'inherit', timeout: 120_000 }).status === 0) return 'enabled'
  return 'failed'
}

export interface InstallResult { name: string; platform: ServicePlatform; log: string; linger?: 'already' | 'enabled' | 'failed' }

/** Write (or rewrite) the unit, enable it and (re)start it. Idempotent. */
export async function installService(root: string, options: { interactive?: boolean; run?: Run } = {}): Promise<InstallResult> {
  const run = options.run ?? exec
  const host = servicePlatform(run)
  if (!host.platform) throw new Error(`Cannot run the Box as a service: ${host.reason}. Start it with box start instead.`)
  const spec = serviceSpec(root, host.platform)
  const file = unitPath(spec, host.platform)
  mkdirSync(dirname(file), { recursive: true })
  mkdirSync(dirname(spec.log), { recursive: true })
  if (host.platform === 'systemd') {
    writeFileSync(file, systemdUnit(spec))
    must(run('systemctl', ['--user', 'daemon-reload']), 'systemctl --user daemon-reload')
    must(run('systemctl', ['--user', 'enable', `${spec.name}.service`]), 'systemctl --user enable')
    must(run('systemctl', ['--user', 'restart', `${spec.name}.service`]), 'systemctl --user restart')
    return { name: spec.name, platform: host.platform, log: spec.log, linger: ensureLinger(run, options.interactive ?? false) }
  }
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null
  const next = launchdPlist(spec)
  const loaded = run('launchctl', ['print', launchdTarget(spec)]).status === 0
  if (loaded && before !== next) await bootout(spec, run)
  writeFileSync(file, next)
  rotateLog(spec.log)
  if (!loaded || before !== next) must(run('launchctl', ['bootstrap', `gui/${uid()}`, file]), 'launchctl bootstrap')
  else must(run('launchctl', ['kickstart', '-k', launchdTarget(spec)]), 'launchctl kickstart')
  return { name: spec.name, platform: host.platform, log: spec.log }
}

/** Unload the agent and wait until launchd has let go of it: bootout returns before the job is gone. */
async function bootout(spec: ServiceSpec, run: Run): Promise<void> {
  must(run('launchctl', ['bootout', launchdTarget(spec)], { timeout: 60_000 }), 'launchctl bootout')
  const deadline = Date.now() + 40_000
  while (run('launchctl', ['print', launchdTarget(spec)]).status === 0) {
    if (Date.now() > deadline) throw new Error('launchd did not unload the Box within 40 s')
    await new Promise(next => setTimeout(next, 250))
  }
}

export async function uninstallService(root: string, run: Run = exec): Promise<boolean> {
  const host = servicePlatform(run)
  if (!host.platform) return false
  const spec = serviceSpec(root, host.platform)
  const file = unitPath(spec, host.platform)
  if (!existsSync(file)) return false
  if (host.platform === 'systemd') {
    run('systemctl', ['--user', 'disable', '--now', `${spec.name}.service`], { timeout: 60_000 })
    rmSync(file)
    run('systemctl', ['--user', 'daemon-reload'])
  } else {
    if (run('launchctl', ['print', launchdTarget(spec)]).status === 0) await bootout(spec, run)
    rmSync(file)
  }
  return true
}

async function control(root: string, action: 'start' | 'stop' | 'restart', run: Run = exec): Promise<void> {
  const host = servicePlatform(run)
  if (!host.platform) throw new Error(host.reason)
  const spec = serviceSpec(root, host.platform)
  if (!existsSync(unitPath(spec, host.platform))) throw new Error('This Box is not installed as a service. Run box service install.')
  if (host.platform === 'systemd') {
    // systemctl stop and restart wait for the stop themselves.
    must(run('systemctl', ['--user', action, `${spec.name}.service`], { timeout: 60_000 }), `systemctl --user ${action}`)
    return
  }
  const loaded = run('launchctl', ['print', launchdTarget(spec)]).status === 0
  if (action === 'stop') {
    // A clean exit is not restarted (KeepAlive SuccessfulExit false); the agent loads again at login.
    if (loaded && serviceState(spec, host.platform, run).running) {
      must(run('launchctl', ['kill', 'SIGTERM', launchdTarget(spec)]), 'launchctl kill')
      if (!await waitStopped(spec, host.platform, run)) throw new Error('The Box did not stop within 40 s. See: box service logs')
    }
    return
  }
  rotateLog(spec.log)
  if (!loaded) { must(run('launchctl', ['bootstrap', `gui/${uid()}`, unitPath(spec, host.platform)]), 'launchctl bootstrap'); return }
  must(run('launchctl', ['kickstart', ...(action === 'restart' ? ['-k'] : []), launchdTarget(spec)]), 'launchctl kickstart')
}

/** True once the supervisor reports the application running and the frontend ready (Vite, or a web release). */
export function boxReady(socketPath: string): Promise<boolean> {
  return new Promise(resolve => {
    const req = request({ socketPath, method: 'GET', path: '/app-status', timeout: 2_000 }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => {
        try {
          const state = JSON.parse(text) as { application?: { status?: string }; frontend?: { mode?: string; status?: string } }
          const frontend = state.frontend?.mode === 'dev' ? state.frontend.status === 'running' : state.frontend?.status === 'built'
          resolve(res.statusCode === 200 && state.application?.status === 'running' && frontend)
        } catch { resolve(false) }
      })
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
    req.end()
  })
}

/**
 * Wait for the service's Box to be ready, with a spinner on a terminal. Stops early when the service
 * stops running (a crash loop shows in the log). The first start builds the web app, so allow minutes.
 */
export async function waitForService(root: string, options: { timeoutMs?: number; label?: string } = {}): Promise<'ready' | 'stopped' | 'timeout'> {
  const socket = join(root, 'data', 'builder', 'ui-refresh.sock')
  const host = servicePlatform()
  const spec = host.platform ? serviceSpec(root, host.platform) : null
  const deadline = Date.now() + (options.timeoutMs ?? 10 * 60_000)
  const started = Date.now()
  const frames = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  const tty = process.stdout.isTTY
  let tick = 0
  let misses = 0
  const clear = () => { if (tty) process.stdout.write('\r\x1b[K') }
  try {
    while (Date.now() < deadline) {
      if (await boxReady(socket)) return 'ready'
      // Restart=on-failure brings a crashed supervisor back after 10 s: give up only when it stays down.
      misses = spec && host.platform && !serviceState(spec, host.platform).running ? misses + 1 : 0
      if (misses >= 15) return 'stopped'
      for (let i = 0; i < 10; i++) {
        if (tty) process.stdout.write(`\r\x1b[K  ${frames[tick++ % 10]} ${options.label ?? 'Starting the Box'} ${Math.round((Date.now() - started) / 1000)}s`)
        await new Promise(next => setTimeout(next, 100))
      }
    }
    return 'timeout'
  } finally { clear() }
}

function showLogs(root: string, follow: boolean): number {
  const host = servicePlatform()
  if (host.platform === 'systemd') {
    const name = serviceName(root, 'systemd')
    return spawnSync('journalctl', ['--user', '-u', `${name}.service`, '-n', '200', '-o', 'cat', '--no-pager', ...(follow ? ['-f'] : [])], { stdio: 'inherit' }).status ?? 0
  }
  const log = join(root, 'data', 'logs', 'service.log')
  if (!existsSync(log)) { commandLine(`No service log yet (${log}).`, 'muted'); return 0 }
  return spawnSync('tail', ['-n', '200', ...(follow ? ['-F'] : []), log], { stdio: 'inherit' }).status ?? 0
}

const USAGE = 'Expected: box service install, uninstall, start, stop, restart, status, or logs [-f]'

async function main(argv: string[]): Promise<number> {
  const [action, ...rest] = argv
  const root = repoRoot
  if (action === 'logs') return showLogs(root, rest.includes('-f') || rest.includes('--follow'))
  commandHeader(`service${action ? ` / ${action}` : ''}`)
  const host = servicePlatform()
  if (action === 'status' || !action) {
    if (!host.platform) { commandLine(`Not available here: ${host.reason}.`, 'muted'); return 0 }
    const spec = serviceSpec(root, host.platform)
    const state = serviceState(spec, host.platform)
    if (!state.installed) { commandLine('This Box is not installed as a service. Install it with: box service install', 'muted'); return 0 }
    const line = `${spec.name} (${host.platform}): ${state.running ? 'running' : state.detail ?? 'stopped'}${state.pid ? `, pid ${state.pid}` : ''}`
    if (state.running) commandSuccess(line); else commandWarning(line)
    commandLine(`What it printed: box service logs${host.platform === 'launchd' ? ` (${spec.log})` : ''}`, 'muted')
    return state.running ? 0 : 3
  }
  if (action === 'install') {
    const result = await installService(root, { interactive: Boolean(process.stdin.isTTY) })
    commandSuccess(`Installed ${result.name} (${result.platform}) and started it`)
    if (result.linger === 'failed') commandWarning(`It stops when you log out. To keep it running, run: sudo loginctl enable-linger ${userInfo().username}`)
    const outcome = await waitForService(root)
    if (outcome === 'ready') commandSuccess('The Box is running')
    else commandWarning(outcome === 'stopped' ? 'The service stopped. See: box service logs' : 'The Box is still starting. Check with: box service status')
    return outcome === 'ready' ? 0 : 1
  }
  if (action === 'uninstall') {
    if (await uninstallService(root)) commandSuccess('Stopped the service and removed it')
    else commandLine('This Box is not installed as a service.', 'muted')
    return 0
  }
  if (action === 'start' || action === 'stop' || action === 'restart') {
    await control(root, action)
    commandSuccess(action === 'stop' ? 'Stopped' : action === 'start' ? 'Started' : 'Restarted')
    if (action !== 'stop') {
      const outcome = await waitForService(root)
      if (outcome !== 'ready') { commandWarning(outcome === 'stopped' ? 'The service stopped. See: box service logs' : 'Still starting. Check with: box service status'); return 1 }
      commandSuccess('The Box is running')
    }
    return 0
  }
  commandError(USAGE)
  commandValue('box service status')
  return 2
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
    commandError(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
