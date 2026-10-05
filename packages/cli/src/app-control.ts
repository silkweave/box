import { request } from 'node:http'
import { join } from 'node:path'
import { commandError, commandHeader, commandLine, commandSuccess, commandWarning } from './command-ui.ts'
import { isMain, repoRoot } from './repo.ts'

type ApplicationStatus = { status: 'starting' | 'running' | 'stopped' | 'failed'; message?: string }
export type FrontendStatus =
  | { mode: 'dev'; server: 'vite'; status: 'running' | 'stopped' | 'failed'; port: number; message?: string }
  | {
      mode: 'built'; server: 'release'; status: 'built' | 'missing'; path: string; builtAt?: string
      version?: string; sourceSha?: string | null; dirty?: boolean
      preview: { status: 'running' | 'stopped' | 'failed'; port: number; message?: string }
    }
type WebRelease = { version: string; createdAt: string; sourceSha: string | null; dirty: boolean }
type ControlResult = { ok?: boolean; message?: string; application?: ApplicationStatus; frontend?: FrontendStatus; release?: WebRelease }
export type ControlAction = 'status' | 'restart' | 'restart-frontend' | 'promote'

const socketPath = join(repoRoot, 'data', 'builder', 'ui-refresh.sock')
const endpoints: Record<ControlAction, { method: 'GET' | 'POST'; path: string }> = {
  status: { method: 'GET', path: '/app-status' },
  restart: { method: 'POST', path: '/app-restart' },
  'restart-frontend': { method: 'POST', path: '/frontend-restart' },
  promote: { method: 'POST', path: '/web-promote' },
}
const USAGE = 'Expected: box app status [--json], box app restart, box app restart --frontend, or box app promote'

export function requestApplicationControl(socket: string, action: ControlAction): Promise<ControlResult> {
  const { method, path } = endpoints[action]
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: socket, method, path }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => {
        let result: ControlResult
        try { result = JSON.parse(text) as ControlResult }
        catch { reject(new Error('Invalid response from the Box supervisor')); return }
        if (res.statusCode === 404) {
          reject(new Error('The running supervisor does not support this control yet. Ask the host operator to restart the Box once to load the updated supervisor.'))
          return
        }
        if (res.statusCode !== 200) { reject(new Error(result.message ?? 'Box application control failed')); return }
        resolve(result)
      })
    })
    req.on('error', () => reject(new Error('Cannot reach the stable Box supervisor. Do not start a second Box or stop box dev; ask the host operator to restore it.')))
    req.end()
  })
}

/** The facts an agent needs before choosing between an app restart, a frontend restart and a rebuild. */
export function describeFrontend(frontend: FrontendStatus | undefined): { healthy: boolean; lines: string[] } {
  if (!frontend) {
    return { healthy: false, lines: ['Frontend state unknown: the running supervisor predates frontend status. Ask the host operator to restart the Box once.'] }
  }
  if (frontend.mode === 'dev') {
    const mode = `Mode: dev (box dev); the frontend is Vite on port ${frontend.port}`
    if (frontend.status === 'running') return { healthy: true, lines: [mode, 'Frontend is running. Source edits hot-reload; box app restart --frontend restarts Vite'] }
    const state = frontend.status === 'failed' ? 'Frontend failed' : 'Frontend is stopped'
    return { healthy: false, lines: [mode, `${state}${frontend.message ? `: ${frontend.message}` : ''}. Run box app restart --frontend`] }
  }
  const release = frontend.version
    ? `release ${frontend.version.slice(0, 8)}${frontend.sourceSha ? ` from ${frontend.sourceSha.slice(0, 12)}${frontend.dirty ? ' with uncommitted changes' : ''}` : ''}`
    : `the bundle in ${frontend.path.replace(/[/\\]index\.html$/, '')} (no release promoted yet)`
  const mode = `Mode: built (box start); everyone outside Builder loads ${release}`
  const preview = frontend.preview.status === 'running'
    ? `Builder Preview runs Vite on port ${frontend.preview.port}: web edits hot-reload there only. box app promote publishes them to everyone`
    : frontend.preview.status === 'failed'
      ? `Builder Preview Vite failed${frontend.preview.message ? `: ${frontend.preview.message}` : ''}. Run box app restart --frontend`
      : 'No Builder Preview Vite (it runs only during a Builder session). box app promote publishes web changes to everyone'
  if (frontend.status === 'built') {
    return { healthy: frontend.preview.status !== 'failed', lines: [mode, `Frontend built ${frontend.builtAt ?? 'at an unknown time'}`, preview] }
  }
  return { healthy: false, lines: [mode, 'Frontend bundle is missing. Run box app promote', preview] }
}

export function parseAppArgs(args: string[]): { action: ControlAction; json: boolean } | undefined {
  const [verb, ...flags] = args
  const json = flags.includes('--json')
  const frontend = flags.includes('--frontend')
  if (flags.some(flag => flag !== '--json' && flag !== '--frontend')) return undefined
  if (verb === 'status' && !frontend) return { action: 'status', json }
  if (verb === 'restart') return { action: frontend ? 'restart-frontend' : 'restart', json }
  if (verb === 'promote' && !frontend) return { action: 'promote', json }
  return undefined
}

async function main(args: string[]): Promise<void> {
  const parsed = parseAppArgs(args)
  if (!parsed) {
    commandError(USAGE)
    process.exitCode = 2
    return
  }
  const { action, json } = parsed
  try {
    const result = await requestApplicationControl(socketPath, action)
    if (json) { process.stdout.write(`${JSON.stringify(result)}\n`); return }
    commandHeader(action === 'restart-frontend' ? 'app restart --frontend' : `app ${action}`)
    if (action === 'restart') { commandSuccess(result.message ?? 'Application restarted; supervisor preserved'); return }
    if (action === 'restart-frontend') { commandSuccess(result.message ?? 'Frontend restarted; application and supervisor preserved'); return }
    if (action === 'promote') { commandSuccess(`${result.message ?? 'Web release promoted'}${result.release ? ` (${result.release.version.slice(0, 8)})` : ''}`); return }
    const status = result.application?.status
    if (status === 'running') commandSuccess('Application is running under the stable supervisor')
    else commandWarning(`Application is ${status ?? 'in an unknown state'}${result.application?.message ? `: ${result.application.message}` : ''}`)
    const { healthy, lines } = describeFrontend(result.frontend)
    const [mode, ...rest] = lines
    if (rest.length) commandLine(mode!, 'muted')
    for (const line of rest.length ? rest : lines) (healthy ? commandSuccess : commandWarning)(line)
  } catch (error) {
    commandError(error instanceof Error ? error.message : 'Box application control failed')
    process.exitCode = 1
  }
}

if (isMain(import.meta.url)) void main(process.argv.slice(2))
