// The derive for Box tracker signals: a signal with `tracker_key` and no `data_source_id` has
// its `live` points computed by the registered tracker (signals/trackers.ts) and FULLY replaced on
// each derive. `manual` and `backfill` rows are never touched.
//
// Runs from `warehouse-derive`, right after a bind or a parameter change (upsertSignalDefinition),
// and when a scope a tracker watches changes (`watchTrackerSources`, started by core's
// SignalsModule): a task write recomputes the signals bound to `planning.tasks_done`. A signal
// whose tracker is no longer registered keeps its binding and its points; the derive reports it as
// a warning, as dead provider trackers are.

import { asSystem } from '../request-context.js'
import { teamDay } from '../box-config.js'
import { emitAreaChange, onChange } from '../changes.js'
import { withWrite } from '../warehouse/db.js'
import { db } from '../warehouse/core-db.js'
import { json, now } from '../warehouse/kysely.js'
import { insertPoints, pointWrite } from './write.js'
import { readSignalDefinition } from './definitions.js'
import { getTracker, listTrackers, type TrackerPoint } from './trackers.js'
import { floorSignalBucket } from './points.js'
import type { SignalDefinition } from './types.js'

export interface TrackerDeriveResult {
  /** Signals recomputed. */
  signals: number
  /** Live points written across them. */
  points: number
  /** Bindings whose tracker is not registered, and computes that failed. */
  warnings: string[]
}

/** Ids of the signals bound to a Box tracker (optionally one tracker key). */
export async function trackerBoundSignalIds(trackerKey?: string): Promise<string[]> {
  const rows = await db.selectFrom('signals').select('id')
    .where('tracker_key', 'is not', null).where('data_source_id', 'is', null)
    .$if(!!trackerKey, (q) => q.where('tracker_key', '=', trackerKey!))
    .orderBy('id').execute()
  return rows.map((r) => r.id)
}

const isTrackerBound = (def: SignalDefinition): boolean => Boolean(def.tracker_key) && !def.data_source_id

/** Collapse points that floor into one bucket: increments sum, levels keep the last. */
function toBuckets(def: SignalDefinition, points: TrackerPoint[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of points) {
    if (typeof p.value !== 'number' || !Number.isFinite(p.value)) {
      throw new Error(`tracker ${def.tracker_key} returned a non-finite value at ${p.at}`)
    }
    const bucket = floorSignalBucket(p.at, def.interval)
    out.set(bucket, def.accumulation === 'increment' ? (out.get(bucket) ?? 0) + p.value : p.value)
  }
  return out
}

/**
 * Recompute one tracker-bound signal and replace its live points. Throws when the signal is not
 * bound to a Box tracker or its tracker is not registered. Returns the points written.
 */
export async function deriveTrackerSignal(signalId: string): Promise<number> {
  const def = await readSignalDefinition(signalId)
  if (!def) throw new Error(`signal ${signalId} not found`)
  if (!isTrackerBound(def)) throw new Error(`signal ${signalId} is not bound to a Box tracker`)
  const tracker = getTracker(def.tracker_key!)
  if (!tracker) throw new Error(`signal ${signalId} is bound to tracker ${def.tracker_key}, which is not registered in this Box`)
  const points = await tracker.compute({ params: def.tracker_params, from: null, to: teamDay() })
  const buckets = toBuckets(def, points)
  await pointWrite([def], async (tx) => {
    await db.deleteFrom('signal_points').where('signal_id', '=', signalId).where('source', '=', 'live').execute()
    await insertPoints(tx, [...buckets].map(([bucket, value]) => ({ signal_id: signalId, bucket, value })), 'live')
    emitAreaChange('table:signal_points', [def.area])
  })
  return buckets.size
}

