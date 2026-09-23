import { chmodSync, existsSync, lstatSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

/** A host-local capability: filesystem access to the owner's 0600 socket permits UI refresh only. */
export async function startBuilderLocalControl(instance: string, refresh: () => Promise<void>) {
  const path = join(instance, 'builder', 'ui-refresh.sock')
  if (existsSync(path)) {
    if (!lstatSync(path).isSocket()) throw new Error('Builder refresh socket path is occupied by a non-socket file')
    unlinkSync(path)
  }
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.method !== 'POST' || req.url !== '/refresh-ui') { res.writeHead(404); res.end('{}'); return }
    req.resume()
    void refresh().then(() => {
      res.end(JSON.stringify({ ok: true, message: 'Builder updated. Reload the Builder page; the session is still running.' }))
    }, error => {
      res.writeHead(500)
      res.end(JSON.stringify({ message: error instanceof Error ? error.message : 'Builder UI refresh failed' }))
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
