// Must stay a superset of core's DERIVED_CHANNELS (signals/derive.ts) plus the channels only the
// app writes by hand. `linkedin` and `substack` are derived channels and were missing here until
// 2026-09-14, which rendered their ids raw wherever CHANNEL_LABEL was consulted.
export type Channel =
  | 'github'
  | 'hackernews'
  | 'npm'
  | 'reddit'
  | 'blog'
  | 'x'
  | 'linkedin'
  | 'substack'
  | 'content'
  | 'business'

export interface Point {
  date: string
  value: number
}

// Definition vocabularies, mirroring @silkweave/box-core signals/types.ts (the payload is cast, not shared).
export type SignalSource = 'derived' | 'manual'
export type SignalInterval = 'hour' | 'day' | 'week' | 'month'
export type SignalAccumulation = 'snapshot' | 'increment'
export type SignalDirection = 'up' | 'down'
export const SIGNAL_INTERVALS: SignalInterval[] = ['hour', 'day', 'week', 'month']
export const SIGNAL_ACCUMULATIONS: SignalAccumulation[] = ['snapshot', 'increment']
export const SIGNAL_DIRECTIONS: SignalDirection[] = ['up', 'down']

export type DataSourceStatus = 'enabled' | 'disabled'
export type SyncStatus = 'success' | 'error'

/** The signal's own standing goal (distinct from an initiative's campaign target). */
export interface SignalTarget {
  value: number
  by_date?: string
  baseline?: number
  /** When the baseline was observed (stamped server-side) - the anchor of the linear-pace check. */
  since?: string
}

/**
 * Where a signal stands against its own target, computed server-side (core signalHealth) so the
 * cards, the circuit board and any future alert rule read ONE implementation. `no_target` is the
 * common case and is not a failure; `off_track` means something OBSERVED says so (deadline passed,
 * pace behind, or moving away from the baseline).
 */
export type SignalHealth = 'no_target' | 'no_data' | 'on_track' | 'off_track' | 'met'

/**
 * Period aggregates, computed server-side over the FULL point store - deliberately not derivable
 * from `points[]`, which is windowed to the trailing 90 days for sub-daily signals. Semantics per
 * `accumulation`: increment = SUM of the buckets in the window; snapshot = the LAST value in it.
 * Null = no data in the window. Windows are UTC-day aligned: `yesterday` is the last complete UTC
 * day, `last_7d` the 7 complete days before today, `month_to_date` includes today so far.
 */
export interface SignalAggregates {
  all_time: number | null
  yesterday: number | null
  month_to_date: number | null
  last_7d: number | null
}

/**
 * One signal in the payload: identity/curation from the `signals` registry (or, for an
 * unregistered straggler, the derived rows' denormalized strings) plus its point history. A
 * definition with no data yet ships with `points: []` - every consumer must render that sanely.
 */
export interface Signal {
  id: string
  channel: Channel
  label: string
  group: string
  unit?: string
  /** Owning users.id, resolved server-side (definition first, then config/signal-owners.json). */
  owner: string | null
  interval: SignalInterval
  accumulation: SignalAccumulation
  source: SignalSource
  direction: SignalDirection
  description: string
  depends_on: string[]
  target: SignalTarget | null
  health: SignalHealth
  /** The bucket health was judged on (increment signals skip the still-filling one); null = no data. */
  health_at: string | null
  /** The data source whose sync owns this signal's live points; null = not connected. Both this
   *  and `measure_key` are set together - connectedness IS `data_source_id != null`. */
  data_source_id: string | null
  measure_key: string | null
  aggregates: SignalAggregates
  points: Point[]
}

/** The connection health carried alongside the signal, so a chip can say "synced 2 hours ago"
 *  without a second round-trip. A superset of `data-sources` for the fields the signals views need. */
export interface SignalDataSource {
  id: string
  provider: string
  label: string
  status: DataSourceStatus
  last_sync_at: string | null
  last_sync_status: SyncStatus | null
}

export interface SignalsData {
  generatedAt: string
  dates: string[]
  channels: Channel[]
  signals: Signal[]
  sources: SignalDataSource[]
}

/** One manual point row from `signalsPoints` (the detail page's editor read). */
export interface SignalPointRow {
  /** ISO-Z start of the interval bucket. */
  bucket: string
  value: number
  note: string | null
  /** The live value currently overriding this manual point; null = the manual value renders.
   *  A shadowed point is surfaced, never hidden - it resurfaces if the live source retreats. */
  shadowed_by: number | null
  updated_at: string
  created_by: string | null
  updated_by: string | null
}

export interface SignalPointsPayload {
  signal_id: string
  interval: SignalInterval
  accumulation: SignalAccumulation
  generatedAt: string
  points: SignalPointRow[]
}

export const CHANNEL_LABEL: Record<Channel, string> = {
  github: 'GitHub',
  hackernews: 'Hacker News',
  npm: 'npm',
  reddit: 'Reddit',
  blog: 'Blog',
  x: 'X',
  linkedin: 'LinkedIn',
  substack: 'Substack',
  content: 'Content',
  business: 'Business',
}

// Account-scoped channels ('github@dan') group under their base channel in the UI: one sidebar
// entry per base, account sections within the canvas. These helpers are the single place that
// knows the '@' convention on the client.

/** 'github@dan' → 'github'; plain channels pass through. */
export const baseChannel = (c: string): Channel => (c.split('@')[0] ?? c) as Channel

/** 'github@dan' → 'dan'; null for plain channels. */
export const channelAccount = (c: string): string | null => c.split('@')[1] ?? null

/** Display label, account-aware: 'github' → 'GitHub', 'github@dan' → 'GitHub · dan'. */
export function channelLabel(c: string): string {
  const base = CHANNEL_LABEL[baseChannel(c)] ?? baseChannel(c)
  const account = channelAccount(c)
  return account ? `${base} · ${account}` : base
}

/** Does a signal channel belong under a channel route param? Base params ('github') match every
 *  account variant; account params ('github@dan') match exactly. */
export function inChannel(signalChannel: string, param: string): boolean {
  return param.includes('@') ? signalChannel === param : baseChannel(signalChannel) === param
}
