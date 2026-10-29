// In-Box measures against a throwaway warehouse: the registry, parameter validation, the binding
// rules on signal-upsert, the derive (full replace of live points, manual points kept, warnings for
// a measure that is gone) and what an in-Box binding changes about rename, unbind and channel
// derives.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '../testing.js'
import { upsertUser } from '../users/state.js'
import { deleteSignalDefinition, readSignalDefinition, renameSignalDefinition, upsertSignalDefinition } from './definitions.js'
import { deriveMeasureSignal, deriveMeasureSignals, measureBoundSignalIds, repointMeasureParam } from './measure-derive.js'
import { getMeasure, listMeasures, registerMeasure, requireMeasure, validateMeasureParams, type Measure } from './measures.js'
import { readSignalPointRecords, readSignalPoints, setSignalPoint } from './points.js'
import { replaceChannelSignals } from './write.js'

let dir: string
let unregister: () => void
/** The merged series without an increment signal's zero-filled days. */
const values = async (id: string): Promise<[string, number][]> =>
  (await readSignalPoints(id)).filter((p) => p.value !== 0).map((p) => [p.bucket.slice(0, 10), p.value])

/** What the test measure returns; tests change it between derives. */
let rows: { at: string; value: number }[] = []
const seen: Record<string, string>[] = []

const COUNT: Measure = {
  key: 'test.count',
  label: 'Count',
  unit: 'n',
  interval: 'day',
  accumulation: 'increment',
  direction: 'up',
  group: 'Test',
  description: 'Rows the test hands it',
  params: [
    { key: 'stage', label: 'Stage', kind: 'enum', required: true, options: [{ value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }] },
    { key: 'owner', label: 'Owner', kind: 'user' },
    { key: 'since', label: 'Since', kind: 'date' },
    { key: 'note', label: 'Note', kind: 'text' },
  ],
  compute: async ({ params }) => {
    seen.push(params)
    return rows
  },
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-measures-'))
  setInstanceDir(dir)
  await upsertUser({ id: 'ana', first_name: 'Ana', last_name: 'Lima' })
  unregister = registerMeasure(COUNT)
})

afterAll(() => {
  unregister()
  resetInstanceDir()
  rmSync(dir, { recursive: true, force: true })
})

describe('the registry', () => {
  it('lists, finds and refuses', () => {
    expect(listMeasures().map((m) => m.key)).toContain('test.count')
    expect(getMeasure('test.count')).toBe(COUNT)
    expect(getMeasure('test.nope')).toBeNull()
    expect(() => requireMeasure('test.nope')).toThrow(/unknown measure "test.nope" - registered measures: .*test.count/)
    expect(() => registerMeasure(COUNT)).toThrow(/registered twice/)
    expect(() => registerMeasure({ ...COUNT, key: 'nodot' })).toThrow(/<feature>.<name>/)
    expect(() => registerMeasure({ ...COUNT, key: 'test.bad', params: [{ key: 'x', label: 'X', kind: 'enum' }] })).toThrow(/needs options/)
  })

  it('validates params against their kinds', async () => {
    const user = async (id: string): Promise<void> => {
      if (id !== 'ana') throw new Error(`unknown user ${id}`)
    }
    expect(await validateMeasureParams(COUNT, { stage: 'won', owner: 'ana', since: '2026-10-01', note: ' hi ', unused: undefined } as never, user).catch((e: Error) => e.message)).toMatch(/no param "unused"/)
    expect(await validateMeasureParams(COUNT, { stage: 'won', owner: 'ana', since: '2026-10-01', note: ' hi ' }, user)).toEqual({ note: 'hi', owner: 'ana', since: '2026-10-01', stage: 'won' })
    expect(await validateMeasureParams(COUNT, { stage: 'won', owner: '' }, user)).toEqual({ stage: 'won' })
    await expect(validateMeasureParams(COUNT, {}, user)).rejects.toThrow(/"stage" is required/)
    await expect(validateMeasureParams(COUNT, { stage: 'tied' }, user)).rejects.toThrow(/must be one of won, lost/)
    await expect(validateMeasureParams(COUNT, { stage: 'won', since: 'Oct 1' }, user)).rejects.toThrow(/YYYY-MM-DD/)
    await expect(validateMeasureParams(COUNT, { stage: 'won', owner: 'bob' }, user)).rejects.toThrow(/unknown user bob/)
  })
})

