import { request } from 'node:http'
import { join } from 'node:path'
import { repoRoot } from './repo.ts'

// `box builder tasks|ready --session <id> <JSON>`: the Builder agent tells the owner's Builder shell
// its task plan (pinned above the conversation with progress and time) or that the work is ready to
// wrap up (a card with a Wrap Up button and the proposed commit message). Host-local only: it goes
// over the supervisor's local control socket and is accepted for the open session only.

const HELP = `box builder tasks|ready - report to the owner's Builder shell

Usage:
  box builder tasks --session <session-id> '<JSON object>'
  box builder ready --session <session-id> '<JSON object>'

tasks: the plan, re-sent whole whenever a task starts or finishes. Builder pins it
above the conversation with progress, time elapsed and time remaining.
  {"tasks":[{"title":"Fetch the recipe","status":"done","estimateMinutes":2},
            {"title":"Build the list page","status":"running","estimateMinutes":10},
            {"title":"Run box verify","status":"pending","estimateMinutes":8}]}
  status: pending | running | done. estimateMinutes: your estimate at session pace.

ready: the work is done and the owner should try it and wrap up. Builder shows a
card with a Wrap Up button; commitMessage fills Wrap Up's commit message.
  {"summary":"Artifacts is adapted and every check passes.",
   "built":["Artifacts gallery at /artifacts","Welcome page"],
   "try":["Open Artifacts in the sidebar","Open the welcome page"],
   "open":["Public sharing needs a Cloudflare account"],
   "commitMessage":"feat(artifacts): adapt the Artifacts recipe"}
  summary is required; built, try and open are lists of short lines.
`

const kinds = new Set(['tasks', 'ready'])

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const argv = process.argv.slice(2)
if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
  console.log(HELP)
  process.exit(argv.length === 0 ? 1 : 0)
}
const kind = argv[0]!
if (!kinds.has(kind)) fail(`Unknown report: ${kind}. Expected tasks or ready.`)
let sessionId: string | undefined
const positionals: string[] = []
for (let index = 1; index < argv.length; index += 1) {
  const arg = argv[index]!
  if (arg === '--session') sessionId = argv[++index]
  else if (arg.startsWith('--session=')) sessionId = arg.slice('--session='.length)
  else positionals.push(arg)
}
if (!sessionId || sessionId.startsWith('--')) fail('A session id is required. Use --session <session-id>')
if (positionals.length !== 1) fail('Expected one JSON object after the options')
let payload: unknown
try { payload = JSON.parse(positionals[0]!) } catch { fail('The report must be valid JSON') }

const body = JSON.stringify({ sessionId, kind, payload })
const req = request({
  socketPath: join(repoRoot, 'data', 'builder', 'ui-refresh.sock'),
  method: 'POST',
  path: '/session-report',
  headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body, 'utf8') },
}, res => {
  let text = ''
  res.setEncoding('utf8')
  res.on('data', chunk => { text += chunk })
  res.on('end', () => {
    let result: { message?: string } = {}
    try { result = JSON.parse(text) as typeof result } catch { fail('Invalid response from the Builder supervisor') }
    if (res.statusCode !== 200) fail(result.message ?? `Builder ${kind} report failed`)
    console.log(kind === 'tasks' ? 'Task plan shown in Builder.' : 'Ready card shown in Builder.')
  })
})
req.setTimeout(10_000, () => req.destroy(new Error('timed out')))
req.on('error', () => fail('Cannot reach the local Builder supervisor. Is box dev or the Box service running?'))
req.end(body)
