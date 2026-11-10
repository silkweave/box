// Runs by area (W8 R3, PERMISSIONS 8.1): a run is readable with read on its action's owning area
// (row security); an agent job's run also needs a reader who covers the principal it acted as;
// Run Now needs write on the action's area; the action list shows readable areas only.

import { beforeAll, describe, expect, it } from 'vitest'
import type { Access, AccessLevel } from '../auth/access.js'
import { AreaAccessError, policyRevision } from '../auth/access.js'
import type { Principal } from '../auth/principal.js'
import { upsertRole } from '../auth/roles.js'
import { asSystem, fillRequest, runInRequest } from '../request-context.js'
import { upsertUser } from '../users/state.js'
import { listAutomationActions } from './registry.js'
import { startDetachedRun } from './run.js'
import { insertRun, readRun, readRuns } from './runs.js'

function as<T>(areas: Record<string, AccessLevel>, fn: () => Promise<T>, admin = false): Promise<T> {
  return runInRequest(() => {
    const access: Access = { role: 'runs-probe', areas: new Map(Object.entries(areas)), fallback: 'none', admin, revision: policyRevision() }
    fillRequest({ principal: { id: 'probe', display: 'Probe', role: 'runs-probe', kind: 'human' } as Principal, access })
    return fn()
  })
}
const sys = <T>(fn: () => Promise<T>) => asSystem('test: runs access', fn)
const mine = async () => (await readRuns(500)).map((r) => r.id).filter((id) => id.startsWith('ra-')).sort()

beforeAll(async () => {
  await sys(async () => {
    await upsertRole({ id: 'ra-agent', label: 'Agent', default: 'none', areas: { automation: 'write', crm: 'read' } })
    await upsertUser({ id: 'ra-bot', first_name: 'Bot', role: 'ra-agent' })
    await insertRun({ id: 'ra-ops', action_id: 'warehouse-backup', trigger: 'manual', triggered_by: null })
    await insertRun({ id: 'ra-sig', action_id: 'sources-sync', trigger: 'manual', triggered_by: null })
    await insertRun({ id: 'ra-agent', action_id: 'agent', trigger: 'manual', triggered_by: null, acts_as: 'ra-bot' })
  })
})

describe('runs', () => {
  it('read by the action\'s owning area', async () => {
    await as({ ops: 'read' }, async () => {
      expect(await mine()).toEqual(['ra-ops'])
      expect(await readRun('ra-sig')).toBeNull()
    })
    await as({ signals: 'read', ops: 'read' }, async () => expect(await mine()).toEqual(['ra-ops', 'ra-sig']))
  })

  it('show an agent job\'s run only to readers who cover its principal', async () => {
    await as({ automation: 'write' }, async () => {
      expect(await mine()).toEqual([])
      expect(await readRun('ra-agent')).toBeNull()
    })
    await as({ automation: 'write', crm: 'read' }, async () => {
      expect(await mine()).toEqual(['ra-agent'])
      expect((await readRun('ra-agent'))?.id).toBe('ra-agent')
    })
    expect(await sys(() => readRun('ra-agent'))).not.toBeNull()
  })

  it('apply the limit after coverage: newer runs the reader does not cover never crowd out its own', async () => {
    await sys(async () => {
      await upsertRole({ id: 'ra-agent2', label: 'Agent 2', default: 'none', areas: { automation: 'write', chat: 'read' } })
      await upsertUser({ id: 'ra-bot2', first_name: 'Bot2', role: 'ra-agent2' })
      for (const n of [1, 2, 3]) await insertRun({ id: `ra-other-${n}`, action_id: 'agent', trigger: 'manual', triggered_by: null, acts_as: 'ra-bot2' })
    })
    await as({ automation: 'write', crm: 'read' }, async () => expect((await readRuns(1)).map((r) => r.id)).toEqual(['ra-agent']))
    expect((await sys(() => readRuns(1))).map((r) => r.id)).toEqual(['ra-other-3'])
  })

  it('refuse an agent run row without its principal', async () => {
    await expect(sys(() => insertRun({ id: 'ra-bad', action_id: 'agent', trigger: 'manual', triggered_by: null }))).rejects.toThrow(/acts as/)
  })

  it('need write on the action\'s area to run now, and list only readable actions', async () => {
    await as({ ops: 'read', signals: 'write' }, async () => {
      expect(() => startDetachedRun('warehouse-backup', { trigger: 'manual', triggeredBy: null })).toThrow(AreaAccessError)
      const ids = listAutomationActions().map((a) => a.id)
      expect(ids).toEqual(expect.arrayContaining(['warehouse-backup', 'sources-sync']))
    })
    await as({ signals: 'read' }, async () => {
      const ids = listAutomationActions().map((a) => a.id)
      expect(ids).toContain('sources-sync')
      expect(ids).not.toContain('warehouse-backup')
    })
  })
})
