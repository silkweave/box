// Run-history persistence - the `automation_runs` table. Written exclusively by the
// execute+record funnel (run.ts) and the scheduler's skip/orphan bookkeeping; read by the
// Automation dashboard.
//
// Reads go through the record layer (warehouse/model.ts + the AUTOMATION_RUNS spec); duration_ms
// is not a column - it is derived here from started_at/finished_at, and the parsed `log` is
// dropped from list results (only readRun returns it). The queued → running → finalize flips stay
// raw, targeted UPDATEs (the generic partial upsert would read-then-rewrite the whole row); they
// stamp the process clock's instant, like the record layer.

import { withWrite } from '../warehouse/db.js'
import { db } from '../warehouse/core-db.js'
import { anyOf, json, sql } from '../warehouse/kysely.js'
import { readRecord, toInstant } from '../warehouse/model.js'
import { AUTOMATION_RUNS } from '../warehouse/core-models.js'
import { emitAreaChange } from '../changes.js'
import { actionOwner, AGENT_RUN_ACTION, isAgentRun } from './registry.js'
import { asSystem, canReachArea, currentScope } from '../request-context.js'
import type { Access } from '../auth/access.js'
import { agentAccessAt, coversAccess } from '../auth/covers.js'
import { policyRevision } from '../auth/policy-revision.js'
import { ExecutorError } from '../warehouse/executor.js'
import { lastRunLogLine, liveRunLog, sliceRunLog } from './run-log.js'
import type { AutomationRun, AutomationRunWithLog, RunLogLine, RunStatus, RunTrigger } from './types.js'

/** The record-layer row shape: every column (parsed `log` included), before duration_ms exists. */
type RunRecord = Omit<AutomationRun, 'duration_ms'> & { log: RunLogLine[] | null }

/** "Now" for raw writes, as an ISO instant. */
const utcNow = (): string => new Date().toISOString()
const CORE = { reach: 'core' } as const

/**
 * Tell the dashboard's change feed a run row changed state (inserted, running, settled), so the
 * runs list shows a new run without a Refresh. Not on log flushes: the list carries only the
 * newest line, which it picks up on its own poll while a run is active. `areas` are the rows' owning
 * areas (the feed's readers); `detail` is the run id, which only admins and server-side listeners
 * see (opsRunTail listens for its run settling).
 */
const runChanged = (areas: Iterable<string>, id?: string): void => emitAreaChange('table:automation_runs', areas, id)

/** Derive duration_ms from the ISO timestamps and drop the log column (list reads stay light). */
const withDuration = ({ log: _log, ...r }: RunRecord): AutomationRun => ({
  ...r,
  duration_ms: r.finished_at == null ? null : Date.parse(r.finished_at) - Date.parse(r.started_at),
})

let counter = 0

/** New unique run id - time-ordered, unique even for same-ms inserts. */
export function newRunId(): string {
  counter = (counter + 1) % 10_000
  return `run-${Date.now()}-${String(counter).padStart(4, '0')}`
}

export async function insertRun(run: {
  id: string
  action_id: string
  trigger: RunTrigger
  trigger_id?: string | null
  event_id?: string | null
  triggered_by: string | null
  /** An agent job's principal; required for agent runs (their readers must cover it). */
  acts_as?: string | null
  status?: RunStatus
}): Promise<void> {
  if (isAgentRun(run.action_id) && !run.acts_as) throw new Error(`agent run ${run.id} needs the principal it acts as`)
  await withWrite(async () => {
    await db.insertInto('automation_runs')
      .values({
        id: run.id, action_id: run.action_id, trigger: run.trigger, trigger_id: run.trigger_id ?? null, event_id: run.event_id ?? null,
        triggered_by: run.triggered_by, acts_as: run.acts_as ?? null, status: run.status ?? 'queued', started_at: utcNow(), area: actionOwner(run.action_id),
      })
      .execute()
  }, CORE)
  runChanged([actionOwner(run.action_id)], run.id)
}