/** Recompute every tracker-bound signal (or those of one tracker). Never throws per signal. */
export async function deriveTrackerSignals(opts: { tracker?: string } = {}): Promise<TrackerDeriveResult> {
  const result: TrackerDeriveResult = { signals: 0, points: 0, warnings: [] }
  for (const id of await trackerBoundSignalIds(opts.tracker)) {
    const def = await readSignalDefinition(id)
    if (!def) continue
    if (!getTracker(def.tracker_key!)) {
      result.warnings.push(`${id}: tracker ${def.tracker_key} is not registered in this Box - binding kept, points not refreshed`)
      continue
    }
    try {
      result.points += await deriveTrackerSignal(id)
      result.signals++
    } catch (err) {
      result.warnings.push(`${id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return result
}

/**
 * Best-effort refresh after a tracker's source rows changed: recompute the signals bound to it,
 * logging (never throwing) what fails, so a task or deal write never fails on a chart.
 */
async function refreshTrackerSignals(trackerKey: string): Promise<void> {
  try {
    const { warnings } = await deriveTrackerSignals({ tracker: trackerKey })
    for (const w of warnings) console.warn(`[trackers] ${w}`)
  } catch (err) {
    console.warn(`[trackers] refreshing ${trackerKey} failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// --- watches ------------------------------------------------------------------------------------
// One change-bus listener for every tracker. A burst of writes (a bulk task move, an ingest) marks
// the trackers watching those scopes and recomputes each once after a short quiet spell; refreshes
// run one at a time, and a change during one queues another pass. `warehouse` (a write from another
// process, table unknown) marks every tracker.

/** Quiet spell before a refresh, so a burst of writes costs one recompute. */
export const TRACKER_WATCH_DEBOUNCE_MS = 250

const pending = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null
let running: Promise<void> | null = null
let watching: (() => void) | null = null

async function drain(): Promise<void> {
  while (pending.size > 0) {
    const keys = [...pending].sort()
    pending.clear()
    for (const key of keys) await refreshTrackerSignals(key)
  }
}

function startDrain(): void {
  if (running) return // the running pass picks up what was just marked
  // A recompute is a derivation after an authorized write: named system work, detached from
  // whichever request's change started the timer.
  running = asSystem('signals: tracker watch', () => drain()).finally(() => {
    running = null
  })
}

/** Recompute trackers on changes to what they watch. Idempotent; returns the stop function. */
export function watchTrackerSources(): () => void {
  if (!watching) {
    const off = onChange((ev) => {
      const hit = listTrackers().filter((t) => t.watches.includes(ev.scope))
      if (hit.length === 0) return
      for (const t of hit) pending.add(t.key)
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        startDrain()
      }, TRACKER_WATCH_DEBOUNCE_MS)
      timer.unref?.()
    })
    watching = () => {
      off()
      if (timer) clearTimeout(timer)
      timer = null
      pending.clear()
      watching = null
    }
  }
  return watching
}

/** Run the refreshes a change has queued now, and wait for them (tests, and a caller that reads the points next). */
export async function settleTrackerWatches(): Promise<void> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (pending.size > 0) startDrain()
  while (running) await running
}

/**
 * Rewrite one parameter value on every signal bound to a tracker (`initiative: old` -> `new` when
 * planning renames an initiative). Returns the signals changed; the write that moves the caller's own rows
 * recomputes them through the tracker's watches.
 */
export async function repointTrackerParam(trackerKey: string, param: string, oldValue: string, newValue: string): Promise<string[]> {
  const changed: string[] = []
  const areas = new Set<string>()
  for (const id of await trackerBoundSignalIds(trackerKey)) {
    const def = await readSignalDefinition(id)
    if (!def || def.tracker_params[param] !== oldValue) continue
    const next = { ...def.tracker_params, [param]: newValue }
    await withWrite(async () => {
      await db.updateTable('signals').set({ tracker_params: json(next), updated_at: now() }).where('id', '=', id).execute()
    }, { reach: 'core' })
    changed.push(id)
    areas.add(def.area)
  }
  emitAreaChange('table:signals', areas)
  return changed
}
