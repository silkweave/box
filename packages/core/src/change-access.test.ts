// Change events per subscriber (W8 R3, PERMISSIONS 8.1 and 9.2): each scope goes to readers of its
// area; a shared core table's change to readers of the areas its rows carry.

import { describe, expect, it } from 'vitest'
import { policyRevision } from './auth/access.js'
import { asSystem, fillRequest, runInRequest } from './request-context.js'
import { changeScopeArea, visibleChange } from './change-access.js'
import type { ChangeEvent } from './changes.js'

function as<T>(areas: Record<string, 'read' | 'write'>, fn: () => T, admin = false): T {
  return runInRequest(() => {
    fillRequest({
      principal: { id: 'probe', display: 'Probe', role: 'feed-probe', kind: 'human' } as never,
      access: { role: 'feed-probe', areas: new Map(Object.entries(areas)), fallback: 'none', admin, revision: policyRevision() },
    })
    return fn()
  })
}

const ev = (scope: string, detail: string | null = null, areas?: string[]): ChangeEvent => ({ seq: 1, ts: '2026-11-09T00:00:00Z', scope, detail, ...(areas ? { areas } : {}) })
const sees = (e: ChangeEvent) => visibleChange(e) !== null

describe('changeScopeArea', () => {
  it('maps tables, docs, config and feature topics to their owners', () => {
    expect(changeScopeArea('table:crm_accounts')).toBe('crm')
    expect(changeScopeArea('table:signals')).toBe('rows')
    expect(changeScopeArea('table:automation_runs')).toBe('rows')
    expect(changeScopeArea('table:events')).toBe('rows')
    expect(changeScopeArea('table:users')).toBe('*')
    expect(changeScopeArea('table:data_sources')).toBe('signals')
    expect(changeScopeArea('table:kv_state')).toBe('admin')
    expect(changeScopeArea('table:nope')).toBe('admin')
    expect(changeScopeArea('docs:crm')).toBe('crm')
    expect(changeScopeArea('docs:initiatives')).toBe('planning')
    expect(changeScopeArea('docs:sink')).toBe('sink')
    expect(changeScopeArea('docs:elsewhere')).toBe('admin')
    expect(changeScopeArea('config:presets.json')).toBe('admin')
    expect(changeScopeArea('crm:deals')).toBe('crm')
    expect(changeScopeArea('hello')).toBe('*')
    expect(changeScopeArea('policy')).toBe('*')
    expect(changeScopeArea('mystery')).toBe('admin')
  })
})

describe('visibleChange', () => {
  it('delivers each scope only to readers of its area', () => {
    as({ crm: 'read' }, () => {
      expect(sees(ev('table:crm_deals'))).toBe(true)
      expect(sees(ev('docs:crm'))).toBe(true)
      expect(sees(ev('table:support_tickets'))).toBe(false)
      expect(sees(ev('docs:goals'))).toBe(false)
      expect(sees(ev('config:presets.json'))).toBe(false)
      expect(sees(ev('table:users'))).toBe(true)
      expect(sees(ev('ping'))).toBe(true)
      expect(sees(ev('policy'))).toBe(true)
    })
    as({}, () => expect(sees(ev('config:presets.json'))).toBe(true), true)
    expect(asSystem('test: feed', () => sees(ev('table:kv_state')))).toBe(true)
  })

  it('delivers a shared row change to readers of its rows areas only, without the detail', () => {
    // A hidden run (automation's) and a hidden signal (support's) against a crm-only subscriber.
    as({ crm: 'read' }, () => {
      expect(visibleChange(ev('table:automation_runs', 'run-1', ['automation']))).toBeNull()
      expect(visibleChange(ev('table:signals', null, ['support']))).toBeNull()
      expect(visibleChange(ev('table:signal_points', null, ['support']))).toBeNull()
      expect(visibleChange(ev('table:snapshots', null, ['signals']))).toBeNull()
      // Unknown ownership fails closed.
      expect(visibleChange(ev('table:automation_runs', 'run-1'))).toBeNull()
      // Its own area: delivered, the run id withheld; areas never leave the server.
      const own = visibleChange(ev('table:automation_runs', 'run-2', ['crm']))
      expect(own).toEqual({ seq: 1, ts: '2026-11-09T00:00:00Z', scope: 'table:automation_runs', detail: null })
      // A change touching rows of several areas reaches readers of any of them; an event needs all.
      expect(sees(ev('table:signals', null, ['crm', 'support']))).toBe(true)
      expect(sees(ev('table:events', null, ['crm', 'support']))).toBe(false)
      expect(sees(ev('table:events', null, ['crm']))).toBe(true)
    })
    as({}, () => expect(visibleChange(ev('table:automation_runs', 'run-1', ['automation']))?.detail).toBe('run-1'), true)
  })
})
