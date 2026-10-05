import { chmodSync, existsSync, lstatSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { SupervisedApplicationStatus, SupervisedFrontendStatus } from './supervised-application.js'

export interface BuilderLocalControls {
  status: () => SupervisedApplicationStatus
  frontend: () => Promise<SupervisedFrontendStatus>
  restart: () => Promise<SupervisedApplicationStatus>
  restartFrontend: () => Promise<SupervisedFrontendStatus>
  refresh: () => Promise<void>
  /** Typecheck, build and publish the web release everyone outside Builder loads (built mode). */
  promote?: () => Promise<{ version: string; createdAt: string; sourceSha: string | null; dirty: boolean }>
}

const failureStatus = (error: unknown): number => {
  const code = (error as { statusCode?: unknown } | null)?.statusCode
  return typeof code === 'number' && code >= 400 && code < 600 ? code : 500
}

/** Historical filename retained so a newly updated CLI can still refresh an older supervisor. */
export const builderLocalControlPath = (instance: string): string => join(instance, 'builder', 'ui-refresh.sock')

/** A bounded host-local capability: status, editable-app and frontend restart, web promote and Builder UI refresh only. */
export async function startBuilderLocalControl(instance: string, controls: BuilderLocalControls) {
  const path = builderLocalControlPath(instance)
  if (existsSync(path)) {
    if (!lstatSync(path).isSocket()) throw new Error('Builder local control socket path is occupied by a non-socket file')
    unlinkSync(path)
  }
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET' && req.url === '/app-status') {
      const application = controls.status()
      void controls.frontend().then(
        frontend => res.end(JSON.stringify({ ok: true, application, frontend })),
        () => res.end(JSON.stringify({ ok: true, application })),
      )
      return
    }
    const operation: (() => Promise<unknown>) | undefined = req.method === 'POST' && req.url === '/app-restart'
      ? controls.restart
      : req.method === 'POST' && req.url === '/frontend-restart'
        ? controls.restartFrontend
        : req.method === 'POST' && req.url === '/refresh-ui'
          ? controls.refresh
          : req.method === 'POST' && req.url === '/web-promote'
            ? controls.promote
            : undefined
    if (!operation) { res.writeHead(404); res.end(JSON.stringify({ message: 'Unknown local supervisor control' })); return }
    req.resume()
    void operation().then(result => {
      if (req.url === '/app-restart') {
        res.end(JSON.stringify({ ok: true, application: result, message: 'Application restarted. The supervisor and Builder session stayed running.' }))
      } else if (req.url === '/web-promote') {
        res.end(JSON.stringify({ ok: true, release: result, message: 'Web release promoted. Open tabs outside Builder are offered a reload.' }))
      } else if (req.url === '/frontend-restart') {
        res.end(JSON.stringify({ ok: true, frontend: result, message: 'Frontend dev server restarted. Reload the preview; the application and Builder session stayed running.' }))
      } else {
        res.end(JSON.stringify({ ok: true, message: 'Builder updated. Reload the Builder page; the session is still running.' }))
      }
    }, error => {
      res.writeHead(failureStatus(error))
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