/**
 * Flip a queued run to running and reset started_at (queue wait doesn't count as runtime). The
 * funnel's own bookkeeping on the row it inserted, as system work: the caller's write was checked at
 * the insert and again at the start (run.ts). Returns false when the row is gone.
 */
export async function markRunning(id: string): Promise<boolean> {
  const rows = await asSystem('run record: running', () => withWrite(() =>
    db.updateTable('automation_runs').set({ status: 'running', started_at: utcNow() }).where('id', '=', id).where('status', '=', 'queued').returning('area').execute(), CORE))
  runChanged(rows.map((r) => r.area), id)
  return rows.length > 0
}

/** Terminal update - status/summary/error plus the whole buffered log, written once. */
export async function finalizeRun(
  id: string,
  outcome: { status: 'success' | 'error' | 'skipped'; summary?: string; error?: string; log: RunLogLine[] },
): Promise<void> {
  // The funnel's bookkeeping, as system work: a caller downgraded mid-run still gets its run settled.
  const rows = await asSystem('run record: finalize', () => withWrite(() =>
    db.updateTable('automation_runs')
      .set({ status: outcome.status, finished_at: utcNow(), summary: outcome.summary ?? null, error: outcome.error ?? null, log: json(outcome.log) })
      .where('id', '=', id)
      .returning('area')
      .execute(), CORE))
  runChanged(rows.map((r) => r.area), id)
}

/**
 * Record a trigger fire that was skipped (its action already queued/running, a guard said no). An
 * agent trigger's skip carries the principal it would have acted as (its readers must cover it);
 * without one the row is admin-only.
 */
export async function insertSkippedRun(
  run: { trigger: RunTrigger; triggerId: string; eventId?: string | null; actionId: string; actsAs?: string | null },
  reason: string,
): Promise<void> {
  const id = newRunId()
  const now = utcNow()
  await withWrite(async () => {
    await db.insertInto('automation_runs')
      .values({
        id, action_id: run.actionId, trigger: run.trigger, trigger_id: run.triggerId, event_id: run.eventId ?? null, triggered_by: null,
        acts_as: run.actsAs ?? null, status: 'skipped', started_at: now, finished_at: now, error: reason, area: actionOwner(run.actionId),
      })
      .execute()
  }, CORE)
  runChanged([actionOwner(run.actionId)], id)
}

/**
 * Error text of a run an agent trigger's gate declined (status `skipped`). Unlike the other skips,
 * a declined gate spent a job, so it counts toward the trigger's daily cap.
 */
export const GATE_DECLINED_PREFIX = 'gate declined'

/**
 * How many runs of a trigger started since `sinceIso` count toward its daily cap: every run that
 * was started, plus the ones its gate declined; skips by a guard (busy, cap) do not count.
 */
export async function countTriggerRunsSince(triggerId: string, sinceIso: string): Promise<number> {
  const { n } = await db.selectFrom('automation_runs')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('trigger_id', '=', triggerId)
    .where('started_at', '>=', toInstant(sinceIso))
    // Raw sql: starts_with() has no builder form.
    .where((eb) => eb.or([eb('status', '<>', 'skipped'), sql<boolean>`starts_with(coalesce(${eb.ref('error')}, ''), ${GATE_DECLINED_PREFIX})`]))
    .executeTakeFirstOrThrow()
  return Number(n)
}

/**
 * Runs left queued/running by a previous server process can never finish - mark them at boot. The
 * log flushed while they ran is kept, closed with a line saying where it stops.
 */
