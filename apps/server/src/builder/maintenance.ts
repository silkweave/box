import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Maintenance mode: one file the stable supervisor owns and watches. `enabled` is the switch the
 * supervisor enforces (members blocked, the app booted with background work paused); the rest is
 * the notice everyone sees on the maintenance page, written by whoever runs the maintenance (an
 * outside agent through `box maintenance`, Builder through its control API). The notice is public:
 * anyone who opens the Box's address reads it.
 */
export type MaintenanceTaskState = 'pending' | 'active' | 'done' | 'skipped'

export interface MaintenanceTask {
  id: string
  label: string
  state: MaintenanceTaskState
}

export interface MaintenanceState {
  version: 1
  enabled: boolean
  /** Admins are turned away too (Builder included); only the host's `box maintenance` acts. */
  lockAdmins: boolean
  /** What is happening right now, in a sentence or two. Plain text. */
  status: string
  tasks: MaintenanceTask[]
  /** The expected end, ISO 8601; null when nobody gave one. */
  eta: string | null
  startedAt: string | null
  updatedAt: string
  updatedBy: string | null
}

/** One change. Fields left out stay as they are; `tasks` replaces the whole list. */
export interface MaintenancePatch {
  enabled?: boolean
  lockAdmins?: boolean
  status?: string
  eta?: string | null
  tasks?: Array<{ label: string; state?: MaintenanceTaskState }>
  task?:
    | { op: 'add'; label: string; state?: MaintenanceTaskState }
    | { op: 'start' | 'done' | 'skip' | 'pending' | 'remove'; ref: string }
  by?: string
}

export class MaintenanceError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message) }
}

const STATES: MaintenanceTaskState[] = ['pending', 'active', 'done', 'skipped']
const MAX_TASKS = 40
const MAX_LABEL = 200
const MAX_STATUS = 1000
const MAX_BY = 80

export const maintenancePath = (instanceDir: string): string => resolve(instanceDir, 'builder', 'maintenance.json')

const idle = (now: string): MaintenanceState => ({ version: 1, enabled: false, lockAdmins: false, status: '', tasks: [], eta: null, startedAt: null, updatedAt: now, updatedBy: null })

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isIso = (value: unknown): value is string => typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value))

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new MaintenanceError(400, `Expected ${field} text`)
  const trimmed = value.replace(/\r\n?/g, '\n').trim()
  if (trimmed.length > max) throw new MaintenanceError(400, `${field} is longer than ${max} characters`)
  return trimmed
}

function taskState(value: unknown): MaintenanceTaskState {
  if (value === undefined) return 'pending'
  if (!STATES.includes(value as MaintenanceTaskState)) throw new MaintenanceError(400, `Task state must be one of ${STATES.join(', ')}`)
  return value as MaintenanceTaskState
}

function parse(value: unknown): MaintenanceState {
  if (!isRecord(value) || value.version !== 1 || typeof value.enabled !== 'boolean' || typeof value.lockAdmins !== 'boolean' || typeof value.status !== 'string' || !Array.isArray(value.tasks) || typeof value.updatedAt !== 'string') {
    throw new MaintenanceError(503, 'Maintenance state is invalid')
  }
  if (value.eta !== null && !isIso(value.eta)) throw new MaintenanceError(503, 'Maintenance eta is invalid')
  if (value.startedAt !== null && !isIso(value.startedAt)) throw new MaintenanceError(503, 'Maintenance start is invalid')
  if (value.updatedBy !== null && typeof value.updatedBy !== 'string') throw new MaintenanceError(503, 'Maintenance author is invalid')
  const tasks = value.tasks.map(task => {
    if (!isRecord(task) || typeof task.id !== 'string' || typeof task.label !== 'string') throw new MaintenanceError(503, 'Maintenance task is invalid')
    return { id: task.id, label: task.label, state: taskState(task.state) }
  })
  return { version: 1, enabled: value.enabled, lockAdmins: value.lockAdmins, status: value.status, tasks, eta: value.eta as string | null, startedAt: value.startedAt as string | null, updatedAt: value.updatedAt, updatedBy: value.updatedBy as string | null }
}

