// Stored owning areas (PERMISSIONS 8.1 to 8.3, storage phase 1 W8 R1): every shared core row
// carries the area its writer declared; nothing is guessed, and what nothing classifies is `admin`.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '../testing.js'
import { FEATURE_LIST } from '../generated/features.js'
import { eventAreas, recordEvent } from '../events.js'
import { withRead, withWrite } from '../warehouse/db.js'
import { CORE_ACTIONS } from '../ops/core-actions.js'
import { actionOwner } from '../ops/registry.js'
import { insertRun, insertSkippedRun } from '../ops/runs.js'
import { autoRegisterDefinitions, readSignalDefinition, signalAreaClosure, upsertSignalDefinition } from '../signals/definitions.js'
import { registerTracker, type Tracker } from '../signals/trackers.js'
import { replaceChannelSignals, replaceSignalRows, upsertBackfillSignals, upsertSnapshot } from '../signals/write.js'
import { ADMIN_AREA, isStoredArea, storedArea, trackerArea } from './owning-area.js'

const CORE = { reach: 'core' } as const
let dir: string
const unregister: (() => void)[] = []

const tracker = (key: string): Tracker => ({
  key,
  label: key,
  unit: 'n',
  interval: 'day',
  accumulation: 'increment',
  direction: 'up',
  group: 'Test',
  watches: ['table:r1_rows'],
  description: 'R1 probe',
  params: [],
  compute: async () => [],
})

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'box-owning-area-'))
  setInstanceDir(dir)
  unregister.push(registerTracker(tracker('planning.r1_probe')), registerTracker(tracker('crm.r1_probe')), registerTracker(tracker('nofeature.r1_probe')))
})
afterAll(() => {
  for (const off of unregister) off()
  resetInstanceDir()
  rmSync(dir, { recursive: true, force: true })
})

describe('the area vocabulary', () => {
  it('stores installed features, the core areas and admin; refuses anything else', () => {
    for (const a of ['signals', 'ops', ADMIN_AREA, 'planning', 'crm']) expect(isStoredArea(a)).toBe(true)
    for (const a of ['', ' ', 'core', 'nope', 'Signals']) expect(() => storedArea(a)).toThrow(/not an owning area/)
  })
  it('gives a tracker its key prefix when that names a feature, otherwise admin', () => {
    expect(trackerArea('crm.deals_reached_stage')).toBe('crm')
    expect(trackerArea('nofeature.x')).toBe(ADMIN_AREA)
  })
})