export async function markOrphanedRuns(): Promise<number> {
  const now = new Date().toISOString()
  // One transaction: the orphans are locked as they are read, so a run this process starts
  // meanwhile (a new id) is untouched and no orphan is closed twice.
  const orphans = await withWrite(async () => {
    const orphans = await db.selectFrom('automation_runs').select(['id', 'log', 'area']).where('status', 'in', ['queued', 'running']).forUpdate().execute()
    for (const orphan of orphans) {
      const lines = sliceRunLog(parseLog(orphan.log))
      const last = lines.at(-1)
      lines.push({
        ts: now,
        channel: last?.channel ?? 'ops',
        phase: 'done',
        message: `error: orphaned by server restart; the log stops at ${last ? last.ts : 'its start'}`,
        seq: (last?.seq ?? -1) + 1,
      })
      await db.updateTable('automation_runs')
        .set({ status: 'error', finished_at: utcNow(), error: 'orphaned by server restart', log: json(lines) })
        .where('id', '=', orphan.id)
        .execute()
    }
    return orphans
  }, CORE)
  runChanged(orphans.map((o) => o.area))
  return orphans.length
}

// Row security filters runs by the action's owning area. An agent job's run additionally needs a
// reader who covers the principal it acted as (PERMISSIONS 8.1; auth/covers.ts); one without that
// principal, or acting as one that no longer resolves or whose role the generation does not define,
// is admin-only. System reads see every run.
//
// One generation (BOX-Review d613f4e finding 4): the rows are read in an admitted transaction (the
// frame's access is at least the committed generation), and every agent's access is read at that
// access's generation. When the published policy moves meanwhile, the read and the coverage run
// again; after a few attempts the read is refused.

type RunSubject = Pick<RunRecord, 'action_id' | 'acts_as'>
type Coverage = (rec: RunSubject) => boolean
const COVERAGE_ATTEMPTS = 3

/** Coverage for `subjects` at the frame's access generation, or null when the policy moved (retry). */
async function coverageNow(subjects: readonly RunSubject[]): Promise<Coverage | null> {
  const scope = currentScope()
  if (scope.kind === 'system') return () => true
  if (scope.kind !== 'principal') return () => false
  const reader = scope.access
  const generation = reader.revision
  if (policyRevision() !== generation) return null
  const agents = new Map<string, Access | null>()
  for (const rec of subjects) {
    if (!isAgentRun(rec.action_id) || !rec.acts_as || agents.has(rec.acts_as)) continue
    const agent = await agentAccessAt(rec.acts_as, generation)
    if (agent === 'stale') return null
    agents.set(rec.acts_as, agent)
  }
  // The frame may have been re-resolved by a read meanwhile: then the reader is not the one judged.
  const now = currentScope()
  if (now.kind !== 'principal' || now.access !== reader || policyRevision() !== generation) return null
  return (rec) => {
    if (!isAgentRun(rec.action_id)) return true
    if (!rec.acts_as) return reader.admin
    const agent = agents.get(rec.acts_as)
    return agent ? coversAccess(reader, agent) : reader.admin
  }
}

/** Read with `read` (admitted in the current frame), then judge coverage at one generation. */
async function readCovered<T>(read: () => Promise<T>, subjects: (value: T) => readonly RunSubject[]): Promise<{ value: T; covers: Coverage }> {
  for (let attempt = 1; attempt <= COVERAGE_ATTEMPTS; attempt++) {
    const value = await read()
    const covers = await coverageNow(subjects(value))
    if (covers) return { value, covers }
    // The next read's admission re-resolves the frame at the committed generation.
  }
  throw new ExecutorError('POLICY_STALE', 'the access policy changed while runs were read; try again')
}

/**
 * Whether the current frame may follow run `id` right now (a live tail handing out a line, a
 * detached run's tail; BOX-Review d613f4e findings 1 and 2): one admitted read of the run's row
 * proves the committed policy and re-resolves a stale frame, then coverage at that generation. A
 * row not written yet (a run still starting) is judged by its action's owning area. Throws
 * NO_PRINCIPAL when the frame's principal can no longer act.
 */
