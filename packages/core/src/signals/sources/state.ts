// Data-source CRUD. Row↔domain plumbing comes from the record layer (warehouse/model.ts) driven
// by the DATA_SOURCES spec; this module keeps the domain semantics: id validation (the id is three
// keys at once - see sources/types.ts), config validation against the provider's declared fields,
// the delete report, and the health stamps the sync engine writes.

import { canAccess } from '../../request-context.js'
import { db } from '../../warehouse/core-db.js'
import { deleteRecord, readRecord, upsertRecord } from '../../warehouse/model.js'
import { DATA_SOURCES } from '../models.js'
import { credential } from '../../credentials.js'
import { findProvider, findProviderTracker, requireProvider } from './registry.js'
import type { DataSource, DataSourceDeleteReport, DataSourceInput, DataSourceView, SyncStatus } from './types.js'

// Slug charset, stricter than the signal-id one: this string becomes a JSON object key in
// box.local.json credentials and a `snapshots.channel` value, so dots and slashes buy nothing and confuse
// both. Same shape as a schedule id.
const SOURCE_ID = /^[a-z0-9][a-z0-9-]*$/

/** JSON columns can read back null on rows written outside the record layer; hand callers an object. */
const bag = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {}
const norm = (s: DataSource): DataSource => ({ ...s, config: bag(s.config) })

// --- reads ----------------------------------------------------------------------------------------

// Data sources belong to the `signals` area (W8 R1): one area for the whole table, so no row
// security; these reads check it. A caller without signals read sees none (not an error: a board or
// a signal list that mentions sources simply has none to show).
const sourcesReadable = (): boolean => canAccess('signals', 'read')

/** Every data source, id-sorted; none without signals read. */
export async function readDataSources(): Promise<DataSource[]> {
  if (!sourcesReadable()) return []
  return ((await db.selectFrom('data_sources').selectAll().orderBy('id').execute()) as DataSource[]).map(norm)
}

/** One data source, or null (also without signals read). */
export async function readDataSource(id: string): Promise<DataSource | null> {
  if (!sourcesReadable()) return null
  const s = await readRecord<DataSource>(DATA_SOURCES, { id })
  return s ? norm(s) : null
}

/** One source, or a refusal naming it - the shared guard for sync and the binding validator. */
export async function requireDataSource(id: string): Promise<DataSource> {
  const s = await readDataSource(id)
  if (!s) throw new Error(`data source ${id} not found`)
  return s
}

/** Every signal bound to a source, with the tracker each one subscribes to - the subscription set. */
export async function readSourceBindings(sourceId: string): Promise<{ signal_id: string; tracker_key: string }[]> {
  const rows = await db.selectFrom('signals').select(['id', 'tracker_key']).where('data_source_id', '=', sourceId).orderBy('sort').orderBy('id').execute()
  return rows.filter((r) => !!r.tracker_key).map((r) => ({ signal_id: r.id, tracker_key: r.tracker_key! }))
}

/** Every binding, grouped by source id - one query for the list view. */
async function readAllBindings(): Promise<Map<string, { signal_id: string; tracker_key: string }[]>> {
  const rows = await db.selectFrom('signals').select(['id', 'data_source_id', 'tracker_key']).where('data_source_id', 'is not', null).orderBy('sort').orderBy('id').execute()
  const out = new Map<string, { signal_id: string; tracker_key: string }[]>()
  for (const r of rows) {
    if (!r.data_source_id || !r.tracker_key) continue
    const list = out.get(r.data_source_id) ?? []
    list.push({ signal_id: r.id, tracker_key: r.tracker_key })
    out.set(r.data_source_id, list)
  }
  return out
}

/**
 * The API read surface: each source with its provider label, per-key credential PRESENCE (never
 * values - there is no code path in this repo that reports a secret), its bound signals, and any
 * binding naming a tracker the provider no longer offers.
 */
export async function readDataSourceViews(): Promise<DataSourceView[]> {
  const [sources, bindings] = await Promise.all([readDataSources(), readAllBindings()])
  return sources.map((s) => {
    const provider = findProvider(s.provider)
    const bound = bindings.get(s.id) ?? []
    return {
      ...s,
      provider_label: provider?.label ?? null,
      credentials: Object.fromEntries(
        (provider?.credentials ?? []).map((key) => [key, credential(s.provider, s.id, key) !== undefined]),
      ),
      bound_signals: bound.map((b) => b.signal_id),
      dead_trackers: provider
        ? bound.filter((b) => !findProviderTracker(provider, b.tracker_key)).map((b) => ({ signal_id: b.signal_id, tracker_key: b.tracker_key }))
        : [],
    }
  })
}

// --- writes ---------------------------------------------------------------------------------------

