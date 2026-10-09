// The ops kernel's vocabulary - runnable actions, their streamed progress, and the persisted run
// record. Core owns this because every feature's long-running operation (a pull, a backup, a
// publish, a sync) is an action, and the funnel that records them (run.ts) is shared.

/** Terminal result of an action - the one-line outcome. */
export interface PullResult {
  channel: string
  date: string
  /** One-line human summary (counts persisted). */
  summary: string
}

/**
 * One streamed progress chunk. Heavy actions yield several (`fetch`/`persist` phases with live
 * detail); the final `done` chunk carries the `result`. Maps to a tRPC subscription / MCP progress
 * notification / CLI NDJSON line.
 */
export interface IngestProgress {
  channel: string
  phase: 'start' | 'fetch' | 'persist' | 'done'
  message: string
  /** Present only on the terminal (`done`) chunk. */
  result?: PullResult
}

/** Today's date in UTC (YYYY-MM-DD) - the default snapshot date when a caller doesn't pin one. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Drain a streaming action to its final result - for non-streaming callers. */
export async function drain(gen: AsyncGenerator<IngestProgress>): Promise<PullResult> {
  let result: PullResult | undefined
  for await (const p of gen) if (p.result) result = p.result
  if (!result) throw new Error('action produced no result')
  return result
}

/** What a run may be invoked with: an optional snapshot date and free-form per-run params. */
export interface ActionRunOpts {
  date?: string
  params?: Record<string, string>
}

/** The catalog entry - what the dashboard, the scheduler and MCP see. */
export interface ActionInfo {
  /** Unique across the Box; asserted at boot. */
  id: string
  label: string
  /** Free-form; groups the dashboard grid ('Pulls' | 'Backfills' | 'Warehouse' | …). */
  group: string
  description: string
  /** True for actions that need per-run params - not schedulable, and hidden from the bare Run
   *  console (their own view triggers them). */
  parameterized?: boolean
}

/** A runnable action a feature contributes to the funnel. */
export interface ActionSpec extends ActionInfo {
  run: (opts: ActionRunOpts) => AsyncGenerator<IngestProgress>
}

/** @deprecated name kept for the server/web DTOs; it is ActionInfo. */
export type AutomationActionInfo = ActionInfo

export const RUN_STATUSES = ['queued', 'running', 'success', 'error', 'skipped'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/** How a run started. `schedule` is legacy (config schedules, before triggers): read, never written. */
export const RUN_TRIGGERS = ['time', 'event', 'webhook', 'manual', 'schedule'] as const
export type RunTrigger = (typeof RUN_TRIGGERS)[number]

/** One buffered progress line of a run's log (an IngestProgress chunk + timestamp). */
export interface RunLogLine {
  ts: string
  channel: string
  phase: string
  message: string
  /** Per-run sequence (0, 1, ...), kept when the cap drops old lines; rows stored before it read as their index. */
  seq?: number
}

/** One run, as stored in `automation_runs`. `log` is only loaded by readRun(). */
export interface AutomationRun {
  id: string
  /** Legacy schedule id (runs recorded before triggers); new runs use trigger_id. */
  schedule_id: string | null
  action_id: string
  trigger: RunTrigger
  /** The automation trigger that started the run, when one did. */
  trigger_id: string | null
  /** The event that fired an event trigger. */
  event_id: string | null
  /** users.id that clicked Run Now, or null (scheduled / unattributed agent runs). */
  triggered_by: string | null
  status: RunStatus
  started_at: string
  finished_at: string | null
  /** Milliseconds from start to finish; null while queued/running. */
  duration_ms: number | null
  summary: string | null
  error: string | null
  /** The newest live log line of an active run in this process (list reads only). */
  latest?: string
}

export interface AutomationRunWithLog extends AutomationRun {
  log: RunLogLine[]
}
