// Signal events on the spine. After a run that wrote signals succeeds, every signal's two latest
// buckets are compared and what changed is recorded:
//
//   - `signal.increase`  - the signal moved up. Once per (signal, date).
//   - `signal.threshold` - the signal reached or crossed one of its `thresholds` upward. Once per
//                          (signal, threshold, date).
//
// Every signal is evaluated; a trigger picks its signal with the filter `fields.signal_id` (and a
// level with `fields.threshold`). Registered by core's SignalsModule. Best-effort: never throws into
// the run funnel. A `signal.increment` event re-materializes its signal's live buckets.

import { onChange } from '../changes.js'
import { recordEvent, type EventInput } from '../events.js'
import { readSignalDefinitions } from './definitions.js'
import { deriveSignalIncrements, readSignalPoints, SIGNAL_INCREMENT_KIND } from './points.js'
import type { SignalDefinition } from './types.js'

/** Change scopes that can move a signal's latest buckets (`warehouse` is a write from another process). */
const SIGNAL_SCOPES = new Set(['table:signal_points', 'table:snapshots', 'table:signals', 'warehouse'])

let dirty = true
let watching: (() => void) | null = null

/** Track signal writes so a run that wrote none skips the evaluation. Idempotent. */
export function watchSignalWrites(): () => void {
  if (!watching) {
    const off = onChange((ev) => {
      if (SIGNAL_SCOPES.has(ev.scope)) dirty = true
    })
    watching = () => {
      off()
      watching = null
    }
  }
  return watching
}

/** The events one signal's latest two buckets hold (pure). `latest` and `prior` are newest first. */
export function signalEventsFor(
  def: Pick<SignalDefinition, 'id' | 'label' | 'unit' | 'channel' | 'thresholds'>,
  latest: { date: string; value: number },
  prior: { date: string; value: number } | undefined,
): EventInput[] {
  const fields: Record<string, string> = {
    signal_id: def.id,
    label: def.label,
    unit: def.unit ?? '',
    channel: def.channel,
    date: latest.date,
    value: String(latest.value),
    prev: prior ? String(prior.value) : '',
    delta: String(prior ? latest.value - prior.value : latest.value),
  }
  const event = (kind: string, dedup: string, extra: Record<string, string> = {}): EventInput => ({
    kind,
    dedup_key: dedup,
    event_at: `${latest.date}T00:00:00.000Z`,
    source: 'funnel',
    subject: def.id,
    fields: { ...fields, ...extra },
  })
  const out: EventInput[] = []
  if (prior && latest.value > prior.value) out.push(event('signal.increase', `${def.id}:${latest.date}`))
  for (const t of def.thresholds) {
    if (latest.value >= t && (!prior || prior.value < t)) {
      out.push(event('signal.threshold', `${def.id}:${t}:${latest.date}`, { threshold: String(t) }))
    }
  }
  return out
}

/**
 * Evaluate every signal against the warehouse and record the events that hold (deduped, so a
 * re-run is a no-op until a value moves). Skipped when no signal was written since the last pass,
 * unless `force`. Returns how many events were freshly recorded.
 */
export async function evaluateSignalEvents(opts: { force?: boolean } = {}): Promise<{ recorded: number }> {
  if (!dirty && !opts.force) return { recorded: 0 }
  dirty = false
  try {
    let recorded = 0
    for (const def of await readSignalDefinitions()) {
      const points = await readSignalPoints(def.id)
      const [latest, prior] = points.slice(-2).reverse().map((p) => ({ date: p.bucket.slice(0, 10), value: p.value }))
      if (!latest) continue
      for (const e of signalEventsFor(def, latest, prior)) if (await recordEvent(e)) recorded++
    }
    return { recorded }
  } catch (err) {
    dirty = true
    console.error(`[signals] signal event evaluation failed: ${String((err as Error)?.message ?? err)}`)
    return { recorded: 0 }
  }
}

/** Keep increment signals current: a fresh `signal.increment` event re-materializes its signal. Never throws. */
export async function refreshEventSignals(event: EventInput): Promise<void> {
  if (event.kind === SIGNAL_INCREMENT_KIND && event.subject) {
    try {
      await deriveSignalIncrements(event.subject)
    } catch {}
  }
}