describe('signals.area', () => {
  it('is signals for a new manual signal, the declared area for a feature signal, and kept across edits', async () => {
    expect((await upsertSignalDefinition({ id: 'r1-manual' })).area).toBe('signals')
    expect((await upsertSignalDefinition({ id: 'r1-goal', area: 'planning' })).area).toBe('planning')
    expect((await upsertSignalDefinition({ id: 'r1-goal', label: 'Renamed label' })).area).toBe('planning')
    await expect(upsertSignalDefinition({ id: 'r1-bad', area: 'nope' })).rejects.toThrow(/not an owning area/)
    expect(await readSignalDefinition('r1-bad')).toBeNull()
  })

  it('follows a Box tracker binding (the tracker wins over a declared area) and drops back to signals on unbind', async () => {
    expect((await upsertSignalDefinition({ id: 'r1-bound', area: 'planning', tracker_key: 'crm.r1_probe' })).area).toBe('crm')
    expect((await upsertSignalDefinition({ id: 'r1-bound', tracker_key: 'planning.r1_probe' })).area).toBe('planning')
    expect((await upsertSignalDefinition({ id: 'r1-bound', tracker_key: null })).area).toBe('signals')
    // A goal's own signal declares planning on every write, so unbinding returns it to planning.
    await upsertSignalDefinition({ id: 'r1-goal-bound', area: 'planning', tracker_key: 'crm.r1_probe' })
    expect((await upsertSignalDefinition({ id: 'r1-goal-bound', area: 'planning', tracker_key: null })).area).toBe('planning')
    expect((await upsertSignalDefinition({ id: 'r1-orphan', tracker_key: 'nofeature.r1_probe' })).area).toBe(ADMIN_AREA)
  })

  it('auto-registers derived rows under the writer, never moving an existing row', async () => {
    const row = { channel: 'crm', signal_id: 'r1.derived', label: 'Derived', signal_group: '', unit: null, date: '2026-11-01', value: 1 }
    expect(await autoRegisterDefinitions([row], 'crm')).toBe(1)
    expect((await readSignalDefinition('r1.derived'))?.area).toBe('crm')
    expect(await autoRegisterDefinitions([row], 'data-sync')).toBe(0)
    expect((await readSignalDefinition('r1.derived'))?.area).toBe('crm')
    await expect(autoRegisterDefinitions([], 'nope')).rejects.toThrow(/not an owning area/)
  })

  it('refuses a writer pouring rows into a signal another area owns, and replaces only its own channel rows', async () => {
    const row = { channel: 'crm', signal_id: 'r1.derived', label: 'Derived', signal_group: '', unit: null, date: '2026-11-02', value: 5 }
    await expect(upsertBackfillSignals([row], 'data-sync')).rejects.toThrow(/belong to another area than this write was authorized for \(r1\.derived\)/)
    await expect(replaceSignalRows('r1.derived', [row], 'planning')).rejects.toThrow(/belong to another area/)
    await upsertBackfillSignals([row], 'crm')
    // A data-sync row in the crm channel: crm's channel replace leaves it alone.
    await replaceChannelSignals('crm', [{ ...row, signal_id: 'r1.sync-in-crm', source: 'live' }], 'data-sync')
    await replaceChannelSignals('crm', [], 'crm')
    const pts = await withRead<{ signal_id: string }>(`select signal_id from core.signal_points where signal_id like 'r1.%' and source = 'live' order by 1`, [], CORE)
    expect(pts).toEqual([{ signal_id: 'r1.sync-in-crm' }])
  })

  it('closes a formula over every input, transitively; a missing input counts as admin', () => {
    const defs = [
      { id: 'a', area: 'crm', formula: null },
      { id: 'b', area: 'planning', formula: 'a * 2' },
      { id: 'c', area: 'signals', formula: 'b + gone' },
    ]
    const byId = new Map(defs.map((d) => [d.id, d]))
    expect(signalAreaClosure(defs[0]!, byId)).toEqual(['crm'])
    expect(signalAreaClosure(defs[1]!, byId)).toEqual(['crm', 'planning'])
    expect(signalAreaClosure(defs[2]!, byId)).toEqual([ADMIN_AREA, 'crm', 'planning', 'signals'])
    // A stored formula that does not parse has unknown inputs: admin. A cycle ends.
    expect(signalAreaClosure({ id: 'bad', area: 'signals', formula: 'a +* (' }, byId)).toEqual([ADMIN_AREA, 'signals'])
    const loop = new Map([['x', { id: 'x', area: 'crm', formula: 'y' }], ['y', { id: 'y', area: 'support', formula: 'x' }]])
    expect(signalAreaClosure(loop.get('x')!, loop)).toEqual(['crm', 'support'])
  })

  it('refuses a blank area at the database', async () => {
    await expect(withWrite((tx) => tx.run(`update core.signals set area = '' where id = 'r1-manual'`), CORE)).rejects.toThrow(/check/i)
  })
})

