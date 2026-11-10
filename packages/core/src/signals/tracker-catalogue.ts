// The one tracker catalogue (MCP `trackers-list`, tRPC `signalsTrackers`): everything a signal can
// be bound to, so a person or an agent picks from one list.
//
//   - Box trackers (`origin: 'box'`, trackers.ts): computed from Box data by a recipe. Bind with
//     `tracker_key` and `tracker_params`, no data source.
//   - Source trackers (`origin: 'source'`): what a connected data source's provider offers, fed by
//     its sync. One entry per data source and tracker; bind with `data_source_id` and `tracker_key`.
//     A data source whose provider is no longer registered offers nothing.
//
// A request sees the Box trackers whose owning area (its feature, auth/owning-area.ts) it can read,
// like the action list: a signal bound to one is stored under that area, and the tracker's
// parameter options read that feature's data in the caller's frame.

import { trackerArea } from '../auth/owning-area.js'
import { canReachArea } from '../request-context.js'
import { readDataSources } from './sources/state.js'
import { findProvider } from './sources/registry.js'
import { listTrackers, trackerOptions, type TrackerOption, type TrackerParamKind } from './trackers.js'
import type { SignalAccumulation, SignalDirection, SignalInterval } from './types.js'

export type TrackerOrigin = 'box' | 'source'

export interface CatalogueTrackerParam {
  key: string
  label: string
  kind: TrackerParamKind
  /** `enum` params: the allowed values, resolved now; [] otherwise. */
  options: TrackerOption[]
  required: boolean
  description: string
}

export interface CatalogueTracker {
  origin: TrackerOrigin
  /** The `tracker_key` a signal binds: `<feature>.<name>` for a Box tracker, the provider's token for a source one. */
  key: string
  label: string
  unit: string | null
  interval: SignalInterval
  accumulation: SignalAccumulation
  direction: SignalDirection
  group: string
  description: string
  params: CatalogueTrackerParam[]
  /** Source trackers: the data source that feeds it, its label and provider. Null for a Box tracker. */
  data_source_id: string | null
  data_source_label: string | null
  provider: string | null
}

/** Box trackers first (by key), then each data source's trackers (by source, then provider order). */
export async function trackerCatalogue(): Promise<CatalogueTracker[]> {
  const out: CatalogueTracker[] = []
  for (const t of listTrackers()) {
    if (!canReachArea(trackerArea(t.key), 'read')) continue
    const params: CatalogueTrackerParam[] = []
    for (const p of t.params) {
      params.push({ key: p.key, label: p.label, kind: p.kind, options: await trackerOptions(p), required: Boolean(p.required), description: p.description ?? '' })
    }
    out.push({
      origin: 'box',
      key: t.key,
      label: t.label,
      unit: t.unit,
      interval: t.interval,
      accumulation: t.accumulation,
      direction: t.direction,
      group: t.group,
      description: t.description,
      params,
      data_source_id: null,
      data_source_label: null,
      provider: null,
    })
  }
  for (const source of await readDataSources()) {
    const provider = findProvider(source.provider)
    if (!provider) continue
    for (const t of provider.trackers) {
      out.push({
        origin: 'source',
        key: t.key,
        label: t.label,
        unit: t.unit,
        interval: t.interval,
        accumulation: t.accumulation,
        direction: t.direction,
        group: t.group,
        description: t.description,
        params: [],
        data_source_id: source.id,
        data_source_label: source.label,
        provider: provider.id,
      })
    }
  }
  return out
}
