// Formula signals against a throwaway warehouse (2026-10-09): the write rules (derived depends_on,
// unknown ids, cycles, no binding), the rename rewrite, the delete refusal and compute on read.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '../testing.js'
import { deleteSignalDefinition, readSignalDefinition, renameSignalDefinition, upsertSignalDefinition } from './definitions.js'
import { deleteSignalPoint, readSignalPoints, recordSignalIncrement, setSignalPoint, setSignalPoints } from './points.js'

let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'box-formula-'))
  setInstanceDir(dir)
  await upsertSignalDefinition({ id: 'mrr', label: 'MRR', unit: '$' })
  await upsertSignalDefinition({ id: 'churned-mrr', label: 'Churned MRR', interval: 'month', accumulation: 'increment' })
  await setSignalPoints('mrr', [
    { at: '2026-09-29', value: 6300 },
    { at: '2026-09-30', value: 6337 },
  ])
  await setSignalPoint({ signal_id: 'churned-mrr', at: '2026-10-01', value: 190 })
})

afterAll(() => {
  resetInstanceDir()
  rmSync(dir, { recursive: true, force: true })
})

describe('formula signals in the store', () => {
  it('computes the acceptance case on read and derives depends_on from the formula', async () => {
    const def = await upsertSignalDefinition({
      id: 'churn-rate',
      label: 'Churn rate',
      unit: '%',
      interval: 'month',
      direction: 'down',
      formula: ' churned-mrr / start(mrr) * 100 ',
      depends_on: ['mrr'],
    })
    expect(def.formula).toBe('churned-mrr / start(mrr) * 100')
    expect(def.depends_on).toEqual(['churned-mrr', 'mrr'])
    expect(def.source).toBe('manual')
    const pts = await readSignalPoints('churn-rate', { from: '2026-10-01' })
    expect(pts[0].bucket).toBe('2026-10-01T00:00:00Z')
    expect(pts[0].value).toBeCloseTo(2.998, 3)
    expect(pts[0]).toMatchObject({ source: 'live', computed: true })
  })

  it('a manual point overrides the computed bucket until it is deleted', async () => {
    await setSignalPoint({ signal_id: 'churn-rate', at: '2026-10-01', value: 3.5 })
    const [over] = await readSignalPoints('churn-rate', { from: '2026-10-01' })
    expect(over).toMatchObject({ value: 3.5, source: 'manual' })
    expect(over.shadowed_computed).toBeCloseTo(2.998, 3)
    await deleteSignalPoint('churn-rate', '2026-10-01')
    const [back] = await readSignalPoints('churn-rate', { from: '2026-10-01' })
    expect(back.value).toBeCloseTo(2.998, 3)
  })

  it('refuses parse errors (with position), unknown ids, self-reference, cycles, bindings and derived', async () => {
    await expect(upsertSignalDefinition({ id: 'bad', formula: 'mrr +' })).rejects.toThrow(/position 5/)
    await expect(upsertSignalDefinition({ id: 'bad', formula: 'mrr + ghost' })).rejects.toThrow(/unknown signal\(s\) ghost/)
    await expect(upsertSignalDefinition({ id: 'bad', formula: 'bad * 2' })).rejects.toThrow(/its own signal/)
    await expect(upsertSignalDefinition({ id: 'mrr', formula: 'churn-rate * 2' })).rejects.toThrow(/cycle/)
    await expect(upsertSignalDefinition({ id: 'bad', source: 'derived', formula: 'mrr' })).rejects.toThrow(/derived signal/)
    expect(await readSignalDefinition('bad')).toBeNull()
  })

  it('a formula reading a formula resolves recursively; occurrences are refused', async () => {
    await upsertSignalDefinition({ id: 'churn-x2', interval: 'month', formula: 'churn-rate * 2' })
    const [p] = await readSignalPoints('churn-x2', { from: '2026-10-01' })
    expect(p.value).toBeCloseTo(5.9965, 3)
    await upsertSignalDefinition({ id: 'churn-count', interval: 'month', accumulation: 'increment', formula: 'churned-mrr' })
    await expect(recordSignalIncrement({ signal_id: 'churn-count' })).rejects.toThrow(/formula signal/)
  })

  it('renaming an input rewrites every formula token by token', async () => {
    await renameSignalDefinition('mrr', 'revenue.monthly')
    const def = await readSignalDefinition('churn-rate')
    expect(def?.formula).toBe('churned-mrr / start(revenue.monthly) * 100')
    expect(def?.depends_on).toEqual(['churned-mrr', 'revenue.monthly'])
    const [p] = await readSignalPoints('churn-rate', { from: '2026-10-01' })
    expect(p.value).toBeCloseTo(2.998, 3)
  })

  it('refuses deleting a signal a formula reads, naming the formulas', async () => {
    await expect(deleteSignalDefinition('churned-mrr')).rejects.toThrow(/churn-count, churn-rate/)
  })

  it('clearing a formula keeps depends_on', async () => {
    const def = await upsertSignalDefinition({ id: 'churn-x2', formula: null })
    expect(def.formula).toBeNull()
    expect(def.depends_on).toEqual(['churn-rate'])
  })
})
