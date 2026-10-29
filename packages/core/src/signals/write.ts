// The row writers for derived and backfilled history: `snapshots` (raw pull payloads) and the
// machine classes of `signal_points` (`live`, `backfill`). Derivers and backfills hand over tidy
// day-grain rows; every row's signal is auto-registered first, then written at its day's bucket
// (reads re-floor to the signal's interval, so an edited interval needs no rewrite).
//
// Raw SQL rather than the record layer: the replace is a scoped DELETE plus per-class conflict
// rules, which the partial upsert cannot express.

import { ensureSchema, withWrite } from '../warehouse/db.js'
import { toNaiveUtc } from '../warehouse/model.js'
import { emitChange } from '../changes.js'
import { autoRegisterDefinitions } from './definitions.js'

/**
 * UPSERT a raw pull payload. Keyed on (channel, date), so re-running a pull for the same date
 * overwrites in place.
 */
export async function upsertSnapshot(channel: string, date: string, payload: unknown): Promise<void> {
  await ensureSchema()
  await withWrite(async (conn) => {
    await conn.run(
      `INSERT INTO snapshots (channel, snapshot_date, fetched_at, payload)
       VALUES (?, ?::DATE, now(), ?::JSON)
       ON CONFLICT (channel, snapshot_date)
       DO UPDATE SET fetched_at = excluded.fetched_at, payload = excluded.payload`,
      [channel, date, JSON.stringify(payload)],
    )
  })
  emitChange('table:snapshots')
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

type Conn = Parameters<Parameters<typeof withWrite>[0]>[0]

const utcNow = (): string => toNaiveUtc(new Date().toISOString())
const dayBucket = (date: string): string => toNaiveUtc(`${date.slice(0, 10)}T00:00:00.000Z`)

/** Insert rows of one class: `live` overwrites its own bucket, `backfill` keeps the first value. */
async function insertRows(conn: Conn, rows: SignalRow[], now: string): Promise<void> {
  for (const r of rows) {
    const source = r.source ?? 'live'
    await conn.run(
      `INSERT INTO signal_points (signal_id, bucket, value, source, note, created_at, updated_at, created_by, updated_by)
       VALUES (?, ?::TIMESTAMP, ?, ?, NULL, ?::TIMESTAMP, ?::TIMESTAMP, NULL, NULL)
       ON CONFLICT (signal_id, bucket, source) ${source === 'live' ? 'DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at' : 'DO NOTHING'}`,
      [r.signal_id, dayBucket(r.date), r.value, source, now, now],
    )
  }
}

function changed(): void {
  emitChange('table:signals')
  emitChange('table:signal_points')
}

/**
 * A channel deriver's output: replace the `live` rows of the channel's derived signals, then write
 * the given rows (`backfill` rows only fill their class). Only signals the derivers own
 * (`source = 'derived'` with no measure binding) are cleared, so a provider sync, an in-Box
 * measure or an increment signal in the same channel keeps its rows.
 */
export async function replaceChannelSignals(channel: string, rows: SignalRow[]): Promise<void> {
  await autoRegisterDefinitions(rows)
  await ensureSchema()
  const now = utcNow()
  await withWrite(async (conn) => {
    await conn.run(
      `DELETE FROM signal_points WHERE source = 'live'
         AND signal_id IN (SELECT id FROM signals WHERE channel = ? AND source = 'derived' AND measure_key IS NULL)`,
      [channel],
    )
    await insertRows(conn, rows, now)
  })
  changed()
}

/**
 * Replace one signal's machine rows (`live` and `backfill`). For a derived signal re-derived on its
 * own, outside its channel's deriver.
 */
export async function replaceSignalRows(signalId: string, rows: SignalRow[]): Promise<void> {
  await autoRegisterDefinitions(rows)
  await ensureSchema()
  const now = utcNow()
  await withWrite(async (conn) => {
    await conn.run(`DELETE FROM signal_points WHERE signal_id = ? AND source IN ('live', 'backfill')`, [signalId])
    await insertRows(conn, rows, now)
  })
  changed()
}

/** Write reconstructed history. Only fills: an existing backfill bucket keeps its value. */
export async function upsertBackfillSignals(rows: SignalRow[]): Promise<void> {
  await autoRegisterDefinitions(rows)
  await ensureSchema()
  const now = utcNow()
  await withWrite(async (conn) => {
    await insertRows(conn, rows.map((r) => ({ ...r, source: 'backfill' as const })), now)
  })
  changed()
}