export function readMaintenance(instanceDir: string, now = new Date()): MaintenanceState {
  const file = maintenancePath(instanceDir)
  if (!existsSync(file)) return idle(now.toISOString())
  try { return parse(JSON.parse(readFileSync(file, 'utf8'))) }
  catch (error) {
    if (error instanceof MaintenanceError) throw error
    throw new MaintenanceError(503, `Maintenance state is unreadable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export function writeMaintenance(instanceDir: string, state: MaintenanceState): MaintenanceState {
  const parsed = parse(state)
  const target = maintenancePath(instanceDir)
  mkdirSync(resolve(instanceDir, 'builder'), { recursive: true })
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temp, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, target)
  return parsed
}

/** A task by its 1-based position or its id. */
function findTask(tasks: MaintenanceTask[], ref: string): number {
  const position = /^\d+$/.test(ref) ? Number(ref) - 1 : -1
  const index = position >= 0 && position < tasks.length ? position : tasks.findIndex(task => task.id === ref)
  if (index < 0) throw new MaintenanceError(404, `No maintenance task ${ref}`)
  return index
}

/** Who asks: the host operator (`box maintenance`, local socket) or an admin through Builder. */
export type MaintenanceSource = 'host' | 'builder'

/**
 * Apply one change. Switching on starts a fresh notice from whatever the patch carries; switching
 * off clears it, so the next maintenance never shows a stale checklist. Locking admins out is the
 * host's alone, and while admins are locked out Builder cannot change anything.
 */
export function applyMaintenancePatch(current: MaintenanceState, patch: unknown, now = new Date(), source: MaintenanceSource = 'host'): MaintenanceState {
  if (!isRecord(patch)) throw new MaintenanceError(400, 'Expected a maintenance change')
  if (source === 'builder' && current.enabled && current.lockAdmins) throw new MaintenanceError(423, 'The host operator is running this maintenance with admins locked out')
  if (patch.lockAdmins !== undefined && typeof patch.lockAdmins !== 'boolean') throw new MaintenanceError(400, 'Expected lockAdmins boolean')
  if (source === 'builder' && patch.lockAdmins !== undefined) throw new MaintenanceError(403, 'Only the host operator can lock admins out (box maintenance)')
  const at = now.toISOString()
  if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw new MaintenanceError(400, 'Expected enabled boolean')
  const by = patch.by === undefined ? null : text(patch.by, 'by', MAX_BY) || null
  if (patch.enabled === false) return { ...idle(at), updatedBy: by }
  const starting = patch.enabled === true && !current.enabled
  let next: MaintenanceState = starting ? { ...idle(at), enabled: true, startedAt: at } : { ...current }
  if (!next.enabled) throw new MaintenanceError(409, 'Maintenance is off; switch it on first')
  if (patch.lockAdmins !== undefined) next.lockAdmins = patch.lockAdmins
  if (patch.status !== undefined) next.status = text(patch.status, 'status', MAX_STATUS)
  if (patch.eta !== undefined) {
    if (patch.eta !== null && !isIso(patch.eta)) throw new MaintenanceError(400, 'Expected eta as an ISO 8601 time or null')
    next.eta = patch.eta === null ? null : new Date(patch.eta).toISOString()
  }
  if (patch.tasks !== undefined) {
    if (!Array.isArray(patch.tasks)) throw new MaintenanceError(400, 'Expected tasks as a list')
    if (patch.tasks.length > MAX_TASKS) throw new MaintenanceError(400, `At most ${MAX_TASKS} maintenance tasks`)
    next.tasks = patch.tasks.map(task => {
      if (!isRecord(task)) throw new MaintenanceError(400, 'Expected each task as { label, state? }')
      return { id: randomUUID().slice(0, 8), label: text(task.label, 'task label', MAX_LABEL), state: taskState(task.state) }
    })
  }
  if (patch.task !== undefined) {
    const task = patch.task
    if (!isRecord(task) || typeof task.op !== 'string') throw new MaintenanceError(400, 'Expected task { op, ... }')
    const tasks = [...next.tasks]
    if (task.op === 'add') {
      if (tasks.length >= MAX_TASKS) throw new MaintenanceError(400, `At most ${MAX_TASKS} maintenance tasks`)
      tasks.push({ id: randomUUID().slice(0, 8), label: text(task.label, 'task label', MAX_LABEL), state: taskState(task.state) })
    } else {
      if (typeof task.ref !== 'string') throw new MaintenanceError(400, 'Expected the task number or id')
      const index = findTask(tasks, task.ref)
      if (task.op === 'remove') tasks.splice(index, 1)
      else {
        const state = ({ start: 'active', done: 'done', skip: 'skipped', pending: 'pending' } as const)[task.op as 'start' | 'done' | 'skip' | 'pending']
        if (!state) throw new MaintenanceError(400, 'Task op must be add, start, done, skip, pending or remove')
        tasks[index] = { ...tasks[index]!, state }
      }
    }
    next.tasks = tasks
  }
  next = { ...next, updatedAt: at, updatedBy: by ?? current.updatedBy }
  return next
}

/** What the public page and the status stream carry: no author, nothing beyond the notice. */
export function publicNotice(state: MaintenanceState): { lockAdmins: boolean; status: string; tasks: Array<{ label: string; state: MaintenanceTaskState }>; eta: string | null; startedAt: string | null; updatedAt: string } | null {
  if (!state.enabled) return null
  return { lockAdmins: state.lockAdmins, status: state.status, tasks: state.tasks.map(({ label, state: taskState }) => ({ label, state: taskState })), eta: state.eta, startedAt: state.startedAt, updatedAt: state.updatedAt }
}

/** The maintenance page's own address. An open app tab moves here when maintenance blocks it; the
 * page follows the status stream and, once maintenance ends, this address sends it back. Under /api
 * so the bare Vite port proxies it to the supervisor too. */
export const MAINTENANCE_PAGE_PATH = '/api/box-status/page'

/** Where the maintenance page returns to: a same-origin path, never another origin. */
export function maintenanceReturnPath(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith(MAINTENANCE_PAGE_PATH)) return '/'
  return [...raw].some(char => char.charCodeAt(0) < 0x20) ? '/' : raw
}
