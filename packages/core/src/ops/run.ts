// The ops funnel - EVERY run of an action (cron fire, dashboard Run Now, MCP/agent, CLI) goes
// through executeRecorded(), which wraps the action's generator with an automation_runs row:
// queued → running → success/error, buffering the progress stream as the run's log (written once
// at finalization - one warehouse write per run, not per line).
//
// Core knows nothing about what should happen AFTER a run: features subscribe with
// onRunOutcome() (alerts re-evaluates signal rules on success and records a `run.error` event on
// failure). Listeners are best-effort and never affect the run's own outcome.
//
// Queue semantics: in-process FIFO, concurrency 1 (the warehouse is single-writer and heavy pulls
// are subprocesses anyway). Callers that want skip-instead-of-queue (the scheduler) check
// isActionBusy() first and record a 'skipped' row via insertSkippedRun().

import { resolveRunner } from './registry.js'
import { finalizeRun, insertRun, markRunning, newRunId } from './runs.js'
import type { IngestProgress, RunLogLine, RunTrigger } from './types.js'

const LOG_CAP = 2000 // keep the last N lines per run (backfills can stream thousands)

interface ActiveRun {
  runId: string
  actionId: string
  state: 'queued' | 'running'
}

const active = new Map<string, ActiveRun>() // runId → state

/** What a run-outcome subscriber learns once a run has been finalized. */
export interface RunOutcome {
  runId: string
  actionId: string
  status: 'success' | 'error'
  trigger: RunTrigger
  triggerId: string | null
  summary?: string
  error?: string
}

export type RunOutcomeListener = (outcome: RunOutcome) => void | Promise<void>

const outcomeListeners = new Set<RunOutcomeListener>()

/** Subscribe to finalized runs. Returns the unsubscribe. Register from a server module's onModuleInit. */
export function onRunOutcome(listener: RunOutcomeListener): () => void {
  outcomeListeners.add(listener)
  return () => {
    outcomeListeners.delete(listener)
  }
}

/**
 * Tell the run-outcome subscribers about a run finalized outside the funnel (an agent trigger's
 * WorkerDeck job). The funnel calls it for its own runs.
 */
export async function notifyRunOutcome(outcome: RunOutcome): Promise<void> {
  for (const listener of outcomeListeners) {
    try {
      await listener(outcome)
    } catch (err) {
      console.error(`[ops] run-outcome listener failed for ${outcome.actionId}: ${String((err as Error)?.message ?? err)}`)
    }
  }
}

/** True if any run of this action is currently queued or running (the scheduler's overlap check). */
export function isActionBusy(actionId: string): boolean {
  for (const r of active.values()) if (r.actionId === actionId) return true
  return false
}

/** The currently queued/running runs, FIFO order - surfaced by automationStatus. */
export function activeRuns(): ActiveRun[] {
  return [...active.values()]
}

// FIFO gate: each run awaits the tail of the chain, then appends its own completion to it.
let queueTail: Promise<void> = Promise.resolve()

function acquireSlot(): { turn: Promise<void>; release: () => void } {
  let release!: () => void
  const done = new Promise<void>((r) => (release = r))
  const turn = queueTail
  queueTail = queueTail.then(() => done)
  return { turn, release }
}

export interface RunMeta {
  trigger: RunTrigger
  /** The automation trigger this run belongs to (links it in history). */
  triggerId?: string
  /** The event that fired the trigger. */
  eventId?: string
  /** A run id the caller allocated with newRunId(), so it can hand the id back before the run ends. */
  runId?: string
  /** users.id for attributed manual runs. */
  triggeredBy?: string | null
  /** Snapshot date override, plugin actions only. */
  date?: string
  /** Per-run args for parameterized actions (verify-engagement: content_id, user_id, actor). */
  params?: Record<string, string>
}

/**
 * Run an automation action, recording it as an automation_runs row while re-yielding its progress
 * chunks (so live SSE subscribers still see everything). Throws on an unknown action id; a runtime
 * failure finalizes the row as 'error' and re-throws so streaming consumers see the stream error.
 */
