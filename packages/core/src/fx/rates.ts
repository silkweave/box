// USD exchange rates for signals and the CRM: ECB reference rates (via the Frankfurter API), one
// stored row per currency and calendar day, so a converted number is reproducible and auditable.
//
// A day's rate is the rate published that day or, on a weekend or holiday, the last one before it.
// A row is stored only once it is final: the day has its own published rate, or a later published
// rate exists (so the gap is known to be a non-publishing day). Today, before the ECB publishes, is
// served from the previous rate and fetched again next time. Stored rows never change.
//
// docs/SIGNALS.md "Currencies".

import type { FxRate, FxRates } from '@silkweave/box-provider-kit'
import type { ModelSpec } from '../warehouse/model.js'
import { ensureSchema, withRead, withWrite } from '../warehouse/db.js'

export const FX_RATES: ModelSpec = {
  table: 'fx_rates',
  pk: ['currency', 'day'],
  columns: {
    /** ISO 4217, upper case. */
    currency: { kind: 'text' },
    /** The calendar day the rate serves. */
    day: { kind: 'date' },
    /** USD per one unit of `currency`. */
    usd_rate: { kind: 'float' },
    /** The day the rate was published (equal to `day` on a publishing day). */
    rate_date: { kind: 'date' },
    source: { kind: 'text', default: "'ecb'" },
    fetched_at: { kind: 'timestamp', default: 'now()' },
  },
}

const ECB_URL = 'https://api.frankfurter.dev/v1'
/** How far before the first wanted day to look for a published rate (covers long holidays). */
const LOOKBACK_DAYS = 10

const DAY = /^\d{4}-\d{2}-\d{2}$/
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** Published rates for a range: day -> USD per unit. Injectable for tests. */
export type PublishedRates = (currency: string, from: string, to: string) => Promise<Map<string, number>>

/** ECB reference rates from Frankfurter, publishing days only. */
export const ecbPublishedRates: PublishedRates = async (currency, from, to) => {
  const url = `${ECB_URL}/${from}..${to}?base=${encodeURIComponent(currency)}&symbols=USD`
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`ECB rates for ${currency} ${from}..${to}: HTTP ${res.status}`)
  const body = (await res.json()) as { rates?: Record<string, { USD?: number }> }
  const out = new Map<string, number>()
  for (const [day, r] of Object.entries(body.rates ?? {})) if (typeof r.USD === 'number') out.set(day, r.USD)
  return out
}

/**
 * Resolve each calendar day of `days` against published rates (sorted ascending): the rate of the
 * day or the last one before it. `final` says whether it can be stored. Pure, for tests.
 */
export function resolveDays(days: readonly string[], published: Map<string, number>): Map<string, FxRate & { final: boolean }> {
  const pubDays = [...published.keys()].sort()
  const out = new Map<string, FxRate & { final: boolean }>()
  for (const day of days) {
    let rateDate: string | null = null
    for (const p of pubDays) {
      if (p > day) break
      rateDate = p
    }
    if (rateDate === null) continue
    const final = rateDate === day || pubDays.some((p) => p > day)
    out.set(day, { rate: published.get(rateDate)!, rateDate, source: 'ecb', final })
  }
  return out
}

/** The rate service with its source of published rates (ECB unless a test supplies one). */
export function createFxRates(publishedRates: PublishedRates = ecbPublishedRates): FxRates {
  return {
    async usdRates(currencyIn, days) {
      const currency = currencyIn.trim().toUpperCase()
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`fx: "${currencyIn}" is not an ISO 4217 currency code`)
      const wanted = [...new Set(days)].sort()
      for (const d of wanted) if (!DAY.test(d)) throw new Error(`fx: "${d}" is not a YYYY-MM-DD day`)
      const out = new Map<string, FxRate>()
      if (currency === 'USD') {
        for (const d of wanted) out.set(d, { rate: 1, rateDate: d, source: 'identity' })
        return out
      }
      if (wanted.length === 0) return out

      await ensureSchema()
      const stored = await withRead<{ day: string; usd_rate: number; rate_date: string; source: string }>(
        `SELECT CAST(day AS VARCHAR) AS day, usd_rate, CAST(rate_date AS VARCHAR) AS rate_date, source FROM fx_rates
          WHERE currency = ? AND day BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)`,
        [currency, wanted[0]!, wanted[wanted.length - 1]!],
      )
      for (const r of stored) out.set(r.day, { rate: Number(r.usd_rate), rateDate: r.rate_date, source: r.source })

      const missing = wanted.filter((d) => !out.has(d))
      if (missing.length > 0) {
        const today = new Date().toISOString().slice(0, 10)
        const from = addDays(missing[0]!, -LOOKBACK_DAYS)
        const to = missing[missing.length - 1]! > today ? today : missing[missing.length - 1]!
        const published = await publishedRates(currency, from, to)
        const resolved = resolveDays(missing, published)
        const finals = [...resolved].filter(([, r]) => r.final)
        if (finals.length > 0) {
          await withWrite(async (conn) => {
            for (const [day, r] of finals) {
              await conn.run(
                `INSERT INTO fx_rates (currency, day, usd_rate, rate_date, source, fetched_at)
                 VALUES (?, CAST(? AS DATE), ?, CAST(? AS DATE), ?, now()) ON CONFLICT DO NOTHING`,
                [currency, day, r.rate, r.rateDate, r.source],
              )
            }
          })
        }
        for (const [day, r] of resolved) out.set(day, { rate: r.rate, rateDate: r.rateDate, source: r.source })
        const unresolved = missing.filter((d) => !out.has(d))
        if (unresolved.length > 0) {
          throw new Error(`fx: no ECB rate for ${currency} on ${unresolved.length === 1 ? unresolved[0] : `${unresolved[0]}..${unresolved[unresolved.length - 1]} (${unresolved.length} days)`}`)
        }
      }
      return out
    },
  }
}

/** The Box's rate service. */
export const fxRates: FxRates = createFxRates()
