// The run funnel's own event: a failed run records `run.error` on the spine (deduped per run, since
// each failure is real), so a trigger can act on it. Registered by core's OpsModule.

import { recordEvent } from '../events.js'
import type { RunOutcome } from './run.js'

/** Record `run.error` for a failed run. Best-effort: never throws. */
export async function recordRunError(outcome: RunOutcome): Promise<void> {
  if (outcome.status !== 'error') return
  try {
    await recordEvent({
      kind: 'run.error',
      dedup_key: outcome.runId,
      event_at: new Date().toISOString(),
      source: 'funnel',
      subject: outcome.actionId,
      fields: {
        action_id: outcome.actionId,
        run_id: outcome.runId,
        error: outcome.error ?? '',
        trigger: outcome.trigger,
        trigger_id: outcome.triggerId ?? '',
      },
    })
  } catch (err) {
    console.error(`[ops] run.error for ${outcome.runId} not recorded: ${String((err as Error)?.message ?? err)}`)
  }
}
