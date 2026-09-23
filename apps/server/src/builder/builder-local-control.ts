import { chmodSync, existsSync, lstatSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { SupervisedApplicationStatus } from './supervised-application.js'

export interface BuilderLocalControls {
  status: () => SupervisedApplicationStatus
  restart: () => Promise<SupervisedApplicationStatus>
  refresh: () => Promise<void>
}

/** Historical filename retained so a newly updated CLI can still refresh an older supervisor. */
export const builderLocalControlPath = (instance: string): string => join(instance, 'builder', 'ui-refresh.sock')

/** A bounded host-local capability: status, editable-app restart, and Builder UI refresh only. */
export async function startBuilderLocalControl(instance: string, controls: BuilderLocalControls) {
  const path = builderLocalControlPath(instance)
  if (existsSync(path)) {
    if (!lstatSync(path).isSocket()) throw new Error('Builder local control socket path is occupied by a non-socket file')
    unlinkSync(path)
  }
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET' && req.url === '/app-status') {
      res.end(JSON.stringify({ ok: true, application: controls.status() }))
      return
    }
    const operation = req.method === 'POST' && req.url === '/app-restart'
      ? controls.restart
      : req.method === 'POST' && req.url === '/refresh-ui'
        ? controls.refresh
        : undefined
    if (!operation) { res.writeHead(404); res.end(JSON.stringify({ message: 'Unknown local supervisor control' })); return }
    req.resume()
    void operation().then(result => {
      if (req.url === '/app-restart') {
        res.end(JSON.stringify({ ok: true, application: result, message: 'Application restarted. The supervisor and Builder session stayed running.' }))
      } else {
        res.end(JSON.stringify({ ok: true, message: 'Builder updated. Reload the Builder page; the session is still running.' }))
      }
    }, error => {
      res.writeHead(500)
      res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Local supervisor operation failed' }))
    })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, () => { chmodSync(path, 0o600); resolve() }) })
  return async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeAllConnections()
    })
  }
}
