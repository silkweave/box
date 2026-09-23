import { request } from 'node:http'
import { chmodSync, existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { repoRoot, isMain } from './repo.ts'

const MAX_RESPONSE_BYTES = 6 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 20_000
const socketPath = join(repoRoot, 'data', 'builder', 'browser.sock')

const HELP = `box builder browser - control the Builder's local browser session

Usage:
  box builder browser --session <session-id> <operation> [JSON object]

The session id is required for every command. The optional JSON object contains
the fields for the selected operation. Quote it for your shell, for example:

  box builder browser --session abc123 snapshot
  box builder browser --session abc123 inspect '{"ref":"e12"}'
  box builder browser --session abc123 type '{"ref":"e12","text":"hello","append":true}'
  box builder browser --session abc123 navigate '{"path":"/signals"}'
  box builder browser --session abc123 screenshot

Operations and fields:
  snapshot                         no fields
  inspect                          ref (string)
  click                            ref (string)
  type                             ref (string), text (string), append (boolean, optional)
  select                           ref (string), value (string)
  scroll                           x (number), y (number), ref (string, optional)
  navigate                         path (string)
  style                            ref (string), styles (object of string values, optional)
  screenshot                       ref (string, optional)

Screenshot results are saved as PNG files in <repo>/_docs/browser and the
returned image.dataUrl is replaced with the saved absolute path.
`

type BrowserOperation = 'snapshot' | 'inspect' | 'click' | 'type' | 'select' | 'scroll' | 'navigate' | 'style' | 'screenshot'

const operations = new Set<BrowserOperation>([
  'snapshot', 'inspect', 'click', 'type', 'select', 'scroll', 'navigate', 'style', 'screenshot',
])

function fail(message: string): never {
  throw new Error(message)
}

function parseArgs(argv: string[]): { sessionId: string; operation: BrowserOperation; params: Record<string, unknown> } | null {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return null
  let sessionId: string | undefined
  const positionals: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--session') {
      const value = argv[++index]
      if (!value || value.startsWith('--')) fail('Expected a session id after --session')
      sessionId = value
    } else if (arg.startsWith('--session=')) {
      const value = arg.slice('--session='.length)
      if (!value) fail('Expected a session id after --session=')
      sessionId = value
    } else {
      positionals.push(arg)
    }
  }
  if (!sessionId) fail('A session id is required. Use --session <session-id>')
  if (sessionId.length > 200 || sessionId.includes('\0')) fail('Invalid session id')
  const operation = positionals.shift()
  if (!operation || !operations.has(operation as BrowserOperation)) {
    fail(`Unknown or missing browser operation${operation ? `: ${operation}` : ''}`)
  }
  if (positionals.length > 1) fail('Expected one optional JSON object after the operation')
  const params: Record<string, unknown> = {}
  if (positionals.length === 1) {
    let parsed: unknown
    try { parsed = JSON.parse(positionals[0] as string) }
    catch { fail('The operation fields must be valid UTF-8 JSON') }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('The operation fields must be a JSON object')
    Object.assign(params, parsed)
  }
  return { sessionId, operation: operation as BrowserOperation, params }
}