export async function canFollowRun(id: string, actionId?: string): Promise<boolean> {
  const { value: rows, covers } = await readCovered(
    // Itself admitted: a stale frame is re-resolved before the row is read.
    () => db.selectFrom('automation_runs').select(['action_id', 'acts_as']).where('id', '=', id).execute(),
    (r) => r,
  )
  const row = rows[0]
  if (row) return covers(row)
  return actionId !== undefined && !isAgentRun(actionId) && canReachArea(actionOwner(actionId), 'read')
}

const parseLog = (raw: unknown): RunLogLine[] => (Array.isArray(raw) ? (raw as RunLogLine[]) : [])

/**
 * The newest `limit` runs the frame may read. Coverage filters in SQL, before the limit, so agent
 * runs the reader does not cover never crowd out the ones it does: the agents that acted are judged
 * first (one generation, readCovered), and the page is read with the covered agents as a filter. A
 * policy commit between the two runs both again.
 */
async function readCoveredRuns(limit: number): Promise<RunRecord[]> {
  if (!(Number.isInteger(limit) && limit >= 0)) throw new Error(`invalid limit ${limit}`)
  for (let attempt = 1; attempt <= COVERAGE_ATTEMPTS; attempt++) {
    const { value: actors, covers } = await readCovered(
      () => db.selectFrom('automation_runs').select('acts_as').distinct().where('action_id', '=', AGENT_RUN_ACTION).execute(),
      (rows) => rows.map((r) => ({ action_id: AGENT_RUN_ACTION, acts_as: r.acts_as })),
    )
    const covered = actors.filter((r) => r.acts_as && covers({ action_id: AGENT_RUN_ACTION, acts_as: r.acts_as })).map((r) => r.acts_as!)
    const unattributed = covers({ action_id: AGENT_RUN_ACTION, acts_as: null })
    const judged = currentScope()
    const rows = (await db.selectFrom('automation_runs').selectAll()
      .where((eb) => eb.or([
        eb('action_id', '<>', AGENT_RUN_ACTION),
        eb('acts_as', '=', anyOf(covered)),
        ...(unattributed ? [eb('acts_as', 'is', null)] : []),
      ]))
      .orderBy('started_at', 'desc').orderBy('id', 'desc')
      .limit(limit)
      .execute()) as RunRecord[]
    // The page's admission may have re-resolved the frame (a policy commit meanwhile): judge again.
    const now = currentScope()
    if (now.kind !== 'principal' || judged.kind !== 'principal' || (now.access === judged.access && policyRevision() === now.access.revision)) return rows
  }
  throw new ExecutorError('POLICY_STALE', 'the access policy changed while runs were read; try again')
}

/**
 * Latest runs, newest first, without the log (dropped after the read - kept light for the list).
 * An active run in this process carries its newest live line as `latest`.
 */
export async function readRuns(limit = 100): Promise<AutomationRun[]> {
  const rows = await readCoveredRuns(Math.trunc(Number(limit)))
  return rows.map((rec) => {
    const run = withDuration(rec)
    const active = rec.status === 'queued' || rec.status === 'running'
    const latest = active ? lastRunLogLine(rec.id) : null
    return latest ? { ...run, latest: latest.message } : run
  })
}

/**
 * One run with its log, or null. An active run in this process reads its live lines (fresher than
 * the last flush). `after` returns only lines with a greater seq; `tail` keeps the last n.
 */
export async function readRun(id: string, opts: { after?: number; tail?: number } = {}): Promise<AutomationRunWithLog | null> {
  const { value: rec, covers } = await readCovered(() => readRecord<RunRecord>(AUTOMATION_RUNS, { id }), (r) => (r ? [r] : []))
  if (!rec || !covers(rec)) return null
  const active = rec.status === 'queued' || rec.status === 'running'
  const lines = (active ? liveRunLog(id) : null) ?? rec.log ?? []
  return { ...withDuration(rec), log: sliceRunLog(lines, opts) }
}
