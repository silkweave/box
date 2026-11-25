import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// What the Builder agent tells the owner's Builder shell about the session, beyond the transcript:
// its task plan (pinned above the conversation with progress and time) and, when the work is ready,
// the commit message it proposes for Wrap Up. The ready message itself is the agent's last transcript
// message, ending with a [Wrap Up](#wrap-up) link that Builder opens. The agent sends both
// with `box builder tasks|ready --session <id> <JSON>` over the host-local control socket; the
// shell reads them with the control state. One file for the current session, replaced when a new
// session reports.

const MAX_TEXT = 300
const MAX_MESSAGE = 4000
const MAX_TASKS = 20

export type BuilderTaskStatus = 'pending' | 'running' | 'done'

export interface BuilderTask {
  title: string
  status: BuilderTaskStatus
  /** The agent's estimate for this task, in minutes, at Builder session pace. */
  estimateMinutes?: number
  /** When the task first reported running, and when it reported done (ISO). */
  startedAt?: string
  doneAt?: string
}

export interface BuilderTaskPlan {
  tasks: BuilderTask[]
  /** When the plan first arrived: elapsed time counts from here. */
  startedAt: string
  updatedAt: string
}

export interface BuilderReadyReport {
  commitMessage: string
  at: string
}

export interface BuilderSessionReport {
  sessionId: string
  plan?: BuilderTaskPlan
  ready?: BuilderReadyReport
}

export class BuilderReportError extends Error {
  readonly statusCode = 400
}

const fail = (message: string): never => { throw new BuilderReportError(message) }
const record = (value: unknown, what: string): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail(`${what} must be a JSON object`)
const text = (value: unknown, field: string, max = MAX_TEXT): string =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : fail(`${field} must be a non-empty string`)

/** Validates `box builder tasks` input: `{ "tasks": [{ "title", "status", "estimateMinutes"? }] }`. */
export function parseTaskPlan(input: unknown): Pick<BuilderTask, 'title' | 'status' | 'estimateMinutes'>[] {
  const raw = record(input, 'The task plan')
  if (!Array.isArray(raw['tasks']) || raw['tasks'].length === 0) fail('tasks must be a non-empty array')
  const tasks = raw['tasks'] as unknown[]
  if (tasks.length > MAX_TASKS) fail(`At most ${MAX_TASKS} tasks`)
  return tasks.map((task, index) => {
    const item = record(task, `tasks[${index}]`)
    const status = item['status'] ?? 'pending'
    if (status !== 'pending' && status !== 'running' && status !== 'done') fail(`tasks[${index}].status must be pending, running or done`)
    const estimate = item['estimateMinutes']
    if (estimate !== undefined && (typeof estimate !== 'number' || !Number.isFinite(estimate) || estimate < 0 || estimate > 24 * 60)) fail(`tasks[${index}].estimateMinutes must be a number of minutes`)
    return { title: text(item['title'], `tasks[${index}].title`), status: status as BuilderTaskStatus, ...(typeof estimate === 'number' ? { estimateMinutes: Math.round(estimate) } : {}) }
  })
}

/** Validates `box builder ready` input: `{ "commitMessage": "..." }`. */
export function parseReadyReport(input: unknown): Omit<BuilderReadyReport, 'at'> {
  const raw = record(input, 'The ready report')
  return { commitMessage: text(raw['commitMessage'], 'commitMessage', MAX_MESSAGE) }
}

const reportPath = (instance: string): string => join(instance, 'builder', 'session-report.json')

/** The current session's report, or null when none was sent for it. */
export function readSessionReport(instance: string, sessionId: string): BuilderSessionReport | null {
  try {
    const report = JSON.parse(readFileSync(reportPath(instance), 'utf8')) as BuilderSessionReport
    return report.sessionId === sessionId ? report : null
  } catch { return null }
}

function writeSessionReport(instance: string, report: BuilderSessionReport): void {
  const path = reportPath(instance)
  mkdirSync(join(instance, 'builder'), { recursive: true })
  writeFileSync(`${path}.tmp`, `${JSON.stringify(report, null, 2)}\n`)
  renameSync(`${path}.tmp`, path)
}

/**
 * Merges a new plan into the stored one: a task keeps the time it started running and finished,
 * matched by title, so a re-sent plan keeps elapsed times honest.
 */
export function mergeTaskPlan(previous: BuilderTaskPlan | undefined, tasks: ReturnType<typeof parseTaskPlan>, now: string): BuilderTaskPlan {
  const before = new Map(previous?.tasks.map(task => [task.title, task]) ?? [])
  return {
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
    tasks: tasks.map(task => {
      const old = before.get(task.title)
      const startedAt = old?.startedAt ?? (task.status !== 'pending' ? now : undefined)
      const doneAt = task.status === 'done' ? (old?.doneAt ?? now) : undefined
      return { ...task, ...(startedAt ? { startedAt } : {}), ...(doneAt ? { doneAt } : {}) }
    }),
  }
}

/** Applies one report from the agent to the current session's record. */
export function applySessionReport(instance: string, sessionId: string, kind: unknown, payload: unknown, now = new Date().toISOString()): BuilderSessionReport {
  const current = readSessionReport(instance, sessionId) ?? { sessionId }
  let next: BuilderSessionReport
  if (kind === 'tasks') next = { ...current, plan: mergeTaskPlan(current.plan, parseTaskPlan(payload), now) }
  else if (kind === 'ready') next = { ...current, ready: { ...parseReadyReport(payload), at: now } }
  else return fail('kind must be tasks or ready')
  writeSessionReport(instance, next)
  return next
}
