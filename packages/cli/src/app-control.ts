import { request } from 'node:http'
import { join } from 'node:path'
import { commandError, commandHeader, commandSuccess, commandWarning } from './command-ui.ts'
import { isMain, repoRoot } from './repo.ts'

type ApplicationStatus = { status: 'starting' | 'running' | 'stopped' | 'failed'; message?: string }
type ControlResult = { ok?: boolean; message?: string; application?: ApplicationStatus }

const socketPath = join(repoRoot, 'data', 'builder', 'ui-refresh.sock')

export function requestApplicationControl(socket: string, action: 'status' | 'restart'): Promise<ControlResult> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: socket, method: action === 'status' ? 'GET' : 'POST', path: action === 'status' ? '/app-status' : '/app-restart' }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => {
        let result: ControlResult
        try { result = JSON.parse(text) as ControlResult }
        catch { reject(new Error('Invalid response from the Box supervisor')); return }
        if (res.statusCode === 404) {
          reject(new Error('The running supervisor does not support application control yet. Ask the host operator to restart box dev once to load the updated supervisor.'))
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

async function main(args: string[]): Promise<void> {
  const [action, ...rest] = args
  if ((action !== 'status' && action !== 'restart') || rest.length) {
    commandError('Expected: box app status or box app restart')
    process.exitCode = 2
    return
  }
  try {
    const result = await requestApplicationControl(socketPath, action)
    const status = result.application?.status
    commandHeader(`app ${action}`)
    if (action === 'restart') commandSuccess(result.message ?? 'Application restarted; supervisor preserved')
    else if (status === 'running') commandSuccess('Application is running under the stable supervisor')
    else commandWarning(`Application is ${status ?? 'in an unknown state'}${result.application?.message ? `: ${result.application.message}` : ''}`)
  } catch (error) {
    commandError(error instanceof Error ? error.message : 'Box application control failed')
    process.exitCode = 1
  }
}

if (isMain(import.meta.url)) void main(process.argv.slice(2))