/**
 * Validate a config bag against the provider's declared fields: required fields must be non-empty,
 * and an undeclared key is refused rather than silently stored - a typo'd `spaceId` would otherwise
 * sit there looking configured while the pull failed on a missing `space`.
 */
function normalizeConfig(providerId: string, raw: Record<string, string>): Record<string, string> {
  const provider = requireProvider(providerId)
  const declared = new Set(provider.config.map((f) => f.key))
  const unknown = Object.keys(raw).filter((k) => !declared.has(k))
  if (unknown.length > 0) {
    throw new Error(
      `provider ${providerId} declares no config field(s) ${unknown.join(', ')} - valid: ${[...declared].join(', ') || '(none)'}`,
    )
  }
  const config: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') throw new Error(`data source config.${k} must be a string`)
    if (v.trim()) config[k] = v.trim()
  }
  const missing = provider.config.filter((f) => f.required && !config[f.key]).map((f) => f.key)
  if (missing.length > 0) throw new Error(`provider ${providerId} requires config field(s) ${missing.join(', ')}`)
  return config
}

/**
 * Create or update a data source. Partial: provided fields overwrite, the rest keep their stored
 * value. A new source is born `disabled` (the DATA_SOURCES default) - it is armed only after a
 * supervised `source-sync`, so a wrong space id or a stale key surfaces in a run log rather than
 * in a cron failure at 07:43.
 */
export async function upsertDataSource(input: DataSourceInput): Promise<DataSource> {
  if (!SOURCE_ID.test(input.id)) {
    throw new Error(`invalid data source id "${input.id}" (lowercase a-z 0-9 and dashes; must start alphanumeric)`)
  }
  const prev = await readDataSource(input.id)
  if (!prev) {
    if (!input.provider) throw new Error(`data source ${input.id}: provider is required on create`)
    // The id doubles as the audit-snapshot channel key, so a new source may not take an id some
    // channel pull already writes snapshots under - two writers on one `snapshots.channel` would
    // silently overwrite each other's daily payload. (Checked against real rows rather than the
    // derived-channel list so it also catches snapshot-only channels like reddit-radar.)
    const clash = await db.selectFrom('snapshots').select((eb) => eb.fn.countAll<number>().as('n')).where('channel', '=', input.id).executeTakeFirstOrThrow()
    if (clash.n > 0) {
      throw new Error(
        `data source id "${input.id}" already keys ${clash.n} snapshot row(s) from another ingest - the id is also this source's audit-snapshot channel; pick another`,
      )
    }
  }
  const providerId = input.provider ?? prev!.provider
  if (input.provider && prev && input.provider !== prev.provider) {
    throw new Error(
      `data source ${input.id} is a ${prev.provider} source - changing the provider would strand its config and credentials; delete it and create a new one`,
    )
  }
  requireProvider(providerId)
  const config = input.config !== undefined ? normalizeConfig(providerId, input.config) : bag(prev?.config)

  const row = await upsertRecord<DataSource>(
    DATA_SOURCES,
    {
      id: input.id,
      provider: providerId,
      label: input.label ?? prev?.label ?? input.id,
      config,
      status: input.status ?? prev?.status ?? 'disabled',
      notes: input.notes ?? prev?.notes ?? '',
      ...(input.actor ? { actor: input.actor } : {}),
    },
    { prev },
  )
  return norm(row)
}

/**
 * Delete a data source. Bindings are REPORTED, never cleared: a signal whose source is gone keeps
 * its points, stops refreshing, and shows "source deleted" on its connection chip - which is
 * exactly the row a human should re-point or unbind. The credentials entry is hand-managed,
 * so the report says so rather than pretending the secret went away with the row.
 */
export async function deleteDataSource(id: string): Promise<DataSourceDeleteReport> {
  const source = await requireDataSource(id)
  const bound = (await readSourceBindings(id)).map((b) => b.signal_id)
  await deleteRecord(DATA_SOURCES, { id })

  const warnings: string[] = []
  if (bound.length > 0) {
    warnings.push(
      `signal(s) ${bound.join(', ')} are still bound to ${id} - their points are kept but will not refresh; re-point or unbind them (signal-upsert with data_source_id: '')`,
    )
  }
  warnings.push(`credentials for ${source.provider}/${id} are hand-managed in box.local.json and were NOT removed`)
  return { id, bound_signals: bound, warnings }
}

/** Stamp the outcome of a sync attempt onto the row (the sync engine's only write here). */
export async function stampSync(
  id: string,
  outcome: { status: SyncStatus; at: string; points?: number; error?: string },
): Promise<void> {
  await upsertRecord<DataSource>(DATA_SOURCES, {
    id,
    last_sync_at: outcome.at,
    last_sync_status: outcome.status,
    last_sync_error: outcome.error ?? null,
    last_sync_points: outcome.points ?? null,
  })
}
