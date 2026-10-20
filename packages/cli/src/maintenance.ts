import { request } from 'node:http'
import { join } from 'node:path'
import { commandError, commandHeader, commandLine, commandSuccess, commandWarning } from './command-ui.ts'
import { isMain, repoRoot } from './repo.ts'

type TaskState = 'pending' | 'active' | 'done' | 'skipped'
type Maintenance = {
  enabled: boolean; lockAdmins: boolean; status: string; tasks: Array<{ id: string; label: string; state: TaskState }>
  eta: string | null; startedAt: string | null; updatedAt: string; updatedBy: string | null
}
type Patch = {
  enabled?: boolean; lockAdmins?: boolean; status?: string; eta?: string | null
  tasks?: Array<{ label: string }>
  task?: { op: 'add'; label: string } | { op: 'start' | 'done' | 'skip' | 'pending' | 'remove'; ref: string }
  by?: string
}

const socketPath = join(repoRoot, 'data', 'builder', 'ui-refresh.sock')

export const USAGE = `Expected one of:
  box maintenance [show] [--json]
  box maintenance on [--lock-admins] [--status "<text>"] [--eta <when>] [--task "<label>"]... [--by <name>]
  box maintenance off
  box maintenance lock-admins|unlock-admins
  box maintenance note "<text>" [--eta <when>]
  box maintenance eta <when>|none
  box maintenance tasks "<label>" "<label>"... [--eta <when>]
  box maintenance task add "<label>" [--eta <when>]
  box maintenance task start|done|skip|pending|remove <number|id> [--eta <when>]
<when>: 20m, 1h30m, 14:30 (today or tomorrow, local time) or an ISO 8601 time`

