// The ops funnel - EVERY run of an action (cron fire, dashboard Run Now, MCP/agent, CLI) goes
// through executeRecorded(), which wraps the action's generator with an automation_runs row:
// queued → running → success/error, with the progress stream as the run's live log (run-log.ts:
// readable while it runs, flushed every few seconds, written in full at finalization).
//
// Core knows nothing about what should happen AFTER a run: features subscribe with
// onRunOutcome() (core itself records signal events on success and a `run.error` event on
// failure). Listeners are best-effort and never affect the run's own outcome.
//
// Queue semantics: in-process FIFO, concurrency 1 (runs execute strictly in order; heavy pulls
// are subprocesses and never overlap). Callers that want skip-instead-of-queue (the scheduler) check
// isActionBusy() first and record a 'skipped' row via insertSkippedRun().

import { AreaAccessError } from '../auth/access.js'
import { asSystem, requireReachArea } from '../request-context.js'
import { admitFrame } from '../warehouse/core-command.js'
import { actionOwner, resolveRunner } from './registry.js'
import { appendRunLog, closeRunLog } from './run-log.js'
import { canFollowRun, finalizeRun, insertRun, markRunning, newRunId } from './runs.js'
import type { IngestProgress, RunLogLine, RunTrigger } from './types.js'

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
      // Subscribers are bookkeeping after a run: named system work, whoever ran it.
      await asSystem(`run outcome: ${outcome.actionId}`, () => listener(outcome))
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
  /** Per-run args for parameterized actions (`source-sync`: the source to sync). */
  params?: Record<string, string>
}

/**
 * Run an automation action, recording it as an automation_runs row while re-yielding its progress
 * chunks (so live SSE subscribers still see everything). Throws on an unknown action id; a runtime
 * failure finalizes the row as 'error' and re-throws so streaming consumers see the stream error.
 *
 * A request run needs write on the action's owning area (W8 R3; BOX-Review W8 finding 3 and
 * d613f4e finding 3): checked before the row is written and again after the queue wait, against the
 * committed policy, before the runner starts. The runner then executes in the caller's frame, so
 * each accessor it touches decides. System callers pass.
 */
export async function* executeRecorded(actionId: string, meta: RunMeta): AsyncGenerator<IngestProgress> {
  const runner = resolveRunner(actionId, { date: meta.date, params: meta.params })
  if (!runner) throw new Error(`unknown automation action "${actionId}" (see listAutomationActions)`)
  const owner = actionOwner(actionId)
  requireReachArea(owner, 'write')

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
  const push = (chunk: IngestProgress): void => {
    appendRunLog(runId, { channel: chunk.channel, phase: chunk.phase, message: chunk.message })
  }
  const finalize = async (outcome: { status: 'success' | 'error'; summary?: string; error?: string }): Promise<void> => {
    const log: RunLogLine[] = await closeRunLog(runId)
    await finalizeRun(runId, { ...outcome, log })
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

    // The wait may be long: admit the caller again (a policy commit meanwhile re-resolves it).
    await admitFrame()
    requireReachArea(owner, 'write')
    entry.state = 'running'
    if (!(await markRunning(runId))) throw new Error(`run ${runId} is no longer queued`)
    let summary: string | undefined
    for await (const chunk of runner()) {
      push(chunk)
      if (chunk.result?.summary) summary = chunk.result.summary
      yield chunk
    }
    await finalize({ status: 'success', summary })
    finalized = true
    await notifyRunOutcome({ runId, actionId, status: 'success', trigger: meta.trigger, triggerId: meta.triggerId ?? null, summary })
  } catch (err) {
    const message = String((err as Error)?.message ?? err)
    push({ channel: actionId, phase: 'done', message: `error: ${message}` })
    await finalize({ status: 'error', error: message })
    finalized = true
    await notifyRunOutcome({ runId, actionId, status: 'error', trigger: meta.trigger, triggerId: meta.triggerId ?? null, error: message })
    throw err
  } finally {
    // Safety net: a consumer that returns the generator early aborts the run with it - neither
    // branch above ran. Record that instead of leaving the row 'running' until the next boot's
    // orphan sweep. (Dashboard/MCP runs no longer hit this - startDetachedRun() is the only
    // executeRecorded consumer there and it always drains to completion.)
    if (!finalized) {
      await finalize({ status: 'error', error: 'stream disconnected before the run finished' })
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
 *
 * tail() authorizes every delivery in the frame that pulls it (BOX-Review d613f4e finding 1): before
 * each buffered or new chunk, and before the final error, the subscriber must still be able to
 * follow the run (runs.ts canFollowRun: admitted against the committed policy). A subscriber that
 * lost it gets an area refusal; the run goes on.
 */
export function startDetachedRun(actionId: string, meta: RunMeta): { runId: string; tail: () => AsyncGenerator<IngestProgress> } {
  // Checked here too so a refusal is synchronous for the caller (executeRecorded checks again).
  const owner = actionOwner(actionId)
  requireReachArea(owner, 'write')
  const runId = meta.runId ?? newRunId()
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
      for await (const chunk of executeRecorded(actionId, { ...meta, runId })) {
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

  const deliverable = async (): Promise<void> => {
    if (!(await canFollowRun(runId, actionId))) throw new AreaAccessError(owner, 'read')
  }

  return {
    runId,
    async *tail() {
      let i = 0
      for (;;) {
        if (i < chunks.length) {
          await deliverable()
          yield chunks[i++]
          continue
        }
        if (done) break
        await new Promise<void>((wake) => waiters.push(wake))
      }
      if (error) {
        await deliverable()
        throw new Error(error)
      }
    },
  }
}
