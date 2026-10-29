/**
 * A signal channel id. Open: any feature may write signals on a channel of its own, so the app
 * knows labels for the common ones (CHANNEL_LABEL) and title-cases the rest.
 */
export type Channel = string

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
  /** When the signal was archived (hidden from pickers and the Signals page, still readable), or null. */
  archived_at?: string | null
  /** Owning users.id, resolved server-side (definition first, then the signal-owner settings). */
  owner: string | null
  interval: SignalInterval
  accumulation: SignalAccumulation
  source: SignalSource
  direction: SignalDirection
  description: string
  depends_on: string[]
  /** The data source whose sync owns this signal's live points; null = not connected. Both this
   *  and `measure_key` are set together - connectedness IS `data_source_id != null`. */
  data_source_id: string | null
  measure_key: string | null
  /** Parameters of an in-Box measure binding (`measure_key` with no `data_source_id`); `{}` otherwise. */
  measure_params: Record<string, string>
  /** The formula this signal's points are computed from (null = an ordinary signal). A manual
   *  point on a formula signal overrides the computed value of its bucket. */
  formula: string | null
  /** Levels that record a `signal.threshold` event when reached or crossed upward, ascending. */
  thresholds: number[]
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

/** Labels for the channels whose display name is not their title-cased id. */
export const CHANNEL_LABEL: Record<Channel, string> = {
  github: 'GitHub',
  hackernews: 'Hacker News',
  npm: 'npm',
  reddit: 'Reddit',
  blog: 'Blog',
  x: 'X',
  linkedin: 'LinkedIn',
  substack: 'Substack',
  business: 'Business',
}

// Account-scoped channels ('github@dan') group under their base channel in the UI: one sidebar
// entry per base, account sections within the canvas. These helpers are the single place that
// knows the '@' convention on the client.

/** 'github@dan' → 'github'; plain channels pass through. */
export const baseChannel = (c: string): Channel => c.split('@')[0] ?? c

/** 'github@dan' → 'dan'; null for plain channels. */
export const channelAccount = (c: string): string | null => c.split('@')[1] ?? null

/** Display label, account-aware: 'github' → 'GitHub', 'github@dan' → 'GitHub · dan'. */
export function channelLabel(c: string): string {
  const id = baseChannel(c)
  const base = CHANNEL_LABEL[id] ?? id.charAt(0).toUpperCase() + id.slice(1)
  const account = channelAccount(c)
  return account ? `${base} · ${account}` : base
}

/** Does a signal channel belong under a channel route param? Base params ('github') match every
 *  account variant; account params ('github@dan') match exactly. */
export function inChannel(signalChannel: string, param: string): boolean {
  return param.includes('@') ? signalChannel === param : baseChannel(signalChannel) === param
}
