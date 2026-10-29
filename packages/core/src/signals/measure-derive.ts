// The derive for in-Box measure signals: a signal with `measure_key` and no `data_source_id` has
// its `live` points computed by the registered measure (signals/measures.ts) and FULLY replaced on
// each derive. `manual` and `backfill` rows are never touched.
//
// Runs from `warehouse-derive`, right after a bind or a parameter change (upsertSignalDefinition),
// and from the feature that owns a measure when its source rows change (planning refreshes
// `planning.tasks_done` on every task write). A signal whose measure is no longer registered keeps
// its binding and its points; the derive reports it as a warning, as dead provider measures are.

import { teamDay } from '../box-config.js'
import { emitChange } from '../changes.js'
import { ensureSchema, withRead, withWrite } from '../warehouse/db.js'
import { toNaiveUtc } from '../warehouse/model.js'
import { readSignalDefinition } from './definitions.js'
import { getMeasure, type MeasurePoint } from './measures.js'
import { floorSignalBucket } from './points.js'
import type { SignalDefinition } from './types.js'

export interface MeasureDeriveResult {
  /** Signals recomputed. */
  signals: number
  /** Live points written across them. */
  points: number
  /** Bindings whose measure is not registered, and computes that failed. */
  warnings: string[]
}

/** Ids of the signals bound to an in-Box measure (optionally one measure key). */
export async function measureBoundSignalIds(measureKey?: string): Promise<string[]> {
  await ensureSchema()
  const rows = await withRead<{ id: string }>(
    `SELECT id FROM signals WHERE measure_key IS NOT NULL AND data_source_id IS NULL${measureKey ? ' AND measure_key = ?' : ''} ORDER BY id`,
    measureKey ? [measureKey] : [],
  )
  return rows.map((r) => r.id)
}

const isMeasureBound = (def: SignalDefinition): boolean => Boolean(def.measure_key) && !def.data_source_id

/** Collapse points that floor into one bucket: increments sum, levels keep the last. */
function toBuckets(def: SignalDefinition, points: MeasurePoint[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of points) {
    if (typeof p.value !== 'number' || !Number.isFinite(p.value)) {
      throw new Error(`measure ${def.measure_key} returned a non-finite value at ${p.at}`)
    }
    const bucket = floorSignalBucket(p.at, def.interval)
    out.set(bucket, def.accumulation === 'increment' ? (out.get(bucket) ?? 0) + p.value : p.value)
  }
  return out
}

/**
 * Recompute one measure-bound signal and replace its live points. Throws when the signal is not
 * bound to an in-Box measure or its measure is not registered. Returns the points written.
 */
export async function deriveMeasureSignal(signalId: string): Promise<number> {
  const def = await readSignalDefinition(signalId)
  if (!def) throw new Error(`signal ${signalId} not found`)
  if (!isMeasureBound(def)) throw new Error(`signal ${signalId} is not bound to an in-Box measure`)
  const measure = getMeasure(def.measure_key!)
  if (!measure) throw new Error(`signal ${signalId} is bound to measure ${def.measure_key}, which is not registered in this Box`)
  const points = await measure.compute({ params: def.measure_params, from: null, to: teamDay() })
  const buckets = toBuckets(def, points)
  const now = toNaiveUtc(new Date().toISOString())
  await withWrite(async (conn) => {
    await conn.run(`DELETE FROM signal_points WHERE signal_id = ? AND source = 'live'`, [signalId])
    for (const [bucket, value] of buckets) {
      await conn.run(
        `INSERT INTO signal_points (signal_id, bucket, value, source, note, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?::TIMESTAMP, ?, 'live', NULL, ?::TIMESTAMP, ?::TIMESTAMP, NULL, NULL)`,
        [signalId, toNaiveUtc(bucket), value, now, now],
      )
    }
  })
  emitChange('table:signal_points')
  return buckets.size
}

/** Recompute every measure-bound signal (or those of one measure). Never throws per signal. */
export async function deriveMeasureSignals(opts: { measure?: string } = {}): Promise<MeasureDeriveResult> {
  const result: MeasureDeriveResult = { signals: 0, points: 0, warnings: [] }
  for (const id of await measureBoundSignalIds(opts.measure)) {
    const def = await readSignalDefinition(id)
    if (!def) continue
    if (!getMeasure(def.measure_key!)) {
      result.warnings.push(`${id}: measure ${def.measure_key} is not registered in this Box - binding kept, points not refreshed`)
      continue
    }
    try {
      result.points += await deriveMeasureSignal(id)
      result.signals++
    } catch (err) {
      result.warnings.push(`${id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return result
}

/**
 * Best-effort refresh after a feature's source rows changed: recompute the signals bound to one
 * measure, logging (never throwing) what fails, so a task or deal write never fails on a chart.
 */
export async function refreshMeasureSignals(measureKey: string): Promise<void> {
  try {
    const { warnings } = await deriveMeasureSignals({ measure: measureKey })
    for (const w of warnings) console.warn(`[measures] ${w}`)
  } catch (err) {
    console.warn(`[measures] refreshing ${measureKey} failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Rewrite one parameter value on every signal bound to a measure (`initiative: old` -> `new` when
 * planning renames an initiative). Returns the signals changed; the caller recomputes them
 * (refreshMeasureSignals) once its own rows have moved.
 */
export async function repointMeasureParam(measureKey: string, param: string, oldValue: string, newValue: string): Promise<string[]> {
  const changed: string[] = []
  for (const id of await measureBoundSignalIds(measureKey)) {
    const def = await readSignalDefinition(id)
    if (!def || def.measure_params[param] !== oldValue) continue
    const next = { ...def.measure_params, [param]: newValue }
    await withWrite(async (conn) => {
      await conn.run(`UPDATE signals SET measure_params = ?::JSON, updated_at = now() WHERE id = ?`, [JSON.stringify(next), id])
    })
    changed.push(id)
  }
  if (changed.length > 0) emitChange('table:signals')
  return changed
}