describe('binding a signal', () => {
  it('measure_key alone binds an in-Box measure: derived, params validated, computed at once', async () => {
    rows = [
      { at: '2026-10-01', value: 2 },
      { at: '2026-10-01T15:00:00Z', value: 1 },
      { at: '2026-10-03', value: 4 },
    ]
    const def = await upsertSignalDefinition({ id: 'won-deals', label: 'Won deals', measure_key: 'test.count', measure_params: { stage: 'won' }, accumulation: 'increment' })
    expect(def).toMatchObject({ source: 'derived', data_source_id: null, measure_key: 'test.count', measure_params: { stage: 'won' } })
    // Two rows in one day bucket of an increment signal add up.
    expect(await values('won-deals')).toEqual([
      ['2026-10-01', 3],
      ['2026-10-03', 4],
    ])
    expect(seen.at(-1)).toEqual({ stage: 'won' })
    expect(await measureBoundSignalIds('test.count')).toEqual(['won-deals'])
  })

  it('refuses an unknown measure, bad params, and a data source without a measure', async () => {
    await expect(upsertSignalDefinition({ id: 'x', measure_key: 'test.nope' })).rejects.toThrow(/unknown measure/)
    await expect(upsertSignalDefinition({ id: 'x', measure_key: 'test.count', measure_params: { stage: 'tied' } })).rejects.toThrow(/must be one of/)
    await expect(upsertSignalDefinition({ id: 'x', data_source_id: 'src' })).rejects.toThrow(/needs a measure_key/)
    expect(await readSignalDefinition('x')).toBeNull()
  })

  it('re-derives on a parameter change, not on a curation edit', async () => {
    const before = seen.length
    await upsertSignalDefinition({ id: 'won-deals', label: 'Won deals (all)' })
    expect(seen.length).toBe(before)
    await upsertSignalDefinition({ id: 'won-deals', measure_params: { stage: 'lost' } })
    expect(seen.at(-1)).toEqual({ stage: 'lost' })
  })

  it('a derive replaces the live points wholesale and keeps manual ones', async () => {
    await setSignalPoint({ signal_id: 'won-deals', at: '2026-09-01', value: 9 })
    rows = [{ at: '2026-10-05', value: 1 }]
    expect(await deriveMeasureSignal('won-deals')).toBe(1)
    expect(await values('won-deals')).toEqual([
      ['2026-09-01', 9],
      ['2026-10-05', 1],
    ])
  })

  it('a channel derive leaves in-Box measure points alone', async () => {
    await upsertSignalDefinition({ id: 'won-deals', channel: 'crm' })
    await replaceChannelSignals('crm', [{ channel: 'crm', signal_id: 'crm.other', label: 'Other', signal_group: '', unit: null, date: '2026-10-05', value: 1 }])
    expect((await values('won-deals')).map(([, v]) => v)).toEqual([9, 1])
  })

  it('a measure-bound signal can be renamed: a person chose its id', async () => {
    await renameSignalDefinition('won-deals', 'deals-won')
    expect((await readSignalDefinition('deals-won'))?.measure_key).toBe('test.count')
    // A deriver-owned signal still cannot.
    await expect(renameSignalDefinition('crm.other', 'other')).rejects.toThrow(/cannot rename derived signal/)
  })

  it('repoints one param value across the signals bound to a measure', async () => {
    expect(await repointMeasureParam('test.count', 'stage', 'lost', 'won')).toEqual(['deals-won'])
    expect((await readSignalDefinition('deals-won'))?.measure_params).toEqual({ stage: 'won' })
  })

  it('unbinding makes it manual again and drops the computed points', async () => {
    const def = await upsertSignalDefinition({ id: 'deals-won', measure_key: null, data_source_id: null })
    expect(def).toMatchObject({ source: 'manual', measure_key: null, measure_params: {} })
    expect((await values('deals-won')).map(([, v]) => v)).toEqual([9])
  })
})

describe('the derive', () => {
  it('recomputes every bound signal and warns about a measure that is gone', async () => {
    await upsertSignalDefinition({ id: 'lost-deals', measure_key: 'test.count', measure_params: { stage: 'lost' } })
    rows = [{ at: '2026-10-07', value: 5 }]
    expect(await deriveMeasureSignals()).toEqual({ signals: 1, points: 1, warnings: [] })
    unregister()
    const result = await deriveMeasureSignals()
    expect(result.signals).toBe(0)
    expect(result.warnings).toEqual(['lost-deals: measure test.count is not registered in this Box - binding kept, points not refreshed'])
    // The binding and its points stay.
    expect((await readSignalDefinition('lost-deals'))?.measure_key).toBe('test.count')
    expect((await values('lost-deals')).map(([, v]) => v)).toEqual([5])
    unregister = registerMeasure(COUNT)
  })

  it('a delete with its points removes the history too', async () => {
    await deleteSignalDefinition('lost-deals', undefined, { withPoints: true })
    expect(await readSignalPointRecords('lost-deals')).toEqual([])
  })
})