/** A relative duration, a local clock time (the next one) or an ISO time, as an ISO string. */
export function parseWhen(value: string, now = new Date()): string | null {
  if (value === 'none') return null
  const duration = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(value)
  if (duration && (duration[1] || duration[2])) return new Date(now.getTime() + ((Number(duration[1] ?? 0) * 60) + Number(duration[2] ?? 0)) * 60_000).toISOString()
  const clock = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (clock) {
    const at = new Date(now)
    at.setHours(Number(clock[1]), Number(clock[2]), 0, 0)
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
    return at.toISOString()
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString()
  throw new Error(`Cannot read "${value}" as a time: use 20m, 1h30m, 14:30 or an ISO time`)
}

/** The command line as one change, so a task tick and a revised estimate land together. */
export function parseMaintenanceArgs(args: string[], now = new Date()): { action: 'show' | 'change'; patch: Patch; json: boolean } {
  const json = args.includes('--json')
  const positional: string[] = []
  const tasks: string[] = []
  const patch: Patch = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    const value = (): string => { const next = args[++i]; if (next === undefined) throw new Error(`${arg} needs a value`); return next }
    if (arg === '--json') continue
    else if (arg === '--eta') patch.eta = parseWhen(value(), now)
    else if (arg === '--status') patch.status = value()
    else if (arg === '--task') tasks.push(value())
    else if (arg === '--by') patch.by = value()
    else if (arg === '--lock-admins') patch.lockAdmins = true
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`)
    else positional.push(arg)
  }
  const [verb = 'show', ...rest] = positional
  if (verb === 'show' && !rest.length) return { action: 'show', patch, json }
  if (verb === 'on' && !rest.length) return { action: 'change', patch: { ...patch, enabled: true, ...(tasks.length && { tasks: tasks.map(label => ({ label })) }) }, json }
  if (tasks.length) throw new Error('--task belongs to box maintenance on')
  if (patch.lockAdmins) throw new Error('--lock-admins belongs to box maintenance on; use box maintenance lock-admins')
  if (verb === 'lock-admins' && !rest.length) return { action: 'change', patch: { ...patch, lockAdmins: true }, json }
  if (verb === 'unlock-admins' && !rest.length) return { action: 'change', patch: { ...patch, lockAdmins: false }, json }
  if (verb === 'off' && !rest.length) return { action: 'change', patch: { enabled: false, ...(patch.by && { by: patch.by }) }, json }
  if (verb === 'note' && rest.length === 1) return { action: 'change', patch: { ...patch, status: rest[0]! }, json }
  if (verb === 'eta' && rest.length === 1) return { action: 'change', patch: { ...patch, eta: parseWhen(rest[0]!, now) }, json }
  if (verb === 'tasks' && rest.length) return { action: 'change', patch: { ...patch, tasks: rest.map(label => ({ label })) }, json }
  if (verb === 'task' && rest[0] === 'add' && rest.length === 2) return { action: 'change', patch: { ...patch, task: { op: 'add', label: rest[1]! } }, json }
  if (verb === 'task' && rest.length === 2 && ['start', 'done', 'skip', 'pending', 'remove'].includes(rest[0]!)) {
    return { action: 'change', patch: { ...patch, task: { op: rest[0] as 'start', ref: rest[1]! } }, json }
  }
  throw new Error(USAGE)
}

function call(method: 'GET' | 'POST', patch?: Patch): Promise<Maintenance> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method, path: '/maintenance', headers: { 'content-type': 'application/json' } }, res => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { text += chunk })
      res.on('end', () => {
        let body: { message?: string; maintenance?: Maintenance }
        try { body = JSON.parse(text) as typeof body } catch { reject(new Error('Invalid response from the Box supervisor')); return }
        if (res.statusCode === 404 && !body.maintenance && body.message === 'Unknown local supervisor control') {
          reject(new Error('The running supervisor does not support maintenance yet. Restart the Box once to load the updated supervisor.')); return
        }
        if (res.statusCode !== 200 || !body.maintenance) { reject(new Error(body.message ?? 'Maintenance control failed')); return }
        resolve(body.maintenance)
      })
    })
    req.on('error', () => reject(new Error('Cannot reach the stable Box supervisor. Start the Box (box start or box dev) and try again.')))
    req.end(patch ? JSON.stringify(patch) : undefined)
  })
}

const MARK: Record<TaskState, string> = { pending: '[ ]', active: '[>]', done: '[x]', skipped: '[-]' }

function describe(state: Maintenance): void {
  if (!state.enabled) { commandSuccess('Maintenance is off'); return }
  commandWarning(`Maintenance is on${state.startedAt ? ` since ${new Date(state.startedAt).toLocaleTimeString()}` : ''}`)
  commandLine(state.lockAdmins ? 'Admins are locked out too (Builder included); only box maintenance acts' : 'Admins can still sign in and use Builder', 'muted')
  if (state.status) commandLine(state.status)
  if (state.eta) {
    const minutes = Math.round((Date.parse(state.eta) - Date.now()) / 60_000)
    commandLine(`Estimate: ${new Date(state.eta).toLocaleTimeString()} (${minutes >= 0 ? `in ${minutes} min` : `${-minutes} min over`})`, 'muted')
  } else commandLine('No estimate set (box maintenance eta 20m)', 'muted')
  state.tasks.forEach((task, index) => commandLine(`${MARK[task.state]} ${index + 1}. ${task.label}`, task.state === 'done' || task.state === 'skipped' ? 'muted' : 'text'))
}

async function main(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseMaintenanceArgs>
  try { parsed = parseMaintenanceArgs(args) }
  catch (error) { commandError(error instanceof Error ? error.message : USAGE); process.exitCode = 2; return }
  try {
    const state = parsed.action === 'show' ? await call('GET') : await call('POST', parsed.patch)
    if (parsed.json) { process.stdout.write(`${JSON.stringify(state)}\n`); return }
    commandHeader('maintenance')
    describe(state)
  } catch (error) {
    commandError(error instanceof Error ? error.message : 'Maintenance control failed')
    process.exitCode = 1
  }
}

if (isMain(import.meta.url)) void main(process.argv.slice(2))
