import { chmodSync, existsSync, lstatSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { json, readJson } from './builder-gateway.js'

/** Host-owner transport. The active browser grant and session are still required for every call. */
export async function startBuilderBrowserLocal(instance: string, browser: {
  execute(sessionId: string, command: unknown): Promise<unknown>
  revoke(reason: string): void
}): Promise<() => Promise<void>> {
  const path = join(instance, 'builder', 'browser.sock')
  if (existsSync(path)) {
    if (!lstatSync(path).isSocket()) throw new Error('Builder browser socket path is occupied by a non-socket file')
    unlinkSync(path)
  }
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/execute') { req.resume(); json(res, 404, { message: 'Unknown browser command endpoint' }); return }
    let executing = false
    res.once('close', () => { if (executing && !res.writableFinished) browser.revoke('Agent command disconnected') })
    void (async () => {
      const body = await readJson(req)
      if (typeof body.sessionId !== 'string' || !body.sessionId || body.sessionId.length > 200) throw new Error('Expected the Builder session id')
      executing = true
      const result = await browser.execute(body.sessionId, body.command)
      if (!res.destroyed) json(res, 200, result)
    })().catch(error => {
      if (!res.destroyed) json(res, 409, { message: error instanceof Error ? error.message : 'Browser operation failed' })
    }).finally(() => { executing = false })
  })
  await new Promise<void>((done, reject) => {
    server.once('error', reject)
    server.listen(path, () => { chmodSync(path, 0o600); done() })
  })
  return async () => {
    await new Promise<void>((done, reject) => {
      server.close(error => error ? reject(error) : done())
      server.closeAllConnections()
    })
  }
}
