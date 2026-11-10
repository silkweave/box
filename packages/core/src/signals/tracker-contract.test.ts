// The tracker contract check: a sound tracker has no problems; each broken one is named.

import { describe, expect, it } from 'vitest'
import { trackerContractProblems } from './tracker-contract.js'
import { getTracker, type Tracker } from './trackers.js'

const base: Tracker = {
  key: 'crm.contract_probe',
  label: 'Probe',
  unit: 'things',
  interval: 'day',
  accumulation: 'increment',
  direction: 'up',
  group: 'Probes',
  description: 'A probe.',
  watches: ['table:crm_deals'],
  params: [{ key: 'stage', label: 'Stage', kind: 'enum', required: true, options: [{ value: 'demo', label: 'Demo' }] }],
  compute: async ({ params }) => [{ at: '2026-10-01', value: params.stage === 'demo' ? 2 : 0 }],
}

describe('trackerContractProblems', () => {
  it('passes a sound tracker, runs it once with its required params filled, and leaves it unregistered', async () => {
    expect(await trackerContractProblems(base)).toEqual([])
    expect(getTracker(base.key)).toBeNull()
  })

  it('names an empty declaration, a prefix that is no feature, a bad watch and a bad compute', async () => {
    expect(await trackerContractProblems({ ...base, key: 'nofeature.probe', description: ' ' })).toEqual([
      'nofeature.probe: the key prefix "nofeature" names no installed feature, so the tracker would be admin-only',
      'nofeature.probe: description is empty',
    ])
    expect((await trackerContractProblems({ ...base, watches: [] }))[0]).toMatch(/must declare what it watches/)
    expect((await trackerContractProblems({ ...base, watches: ['table:signal_points'] }))[0]).toMatch(/cannot watch table:signal_points/)
    expect((await trackerContractProblems({ ...base, compute: async () => [{ at: '2026-10-01', value: Number.NaN }] }))[0]).toMatch(/non-finite/)
    expect((await trackerContractProblems({ ...base, compute: async () => [{ at: 'yesterday', value: 1 }] }))[0]).toMatch(/not a day/)
    expect((await trackerContractProblems({ ...base, compute: async () => { throw new Error('no table') } }))[0]).toMatch(/compute failed with {"stage":"demo"}: no table/)
  })

  it('asks for params when a required enum has no options', async () => {
    const t = { ...base, params: [{ key: 'topic', label: 'Topic', kind: 'enum' as const, required: true, options: () => [] }] }
    expect((await trackerContractProblems(t))[0]).toMatch(/no options to run with/)
    expect(await trackerContractProblems(t, { params: { topic: 'any' } })).toEqual([])
  })
})
