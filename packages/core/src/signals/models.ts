// Core's signal tables: raw snapshots, the signal set (definitions, points, boards) and the
// data-source registry. Declared with CORE_MODELS (warehouse/core-models.ts).

import type { ModelSpec } from '../warehouse/model.js'
import {
  SIGNAL_ACCUMULATIONS,
  SIGNAL_DIRECTIONS,
  SIGNAL_INTERVALS,
  SIGNAL_POINT_SOURCES,
  SIGNAL_SOURCES,
} from './types.js'
import { DATA_SOURCE_STATUSES, SYNC_STATUSES } from './sources/types.js'

/** Raw verbatim pulls - one row per (channel, date), payload kept as-is. */
export const SNAPSHOTS: ModelSpec = {
  table: 'snapshots',
  pk: ['channel', 'snapshot_date'],
  columns: {
    channel: { kind: 'text' },
    snapshot_date: { kind: 'date' },
    fetched_at: { kind: 'timestamp' },
    payload: { kind: 'json' },
  },
}

/**
 * The signal registry - one row per signal (signals/types.ts). Identity and curation live here,
 * the history in `signal_points`. Derived signals auto-register on derive (never overwriting an
 * existing row); manual signals are created by admins and can exist with no data at all. What a
 * number should reach, and by when, is a planning goal, not a column here.
 */
export const SIGNAL_DEFINITIONS: ModelSpec = {
  table: 'signals',
  pk: ['id'],
  columns: {
    id: { kind: 'text' },
    label: { kind: 'text' },
    signal_group: { kind: 'text', default: "''" },
    unit: { kind: 'text', nullable: true },
    channel: { kind: 'text' },
    source: { kind: 'text', default: "'manual'", enum: SIGNAL_SOURCES },
    interval: { kind: 'text', default: "'day'", enum: SIGNAL_INTERVALS },
    accumulation: { kind: 'text', default: "'snapshot'", enum: SIGNAL_ACCUMULATIONS },
    direction: { kind: 'text', default: "'up'", enum: SIGNAL_DIRECTIONS },
    owner: { kind: 'text', nullable: true },
    description: { kind: 'text', default: "''" },
    depends_on: { kind: 'json', default: "'[]'" },
    sort: { kind: 'int', default: '0' },
    // The provider binding (Track C). Both-or-neither, enforced in upsertSignalDefinition:
    // connectedness IS `data_source_id != null`, which is why `source` stays derived|manual and
    // never grew a third value - one fact in two fields would only invite drift.
    data_source_id: { kind: 'text', nullable: true },
    measure_key: { kind: 'text', nullable: true },
    // A formula signal's expression (signals/formula.ts); null for an ordinary signal.
    formula: { kind: 'text', nullable: true },
    // Levels worth an event when the signal reaches or crosses them upward (`signal.threshold`),
    // ascending numbers. Edited in the signal dialog.
    thresholds: { kind: 'json', default: "'[]'" },
  },
  timestamps: true,
  audit: true,
}

/**
 * A user-created, user-named INSTANCE of a provider ("Mailer EU" and "Mailer US" are two rows
 * of provider `mailer`, each with its own workspace and its own key). A table rather
 * than a config file - unlike schedules and alert rules - because `signals` references
 * it (refuse-unknown-id validation and delete-reports-bindings both want the two sides
 * transactionally readable), it is CRUD-ed from the UI and wants the record layer's audit stamps,
 * and an edit must be effective immediately rather than at the next boot.
 *
 * SECRETS ARE NOT HERE - not a column, not inside `config`, never in a payload. They stay in the
 * gitignored box.local.json under `credentials → provider → source id → KEY`, read with
 * `credential(channel, account, key)`.
 *
 * The four `last_sync_*` stamps are denormalized on purpose: per-source outcomes are NOT
 * recoverable from `automation_runs`, which records one row per action run while the umbrella
 * sync action covers N sources.
 */
export const DATA_SOURCES: ModelSpec = {
  table: 'data_sources',
  pk: ['id'],
  columns: {
    id: { kind: 'text' }, // user slug; also the credentials account key and the audit-snapshot channel
    provider: { kind: 'text' }, // a PROVIDERS key; unknown providers are refused on write
    label: { kind: 'text' },
    config: { kind: 'json', default: "'{}'" }, // the provider-declared non-secret settings
    // Born `disabled`: a new source is armed only after a supervised first run (the schedules-file
    // posture - everything armed deliberately). The record layer has no bool kind; text enum
    // follows users.status.
    status: { kind: 'text', default: "'disabled'", enum: DATA_SOURCE_STATUSES },
    notes: { kind: 'text', default: "''" },
    last_sync_at: { kind: 'timestamp', nullable: true },
    last_sync_status: { kind: 'text', nullable: true, enum: SYNC_STATUSES },
    last_sync_error: { kind: 'text', nullable: true },
    last_sync_points: { kind: 'int', nullable: true },
  },
  timestamps: true,
  audit: true,
}

/**
 * Every signal's history, at the signal's own grain (`signals.interval`): `bucket` is the
 * naive-UTC start of the interval bucket, floored by the one shared helper (signals/points.ts
 * floorSignalBucket - ISO weeks, Monday start). `source` is part of the PK so live, backfill and
 * manual rows never overwrite each other; reads pick one per bucket (live > backfill > manual), so
 * a shadowed manual point resurfaces if the machine rows retreat.
 */
export const SIGNAL_POINTS: ModelSpec = {
  table: 'signal_points',
  pk: ['signal_id', 'bucket', 'source'],
  columns: {
    signal_id: { kind: 'text' },
    bucket: { kind: 'timestamp' },
    value: { kind: 'float' },
    source: { kind: 'text', default: "'manual'", enum: SIGNAL_POINT_SOURCES },
    note: { kind: 'text', nullable: true },
  },
  timestamps: true,
  audit: true,
}

/**
 * A user-created circuit board: WHICH signals are on it and WHERE each sits. Edges are NOT here -
 * they stay on signals.depends_on (one causal claim, curated once, cycle-checked once); a board is
 * a VIEW onto that graph, and an edge renders when both endpoints are members. `nodes` is a JSON
 * column rather than a join table: it is written whole on every autosave, never queried across
 * boards, and a node carries no attributes worth querying (the depends_on / blocked_by
 * precedent). Positions are TEAM state - never localStorage.
 */
export const SIGNAL_BOARDS: ModelSpec = {
  table: 'signal_boards',
  pk: ['id'],
  columns: {
    id: { kind: 'text' }, // slug, ^[a-z0-9][a-z0-9-]*$ (the data-source id charset)
    label: { kind: 'text' },
    description: { kind: 'text', default: "''" },
    nodes: { kind: 'json', default: "'[]'" }, // [{kind, ref, x, y}] - x/y in flow units, snapped client-side
    sort: { kind: 'int', default: '0' },
  },
  timestamps: true,
  audit: true,
}

export const SIGNAL_MODELS: readonly ModelSpec[] = [
  SNAPSHOTS,
  SIGNAL_DEFINITIONS,
  SIGNAL_POINTS,
  SIGNAL_BOARDS,
  DATA_SOURCES,
]
