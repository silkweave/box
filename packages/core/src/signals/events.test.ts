// Signal events against a throwaway warehouse: every signal is evaluated, an increase fires once per
// (signal, date), a threshold from the definition fires once per (signal, threshold, date), and a
// pass with no signal write since the last one is skipped.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listEvents } from '../events.js'
import { resetInstanceDir, setInstanceDir } from '../testing.js'
import { upsertSignalDefinition } from './definitions.js'
import { evaluateSignalEvents, signalEventsFor, watchSignalWrites } from './events.js'
import { setSignalPoints } from './points.js'

let dir: string
let unwatch: () => void

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-signal-events-'))
  setInstanceDir(dir)
  unwatch = watchSignalWrites()
  await upsertSignalDefinition({ id: 'mrr', label: 'MRR', thresholds: [10000, 5000] })
  await upsertSignalDefinition({ id: 'stars', label: 'Stars' })
  await upsertSignalDefinition({ id: 'churn', label: 'Churn', thresholds: [3] })
  await setSignalPoints('mrr', [{ at: '2026-10-01', value: 4000 }, { at: '2026-10-02', value: 12000 }])
  await setSignalPoints('stars', [{ at: '2026-10-01', value: 10 }, { at: '2026-10-02', value: 12 }])
  await setSignalPoints('churn', [{ at: '2026-10-01', value: 5 }, { at: '2026-10-02', value: 4 }])
})

afterAll(() => {
  unwatch()
  resetInstanceDir()
  rmSync(dir, { recursive: true, force: true })
})

describe('signalEventsFor', () => {
  const def = { id: 'mrr', label: 'MRR', unit: 'USD', channel: 'stripe', thresholds: [5000] }
  it('fires a threshold on first sight and an increase only against a prior bucket', () => {
    expect(signalEventsFor(def, { date: '2026-10-02', value: 6000 }, undefined).map((e) => e.kind)).toEqual(['signal.threshold'])
    expect(signalEventsFor(def, { date: '2026-10-02', value: 6000 }, { date: '2026-10-01', value: 5000 }).map((e) => e.kind)).toEqual(['signal.increase'])
    expect(signalEventsFor(def, { date: '2026-10-02', value: 4000 }, { date: '2026-10-01', value: 6000 })).toEqual([])
  })
})

describe('evaluateSignalEvents', () => {
  it('records one event per signal increase and per threshold crossed, once', async () => {
    expect(await evaluateSignalEvents()).toEqual({ recorded: 4 })
    expect(await evaluateSignalEvents({ force: true })).toEqual({ recorded: 0 })
    const events = await listEvents(['signal.increase', 'signal.threshold'], '2026-01-01T00:00:00.000Z')
    expect(events.map((e) => e.dedup_key).sort()).toEqual(['mrr:10000:2026-10-02', 'mrr:2026-10-02', 'mrr:5000:2026-10-02', 'stars:2026-10-02'])
    expect(events.find((e) => e.dedup_key === 'mrr:5000:2026-10-02')?.fields).toMatchObject({ signal_id: 'mrr', threshold: '5000', value: '12000', prev: '4000' })
  })

  it('skips a pass when no signal was written since the last one', async () => {
    await evaluateSignalEvents({ force: true })
    expect(await evaluateSignalEvents()).toEqual({ recorded: 0 })
    await setSignalPoints('stars', [{ at: '2026-10-03', value: 15 }])
    expect(await evaluateSignalEvents()).toEqual({ recorded: 1 })
  })
})
