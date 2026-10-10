// The provider contract - the boundary between "fetch from an external system" and "everything
// this warehouse does with the numbers". Three nouns, pinned:
//
//   • Provider    - CODE. One module per external system (a mailing platform; a payments
//                   processor), shipped as a workspace package and registered statically in
//                   core's PROVIDERS map. The template ships none - see the note on PROVIDERS. It
//                   declares its non-secret config fields, its required credential key NAMES, its
//                   measure catalogue, and a pull().
//   • Data source - a RECORD. A user-created, user-named instance of a provider ("Mailer EU"
//                   = provider mailer + config {workspace: 'acme-eu'} + its own credentials). Two
//                   workspaces are two rows of the same provider. Lives in core's `data_sources`.
//   • Measure      - a CATALOGUE ENTRY. One data point a provider offers ('DELIVERED'), with
//                   defaults for a signal bound to it. A measure exists whether or not anyone
//                   subscribes; a signal becomes connected by BINDING (data_source_id, measure_key).
//
// pull() is a PURE FETCHER - a Promise plus a progress callback, never an async generator and
// never a writer. The sync engine in core owns the progress stream, the audit snapshot and every
// warehouse write, which keeps write discipline in one reviewed place and keeps a provider at
// roughly a hundred lines of fetch-and-map. Nothing here imports the warehouse, the credentials
// file, or the Box io layer: a provider is handed its config and its resolved secrets.
//
// The ONE thing a pull can cause to be written outside the warehouse is its own rotated secret,
// via ctx.saveCredentials - and even that is the engine's write, not the provider's. See the
// callback's doc comment for why a rotating credential cannot wait for pull() to return.

import type { SignalAccumulation, SignalDirection, SignalInterval } from './vocabulary.js'

/** One data point the provider offers, with the defaults a NEW signal bound to it starts from. */
export interface ProviderMeasure {
  /** The provider's NATIVE token, verbatim ('FIRST_MESSAGE', uppercase and all). Measure keys never
   *  enter the signal-id namespace - they live only here and in `signals.measure_key` -
   *  so imposing this repo's lowercase-slug convention would buy a mapping layer and nothing else. */
  key: string
  /** Human label ('First messages') - prefills the signal's label; the user can override it. */
  label: string
  unit: string | null
  interval: SignalInterval
  accumulation: SignalAccumulation
  direction: SignalDirection
  /** Default `signal_group` ('Outreach') - the dashboard section within the channel. */
  group: string
  description: string
}

/** One non-secret setting an instance of this provider needs (the space id, a base URL override). */
export interface ProviderConfigField {
  key: string
  label: string
  required: boolean
  help?: string
}

/** The data-source identity a pull is given - never the row's health stamps or audit columns. */
export interface DataSourceRef {
  id: string
  provider: string
  label: string
  /** The provider-declared non-secret settings, as stored. Validate what you read. */
  config: Record<string, string>
}

/** What a pull returns: full-precision observations plus the raw payload, for the audit snapshot. */
export interface ProviderPull {
  /** Observations at whatever precision the remote serves; the sync engine floors each one per the
   *  BOUND SIGNAL's interval, so a provider never does date math beyond parsing. */
  points: { measure_key: string; at: string; value: number }[]
  /** The raw remote payload, persisted verbatim as the day's audit snapshot. Nothing reads it
   *  automatically - it exists so a bad mapping can be diagnosed and points rebuilt offline. */
  raw: unknown
  /**
   * The time range this pull actually covers, when the provider knows it (it usually does - it
   * asked for it). The engine replaces live rows across exactly this window, so a measure that was
   * corrected DOWN to zero loses its stale row even though it returned no observation. Omit it and
   * the engine falls back to "from the earliest observation in `points`", which cannot clear a
   * quiet leading edge. `to` omitted = open-ended.
   */
  window?: { from: string; to?: string }
}

export interface ProviderPullContext {
  source: DataSourceRef
  /** The provider's declared credential keys, already resolved and non-empty. */
  credentials: Record<string, string>
  /** Only the measure keys that actually have subscribers - an unsubscribed measure is never fetched
   *  into anything. May be a subset of the catalogue; never empty (the engine short-circuits). */
  measures: string[]
  /** Emit a run-log line. The engine tags it with the source id and funnels it into the run. */
  progress: (message: string) => void
  /**
   * Persist new values for this source's OWN credential keys, immediately. For sources whose
   * secret ROTATES on use - a refresh token that is consumed and replaced by the very call that
   * mints a bearer - where "the stored credential is now dead" becomes true mid-pull.
   *
   * It is a callback rather than a field on ProviderPull deliberately: by the time a pull returns,
   * a rotation has already happened, and a later step throwing would strand the source on a token
   * the remote has already retired. So a provider calls this the instant it rotates, BEFORE doing
   * anything that can fail, and the sync engine still owns the only write (the same discipline
   * that keeps warehouse writes in one reviewed place).
   *
   * Keys are the provider's own declared `credentials`; anything else is refused. The write is a
   * read-modify-write of that one channel/account entry - it never touches another source's keys.
   * Providers whose credentials are static (an API key) never call this.
   */
  saveCredentials: (updates: Record<string, string>) => Promise<void>
  /** USD exchange rates, supplied by core (signals report money in USD). */
  fx: FxRates
}

/** One day's rate: USD per one unit of a currency. */
export interface FxRate {
  rate: number
  /** The day the rate was published (on or before the day it serves: weekends use Friday's). */
  rateDate: string
  /** Where it came from, e.g. `ecb`. */
  source: string
}

export interface FxRates {
  /**
   * The USD rate of `currency` (ISO 4217, any case) for each UTC day (YYYY-MM-DD): the reference
   * rate published on that day or the last one before it. USD maps to 1. Throws, naming the
   * currency and days, when a rate cannot be had; a provider never falls back to 1.
   */
  usdRates(currency: string, days: readonly string[]): Promise<Map<string, FxRate>>
}

export interface Provider {
  /** Stable id - doubles as the credentials.json channel key and the default signal channel. */
  id: string
  label: string
  description: string
  config: ProviderConfigField[]
  /** Credential key NAMES only, never values: ['MAILER_API_KEY']. */
  credentials: string[]
  measures: ProviderMeasure[]
  pull(ctx: ProviderPullContext): Promise<ProviderPull>
}
