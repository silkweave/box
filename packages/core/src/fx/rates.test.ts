// The USD rate service against a throwaway warehouse and stubbed published rates: weekends use the
// last published rate, only final days are stored, stored days never change, USD is 1, and a day
// with no rate fails loudly.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '../testing.js'
import { withRead } from '../warehouse/db.js'
import { createFxRates, resolveDays } from './rates.js'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'box-fx-'))
  setInstanceDir(dir)
})
afterAll(() => {
  resetInstanceDir()
  rmSync(dir, { recursive: true, force: true })
})

// Friday 2026-10-02 and Monday 2026-10-05 published; the weekend in between did not.
const published = new Map([
  ['2026-10-02', 0.78],
  ['2026-10-05', 0.79],
])

describe('resolveDays', () => {
  it('serves a weekend from Friday, final because Monday published', () => {
    const r = resolveDays(['2026-10-03', '2026-10-05'], published)
    expect(r.get('2026-10-03')).toMatchObject({ rate: 0.78, rateDate: '2026-10-02', final: true })
    expect(r.get('2026-10-05')).toMatchObject({ rate: 0.79, rateDate: '2026-10-05', final: true })
  })

  it('serves a day past the last publication but does not call it final', () => {
    expect(resolveDays(['2026-10-06'], published).get('2026-10-06')).toMatchObject({ rate: 0.79, final: false })
  })

  it('has nothing for a day before any publication', () => {
    expect(resolveDays(['2026-10-01'], published).has('2026-10-01')).toBe(false)
  })
})

describe('createFxRates', () => {
  it('fetches, stores final days only, and reads them back without fetching again', async () => {
    let calls = 0
    let rates = published
    const fx = createFxRates(async () => {
      calls++
      return rates
    })
    const first = await fx.usdRates('sgd', ['2026-10-03', '2026-10-06'])
    expect(first.get('2026-10-03')).toMatchObject({ rate: 0.78, rateDate: '2026-10-02' })
    expect(first.get('2026-10-06')).toMatchObject({ rate: 0.79, rateDate: '2026-10-05' })
    const stored = await withRead<{ day: string }>(`SELECT CAST(day AS VARCHAR) AS day FROM fx_rates WHERE currency = 'SGD' ORDER BY day`)
    expect(stored.map((r) => r.day)).toEqual(['2026-10-03'])

    // A later publication makes 2026-10-06 final; a stored day keeps its rate even if a source
    // would now say otherwise.
    rates = new Map([...published, ['2026-10-06', 0.8], ['2026-10-03', 9]])
    const second = await fx.usdRates('SGD', ['2026-10-03', '2026-10-06'])
    expect(second.get('2026-10-03')!.rate).toBe(0.78)
    expect(second.get('2026-10-06')!.rate).toBe(0.8)
    expect(calls).toBe(2)
    await fx.usdRates('SGD', ['2026-10-03', '2026-10-06'])
    expect(calls).toBe(2)
  })

  it('maps USD to 1 without fetching', async () => {
    const fx = createFxRates(async () => {
      throw new Error('should not fetch')
    })
    expect((await fx.usdRates('usd', ['2026-10-01'])).get('2026-10-01')).toMatchObject({ rate: 1 })
  })

  it('fails loudly when a day has no rate', async () => {
    const fx = createFxRates(async () => new Map())
    await expect(fx.usdRates('EUR', ['2026-10-01'])).rejects.toThrow(/no ECB rate for EUR on 2026-10-01/)
  })
})