export async function* executeRecorded(actionId: string, meta: RunMeta): AsyncGenerator<IngestProgress> {
  const runner = resolveRunner(actionId, { date: meta.date, params: meta.params })
  if (!runner) throw new Error(`unknown automation action "${actionId}" (see listAutomationActions)`)

  const runId = meta.runId ?? newRunId()
  await insertRun({
    id: runId,
    action_id: actionId,
    trigger: meta.trigger,
    trigger_id: meta.triggerId ?? null,
    event_id: meta.eventId ?? null,
    triggered_by: meta.triggeredBy ?? null,
  })
  const entry: ActiveRun = { runId, actionId, state: 'queued' }
  active.set(runId, entry)

  const { turn, release } = acquireSlot()
  const log: RunLogLine[] = []
  const push = (chunk: IngestProgress): void => {
    log.push({ ts: new Date().toISOString(), channel: chunk.channel, phase: chunk.phase, message: chunk.message })
    if (log.length > LOG_CAP) log.splice(0, log.length - LOG_CAP)
  }
  let finalized = false

  try {
    const ahead = [...active.values()].filter((r) => r.runId !== runId && r.state !== 'queued')
    if (ahead.length > 0) {
      const waiting: IngestProgress = {
        channel: actionId,
        phase: 'start',
        message: `queued behind ${ahead.map((r) => r.actionId).join(', ')}`,
      }
      push(waiting)
      yield waiting
    }
    await turn

    entry.state = 'running'
    await markRunning(runId)
    let summary: string | undefined
    for await (const chunk of runner()) {
      push(chunk)
      if (chunk.result?.summary) summary = chunk.result.summary
      yield chunk
    }
    await finalizeRun(runId, { status: 'success', summary, log })
    finalized = true
    await notifyRunOutcome({ runId, actionId, status: 'success', trigger: meta.trigger, triggerId: meta.triggerId ?? null, summary })
  } catch (err) {
    const message = String((err as Error)?.message ?? err)
    push({ channel: actionId, phase: 'done', message: `error: ${message}` })
    await finalizeRun(runId, { status: 'error', error: message, log })
    finalized = true
    await notifyRunOutcome({ runId, actionId, status: 'error', trigger: meta.trigger, triggerId: meta.triggerId ?? null, error: message })
    throw err
  } finally {
    // Safety net: a consumer that returns the generator early aborts the run with it - neither
    // branch above ran. Record that instead of leaving the row 'running' until the next boot's
    // orphan sweep. (Dashboard/MCP runs no longer hit this - startDetachedRun() is the only
    // executeRecorded consumer there and it always drains to completion.)
    if (!finalized) {
      await finalizeRun(runId, { status: 'error', error: 'stream disconnected before the run finished', log })
    }
    active.delete(runId)
    release()
  }
}

/**
 * Run an action detached from any streaming consumer: executeRecorded() is drained to completion
 * by a background task feeding an in-memory buffer, and tail() replays + follows that buffer.
 * Dropping a tail mid-run (navigating away, closing the tab, an MCP client hanging up) only
 * detaches the viewer - the run itself finishes and finalizes normally, exactly like a scheduled
 * fire (which has no subscriber at all). tail() rethrows the run's error at the end so streaming
 * consumers still see a stream error.
 */
export function startDetachedRun(actionId: string, meta: RunMeta): { tail: () => AsyncGenerator<IngestProgress> } {
  const chunks: IngestProgress[] = []
  let done = false
  let error: string | undefined
  let waiters: Array<() => void> = []
  const notify = (): void => {
    const batch = waiters
    waiters = []
    for (const wake of batch) wake()
  }

  void (async () => {
    try {
      for await (const chunk of executeRecorded(actionId, meta)) {
        chunks.push(chunk)
        notify()
      }
    } catch (err) {
      error = String((err as Error)?.message ?? err)
    } finally {
      done = true
      notify()
    }
  })()

  return {
    async *tail() {
      let i = 0
      for (;;) {
        while (i < chunks.length) yield chunks[i++]
        if (done) break
        await new Promise<void>((wake) => waiters.push(wake))
      }
      while (i < chunks.length) yield chunks[i++]
      if (error) throw new Error(error)
    },
  }
}
