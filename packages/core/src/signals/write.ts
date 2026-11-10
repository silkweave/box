// The row writers for derived and backfilled history: `snapshots` (raw pull payloads) and the
// machine classes of `signal_points` (`live`, `backfill`). Derivers and backfills hand over tidy
// day-grain rows; every row's signal is auto-registered first, then written at its day's bucket
// (reads re-floor to the signal's interval, so an edited interval needs no rewrite).
//
// Raw SQL rather than the record layer: the replace is a scoped DELETE plus per-class conflict
// rules, which the partial upsert cannot express.

import { withWrite, type Tx } from '../warehouse/db.js'
import { db } from '../warehouse/core-db.js'
import { anyOf, json, now, sql } from '../warehouse/kysely.js'
import { emitAreaChange } from '../changes.js'
import { autoRegisterDefinitions } from './definitions.js'
import { storedArea } from '../auth/owning-area.js'
import { requireReachArea } from '../request-context.js'

/**
 * UPSERT a raw pull payload, owned by the writer's `area` (`signals` for a provider sync, the
 * feature for its own pulls). Keyed on (channel, date), so re-running a pull for the same date
 * overwrites in place; the area is the writer's every time.
 */
export async function upsertSnapshot(channel: string, date: string, payload: unknown, area: string): Promise<void> {
  storedArea(area)
  await withWrite(async () => {
    await db.insertInto('snapshots')
      .values({ channel, snapshot_date: date, fetched_at: now(), payload: json(payload), area })
      .onConflict((oc) => oc.columns(['channel', 'snapshot_date']).doUpdateSet((eb) => ({
        fetched_at: eb.ref('excluded.fetched_at'),
        payload: eb.ref('excluded.payload'),
        area: eb.ref('excluded.area'),
      })))
      .execute()
    emitAreaChange('table:snapshots', [area])
  }, CORE)
}

/** A channel's raw snapshots, ascending by date (a feature's deriver reads its own pulls back). */
export async function readSnapshots(channel: string): Promise<{ snapshot_date: string; payload: unknown }[]> {
  return db.selectFrom('snapshots').select(['snapshot_date', 'payload']).where('channel', '=', channel).orderBy('snapshot_date').execute()
}

/** The newest snapshot of a channel, or undefined when it has none. */
export async function readLatestSnapshot(channel: string): Promise<{ snapshot_date: string; payload: unknown } | undefined> {
  return db.selectFrom('snapshots').select(['snapshot_date', 'payload']).where('channel', '=', channel).orderBy('snapshot_date', 'desc').limit(1).executeTakeFirst()
}

/** One tidy signal row, as produced by derivers and backfills. Identity strings seed the
 *  definition when the signal is new; `date` is a day (YYYY-MM-DD). */
export interface SignalRow {
  channel: string
  signal_id: string
  label: string
  signal_group: string
  unit: string | null
  date: string
  value: number
  source?: 'live' | 'backfill'
}

const CORE = { reach: 'core' } as const
const dayBucket = (date: string): string => `${date.slice(0, 10)}T00:00:00Z`

/** A machine point: one signal's value at a bucket instant. */
export interface MachinePoint { signal_id: string; bucket: string; value: number }

/**
 * Insert machine points of one class in one statement: `live` overwrites its own bucket,
 * `backfill` keeps the first value. Duplicate buckets in `points` keep the last. Each point takes
 * its signal row's area (the foreign key holds it there); run inside `pointWrite`, which has
 * checked every signal is visible and writable.
 */
export async function insertPoints(_tx: Tx, points: readonly MachinePoint[], source: 'live' | 'backfill'): Promise<void> {
  if (points.length === 0) return
  const last = new Map<string, MachinePoint>()
  for (const p of points) last.set(`${p.signal_id}\u0000${p.bucket}`, p)
  const rows = [...last.values()]
  const now = new Date().toISOString()
  // Raw sql: a bulk INSERT ... SELECT over unnest() arrays joined to the signals, which the builder
  // cannot express; the whole batch is one statement.
  const conflict = source === 'live' ? sql`do update set value = excluded.value, updated_at = excluded.updated_at` : sql`do nothing`
  await sql`insert into ${sql.table('signal_points')} (signal_id, area, bucket, value, source, note, created_at, updated_at, created_by, updated_by)
     select p.signal_id, s.area, p.bucket, p.value, ${source}::text, null, ${now}::timestamptz, ${now}::timestamptz, null, null
       from unnest(${rows.map((p) => p.signal_id)}::text[], ${rows.map((p) => p.bucket)}::timestamptz[], ${rows.map((p) => p.value)}::float8[]) as p(signal_id, bucket, value)
       join ${sql.table('signals')} s on s.id = p.signal_id
     on conflict (signal_id, bucket, source) ${conflict}`.execute(db)
}