describe('events.areas', () => {
  it('requires a non-empty list without blank members, stored sorted and unique', async () => {
    expect(eventAreas(['support', 'crm', 'support'])).toEqual(['crm', 'support'])
    for (const bad of [[], [''], ['crm', ' '], undefined]) expect(() => eventAreas(bad as string[])).toThrow(/non-empty list of areas/)
    for (const bad of [['crm', 'crn'], ['core'], ['Support']]) expect(() => eventAreas(bad)).toThrow(/not owning areas/)
    await expect(recordEvent({ kind: 'r1.probe', dedup_key: 'none', fields: {}, areas: [] })).rejects.toThrow(/non-empty/)
    expect(await recordEvent({ kind: 'r1.probe', dedup_key: 'ok', fields: {}, areas: ['support', 'crm'] })).toBe(true)
    const rows = await withRead<{ areas: string[] }>(`select areas from core.events where kind = 'r1.probe'`, [], CORE)
    expect(rows).toEqual([{ areas: ['crm', 'support'] }])
  })

  it('refuses an empty array, a blank member and a null member at the database', async () => {
    for (const lit of [`'{}'`, `array['crm', '']`, `array['crm', null]`]) {
      await expect(
        withWrite((tx) => tx.run(`insert into core.events (id, kind, dedup_key, areas) values (gen_random_uuid()::text, 'r1.raw', $1, ${lit}::text[])`, [lit]), CORE),
      ).rejects.toThrow(/check/i)
    }
  })
})

describe('automation_runs.area and snapshots.area', () => {
  it('takes the action owner: ops for core actions, the declaring feature, admin for unknown ids', async () => {
    const coreAction = CORE_ACTIONS[0]!.id
    expect(actionOwner(coreAction)).toBe('ops')
    const feature = FEATURE_LIST.find((f) => (f.actions ?? []).length > 0)!
    expect(actionOwner(feature.actions![0]!.id)).toBe(feature.id)
    expect(actionOwner('agent')).toBe(FEATURE_LIST.some((f) => f.id === 'automation') ? 'automation' : ADMIN_AREA)
    expect(actionOwner('no-such-action')).toBe(ADMIN_AREA)
    // A core action whose errors carry another area's data declares it.
    expect(actionOwner('sources-sync')).toBe('signals')
    expect(actionOwner('source-sync')).toBe('signals')
    await insertRun({ id: 'r1-run', action_id: coreAction, trigger: 'manual', triggered_by: null })
    await insertSkippedRun({ trigger: 'time', triggerId: 't', actionId: 'no-such-action' }, 'probe')
    const rows = await withRead<{ action_id: string; area: string }>(`select action_id, area from core.automation_runs order by action_id`, [], CORE)
    expect(rows).toEqual(expect.arrayContaining([{ action_id: coreAction, area: 'ops' }, { action_id: 'no-such-action', area: ADMIN_AREA }]))
  })

  it("stores the writer's area on a snapshot, the latest writer's on a re-pull", async () => {
    await upsertSnapshot('r1-src', '2026-11-01', { n: 1 }, 'signals')
    await upsertSnapshot('r1-src', '2026-11-01', { n: 2 }, 'data-sync')
    const rows = await withRead<{ area: string }>(`select area from core.snapshots where channel = 'r1-src'`, [], CORE)
    expect(rows).toEqual([{ area: 'data-sync' }])
    await expect(upsertSnapshot('r1-src', '2026-11-02', {}, 'nope')).rejects.toThrow(/not an owning area/)
  })
})

describe('derived writers authorize the area even with no rows', () => {
  it('refuses an empty channel replace from a reader and from bootstrap', async () => {
    const { fillRequest, runInRequest, asBootstrap } = await import('../request-context.js')
    const { policyRevision } = await import('./access.js')
    await expect(runInRequest(() => {
      fillRequest({ principal: { id: 'r', display: 'R', role: 'x', kind: 'human' } as never, access: { role: 'x', areas: new Map([['crm', 'read']]), fallback: 'none', admin: false, revision: policyRevision() } })
      return replaceChannelSignals('crm', [], 'crm')
    })).rejects.toMatchObject({ area: 'crm', needed: 'write' })
    await expect(asBootstrap(() => replaceChannelSignals('crm', [], 'crm'))).rejects.toMatchObject({ area: 'crm', needed: 'write' })
  })
})