function readResponse(socket: string, body: string): Promise<unknown> {
  return new Promise((resolveResponse, reject) => {
    const encoded = Buffer.byteLength(body, 'utf8')
    if (encoded > MAX_RESPONSE_BYTES) { reject(new Error('Builder browser response exceeded the 6 MiB limit')); return }
    const req = request({
      socketPath: socket,
      method: 'POST',
      path: '/execute',
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body, 'utf8') },
    }, res => {
      let response = ''
      let responseBytes = 0
      res.setEncoding('utf8')
      res.on('error', error => req.destroy(error))
      res.on('aborted', () => req.destroy(new Error('Builder browser response was aborted')))
      res.on('data', (chunk: string) => {
        responseBytes += Buffer.byteLength(chunk, 'utf8')
        if (responseBytes > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('Builder browser response exceeded the 6 MiB limit'))
          return
        }
        response += chunk
      })
      res.on('end', () => {
        let parsed: unknown
        try { parsed = JSON.parse(response) }
        catch { reject(new Error(`Builder browser returned invalid JSON (HTTP ${res.statusCode ?? 'unknown'})`)); return }
        if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
          const value = parsed as { message?: unknown; error?: unknown }
          const message = typeof value?.message === 'string' ? value.message : typeof value?.error === 'string' ? value.error : `HTTP ${res.statusCode ?? 'unknown'}`
          reject(new Error(message)); return
        }
        resolveResponse(parsed)
      })
    })
    const timeout = setTimeout(() => req.destroy(new Error('Builder browser request timed out after 20 seconds')), REQUEST_TIMEOUT_MS)
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('Builder browser request timed out after 20 seconds')))
    req.on('error', error => {
      clearTimeout(timeout)
      const message = error instanceof Error ? error.message : String(error)
      if (/ENOENT|ECONNREFUSED|EPIPE|socket hang up/i.test(message)) {
        reject(new Error('Cannot reach the local Builder browser control. Start `box dev` first.'))
      } else reject(new Error(message))
    })
    req.on('close', () => clearTimeout(timeout))
    req.end(body)
  })
}

function browserOutputRoot(rootDir = repoRoot): string {
  const root = realpathSync(rootDir)
  const docs = join(root, '_docs')
  const browser = join(docs, 'browser')
  for (const [path, label] of [[docs, '_docs'], [browser, '_docs/browser']] as const) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) fail(`Refusing to write screenshots through the ${label} symlink`)
  }
  mkdirSync(browser, { recursive: true, mode: 0o700 })
  const realBrowser = realpathSync(browser)
  const outside = relative(root, realBrowser)
  if (outside.startsWith('..')) {
    fail('Refusing to write screenshots outside the repository')
  }
  return realBrowser
}

function saveScreenshot(dataUrl: string, rootDir = repoRoot): string {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl)
  if (!match) fail('Builder browser returned an invalid PNG data URL')
  const data = Buffer.from(match[1] as string, 'base64')
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (data.length < pngSignature.length || data.length > MAX_RESPONSE_BYTES || !pngSignature.every((byte, index) => data[index] === byte)) {
    fail('Builder browser returned an invalid PNG image')
  }
  const path = join(browserOutputRoot(rootDir), `${randomUUID()}.png`)
  writeFileSync(path, data, { flag: 'wx', mode: 0o600 })
  chmodSync(path, 0o600)
  return path
}

function replaceImages(value: unknown, rootDir = repoRoot): unknown {
  if (Array.isArray(value)) return value.map(item => replaceImages(item, rootDir))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (record.image && typeof record.image === 'object' && !Array.isArray(record.image)) {
    const image = record.image as Record<string, unknown>
    if (typeof image.dataUrl === 'string') {
      const { dataUrl, ...metadata } = image
      return { ...record, image: { ...metadata, path: saveScreenshot(dataUrl, rootDir) } }
    }
  }
  return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, replaceImages(child, rootDir)]))
}

async function main(argv: string[]): Promise<void> {
  try {
    const args = parseArgs(argv)
    if (!args) { process.stdout.write(HELP); return }
    const command = { ...args.params, op: args.operation }
    const result = await readResponse(socketPath, JSON.stringify({ sessionId: args.sessionId, command }))
    const output = replaceImages(result)
    const serialized = JSON.stringify(output)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_RESPONSE_BYTES) fail('Builder browser result exceeded the 6 MiB limit')
    process.stdout.write(`${serialized}\n`)
  } catch (error) {
    console.error(`[box] Builder browser: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (isMain(import.meta.url)) void main(process.argv.slice(2))

export { HELP, main, parseArgs, readResponse, replaceImages }