/** Rows of both classes, each with its own conflict rule. */
async function insertRows(tx: Tx, rows: SignalRow[]): Promise<void> {
  const of = (source: 'live' | 'backfill') =>
    rows.filter((r) => (r.source ?? 'live') === source).map((r) => ({ signal_id: r.signal_id, bucket: dayBucket(r.date), value: r.value }))
  await insertPoints(tx, of('live'), 'live')
  await insertPoints(tx, of('backfill'), 'backfill')
}

/**
 * Every write to `signal_points` goes through here, on the caller's own login (storage phase 1 W8
 * R3): write on each signal's area is checked first (a readable refusal), then one transaction
 * locks the signals (FOR SHARE, through row security) and refuses when any is gone or no longer in
 * the area it was authorized for. A delete or rebind of a locked signal waits for the write and
 * then carries or removes its points (the foreign key cascades); points copy their signal's area,
 * and row security checks every point row against the frame's write list.
 */
export async function pointWrite<T>(signals: readonly { id: string; area: string }[], fn: (tx: Tx) => Promise<T>): Promise<T> {
  const want = new Map(signals.map((s) => [s.id, s.area]))
  for (const area of new Set(want.values())) requireReachArea(area, 'write')
  return withWrite(async (tx) => {
    if (want.size > 0) {
      // FOR SHARE (in id order): a delete or rebind of these signals waits for this write, so no
      // point is dropped by the join below and none is left behind. Row security applies the
      // UPDATE policy to a locking read too: write on each signal's area, at the database.
      const rows = await db.selectFrom('signals').select(['id', 'area']).where('id', '=', anyOf([...want.keys()])).orderBy('id').forShare().execute()
      const found = new Map(rows.map((r) => [r.id, r.area]))
      const off = [...want].filter(([id, area]) => found.get(id) !== area).map(([id]) => id).sort()
      if (off.length > 0) {
        throw new Error(`refused: ${off.length} signal(s) are gone or belong to another area than this write was authorized for (${off.slice(0, 5).join(', ')}${off.length > 5 ? ', ...' : ''})`)
      }
    }
    return fn(tx)
  }, CORE)
}

/** The rows' signals, owned by `area`, after registering any new ones under it. */
async function registerOwned(rows: SignalRow[], area: string): Promise<{ id: string; area: string }[]> {
  // Authorized even for an empty batch: a channel replace with no rows still deletes (BOX-Review).
  requireReachArea(storedArea(area), 'write')
  await autoRegisterDefinitions(rows, area)
  return [...new Set(rows.map((r) => r.signal_id))].map((id) => ({ id, area }))
}

function changed(area: string): void {
  emitAreaChange('table:signals', [area])
  emitAreaChange('table:signal_points', [area])
}

/**
 * A channel deriver's output: replace the `live` rows of the channel's derived signals, then write
 * the given rows (`backfill` rows only fill their class). New signals are owned by `area`, the
 * writing feature. Only signals the derivers own
 * (`source = 'derived'` with no tracker binding) are cleared, so a provider sync, a Box
 * tracker or an increment signal in the same channel keeps its rows.
 */
export async function replaceChannelSignals(channel: string, rows: SignalRow[], area: string): Promise<void> {
  await pointWrite(await registerOwned(rows, area), async (tx) => {
    await db.deleteFrom('signal_points')
      .where('source', '=', 'live')
      .where('signal_id', 'in', (eb) => eb.selectFrom('signals').select('id')
        .where('channel', '=', channel).where('source', '=', 'derived').where('tracker_key', 'is', null).where('area', '=', area))
      .execute()
    await insertRows(tx, rows)
    changed(area)
  })
}

/**
 * Replace one signal's machine rows (`live` and `backfill`). For a derived signal re-derived on its
 * own, outside its channel's deriver.
 */
export async function replaceSignalRows(signalId: string, rows: SignalRow[], area: string): Promise<void> {
  await pointWrite([...(await registerOwned(rows, area)), { id: signalId, area }], async (tx) => {
    await db.deleteFrom('signal_points').where('signal_id', '=', signalId).where('source', 'in', ['live', 'backfill']).execute()
    await insertRows(tx, rows)
    changed(area)
  })
}

/** Write reconstructed history. Only fills: an existing backfill bucket keeps its value. */
export async function upsertBackfillSignals(rows: SignalRow[], area: string): Promise<void> {
  await pointWrite(await registerOwned(rows, area), async (tx) => {
    await insertRows(tx, rows.map((r) => ({ ...r, source: 'backfill' as const })))
    changed(area)
  })
}
