import { request } from 'node:http'
import { join } from 'node:path'
import { repoRoot } from './repo.ts'
import { commandError, commandHeader, commandSuccess } from './command-ui.ts'

const socketPath = join(repoRoot, 'data', 'builder', 'ui-refresh.sock')
const req = request({ socketPath, method: 'POST', path: '/refresh-ui' }, res => {
  let text = ''
  res.setEncoding('utf8')
  res.on('data', chunk => { text += chunk })
  res.on('end', () => {
    try {
      const result = JSON.parse(text) as { message?: string }
      if (res.statusCode !== 200) { commandError(result.message ?? 'Builder UI refresh failed'); process.exitCode = 1 }
      else { commandHeader('builder refresh'); commandSuccess(result.message ?? 'Builder UI refreshed') }
    } catch { commandError('Invalid response from Builder supervisor'); process.exitCode = 1 }
  })
})
req.on('error', () => {
  commandError('Cannot reach the local Builder supervisor. Start or restart box dev with UI refresh support first.')
  process.exitCode = 1
})
req.end()
