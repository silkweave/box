// Run-history persistence - the `automation_runs` table. Written exclusively by the
// execute+record funnel (run.ts) and the scheduler's skip/orphan bookkeeping; read by the
// Automation dashboard.
//
// Reads go through the record layer (warehouse/model.ts + the AUTOMATION_RUNS spec); duration_ms
// is not a column - it is derived here from started_at/finished_at, and the parsed `log` is
// dropped from list results (only readRun returns it). The queued → running → finalize flips stay
// raw, targeted UPDATEs (the generic partial upsert would read-then-rewrite the whole row), and
// raw writes stamp their own UTC-naive timestamps (never SQL now(), which is local wall time).

import { ensureSchema, withRead, withWrite } from '../warehouse/db.js'
import { readRecord, readRecords, toNaiveUtc } from '../warehouse/model.js'
import { AUTOMATION_RUNS } from '../warehouse/core-models.js'
import { liveRunLog, sliceRunLog } from './run-log.js'
import type { AutomationRun, AutomationRunWithLog, RunLogLine, RunStatus, RunTrigger } from './types.js'

/** The record-layer row shape: every column (parsed `log` included), before duration_ms exists. */
type RunRecord = Omit<AutomationRun, 'duration_ms'> & { log: RunLogLine[] | null }

/** UTC-naive "now" for raw writes - the same stamp convention the record layer uses. */
const utcNow = (): string => toNaiveUtc(new Date().toISOString())

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
  status?: RunStatus
}): Promise<void> {
  await ensureSchema()
  await withWrite(async (conn) => {
    await conn.run(
      `INSERT INTO automation_runs (id, action_id, trigger, trigger_id, event_id, triggered_by, status, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?::TIMESTAMP)`,
      [run.id, run.action_id, run.trigger, run.trigger_id ?? null, run.event_id ?? null, run.triggered_by, run.status ?? 'queued', utcNow()],
    )
  })
}

/** Flip a queued run to running and reset started_at (queue wait doesn't count as runtime). */
export async function markRunning(id: string): Promise<void> {
  await withWrite(async (conn) => {
    await conn.run(`UPDATE automation_runs SET status = 'running', started_at = ?::TIMESTAMP WHERE id = ?`, [
      utcNow(),
      id,
    ])
  })
}

/** Terminal update - status/summary/error plus the whole buffered log, written once. */
export async function finalizeRun(
  id: string,
  outcome: { status: 'success' | 'error' | 'skipped'; summary?: string; error?: string; log: RunLogLine[] },
): Promise<void> {
  await withWrite(async (conn) => {
    await conn.run(
      `UPDATE automation_runs
          SET status = ?, finished_at = ?::TIMESTAMP, summary = ?, error = ?, log = ?::JSON
        WHERE id = ?`,
      [outcome.status, utcNow(), outcome.summary ?? null, outcome.error ?? null, JSON.stringify(outcome.log), id],
    )
  })
}

/** Record a trigger fire that was skipped (its action already queued/running, a guard said no). */
export async function insertSkippedRun(
  run: { trigger: RunTrigger; triggerId: string; eventId?: string | null; actionId: string },
  reason: string,
): Promise<void> {
  const id = newRunId()
  await ensureSchema()
  const now = utcNow()
  await withWrite(async (conn) => {
    await conn.run(
      `INSERT INTO automation_runs (id, action_id, trigger, trigger_id, event_id, triggered_by, status, started_at, finished_at, error)
       VALUES (?, ?, ?, ?, ?, NULL, 'skipped', ?::TIMESTAMP, ?::TIMESTAMP, ?)`,
      [id, run.actionId, run.trigger, run.triggerId, run.eventId ?? null, now, now, reason],
    )
  })
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
  await ensureSchema()
  const rows = await withRead<{ n: unknown }>(
    `SELECT count(*) AS n FROM automation_runs
      WHERE trigger_id = ? AND started_at >= ?::TIMESTAMP
        AND (status <> 'skipped' OR starts_with(COALESCE(error, ''), ?))`,
    [triggerId, toNaiveUtc(sinceIso), GATE_DECLINED_PREFIX],
  )
  return Number(rows[0]?.n ?? 0)
}

/**
 * Runs left queued/running by a previous server process can never finish - mark them at boot. The
 * log flushed while they ran is kept, closed with a line saying where it stops.
 */
export async function markOrphanedRuns(): Promise<number> {
  await ensureSchema()
  const orphans = await withRead<{ id: string; log: string | null }>(
    `SELECT id, CAST(log AS VARCHAR) AS log FROM automation_runs WHERE status IN ('queued', 'running')`,
  )
  if (orphans.length === 0) return 0
  const now = new Date().toISOString()
  await withWrite(async (conn) => {
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
      await conn.run(
        `UPDATE automation_runs
            SET status = 'error', finished_at = ?::TIMESTAMP, error = 'orphaned by server restart', log = ?::JSON
          WHERE id = ? AND status IN ('queued', 'running')`,
        [utcNow(), JSON.stringify(lines), orphan.id],
      )
    }
  })
  return orphans.length
}

const parseLog = (raw: string | null): RunLogLine[] => {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RunLogLine[]) : []
  } catch {
    return []
  }
}

/** Latest runs, newest first, without the log (dropped after the read - kept light for the list). */
export async function readRuns(limit = 100): Promise<AutomationRun[]> {
  const rows = await readRecords<RunRecord>(AUTOMATION_RUNS, {
    orderBy: `started_at DESC, id DESC LIMIT ${Number(limit)}`,
  })
  return rows.map(withDuration)
}

/**
 * One run with its log, or null. An active run in this process reads its live lines (fresher than
 * the last flush). `after` returns only lines with a greater seq; `tail` keeps the last n.
 */
export async function readRun(id: string, opts: { after?: number; tail?: number } = {}): Promise<AutomationRunWithLog | null> {
  const rec = await readRecord<RunRecord>(AUTOMATION_RUNS, { id })
  if (!rec) return null
  const active = rec.status === 'queued' || rec.status === 'running'
  const lines = (active ? liveRunLog(id) : null) ?? rec.log ?? []
  return { ...withDuration(rec), log: sliceRunLog(lines, opts) }
}
