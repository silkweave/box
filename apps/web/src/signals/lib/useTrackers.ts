import { createDataStore } from '../../lib/dataStore.ts'
import { trpc } from '../../lib/trpc.ts'

// The Box trackers of the catalogue (core `trackers-list`, which also lists every data source's
// trackers): what the Box can track by itself, each with its parameters. Code, not a table, so the
// list is loaded once per page. The signal dialog's source half reads providers (useSourcesData).

export interface TrackerParamOption {
  value: string
  label: string
}

export interface TrackerParam {
  key: string
  label: string
  kind: 'enum' | 'text' | 'date' | 'user'
  options: TrackerParamOption[]
  required: boolean
  description?: string | null
}

export interface TrackerInfo {
  key: string
  label: string
  unit: string | null
  interval: string
  accumulation: string
  direction: string
  group: string | null
  description: string | null
  params: TrackerParam[]
}

/** The param a level tracker reads its window start from (core `TRACKER_SINCE_PARAM`). */
export const TRACKER_SINCE_PARAM = 'since'

const store = createDataStore<TrackerInfo[]>(() =>
  trpc.signalsTrackers
    .query({})
    .then((d) => (((d as { trackers?: unknown[] }).trackers ?? []) as (TrackerInfo & { origin: string })[]).filter((t) => t.origin === 'box')),
)

/** The registered Box trackers. */
export const useTrackers = (): { data: TrackerInfo[] | null; error: string | null } => store.useData()

/** The required params a binding still lacks, by label (empty when it is complete). */
export function missingTrackerParams(tracker: TrackerInfo, values: Record<string, string>, skip: string[] = []): string[] {
  return tracker.params.filter((p) => p.required && !skip.includes(p.key) && !values[p.key]).map((p) => p.label)
}

/** The params to send: blanks dropped (an omitted optional param), `skip` left out. */
export function trackerParamsPayload(values: Record<string, string>, skip: string[] = []): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([k, v]) => !skip.includes(k) && v !== ''))
}
