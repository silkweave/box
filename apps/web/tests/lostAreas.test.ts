import { describe, expect, it } from 'bun:test'
import { isRefusal } from '../src/lib/changeFeed.ts'
import { lostAreas, type ClientAccess } from '../src/lib/access.ts'
import { createDataStore } from '../src/lib/dataStore.ts'
import { areaOfPath } from '../src/lib/lostAreas.ts'

const access = (areas: ClientAccess['areas']): ClientAccess => ({ role: 'r', label: 'R', admin: false, revision: 1, areas })

describe('lostAreas', () => {
  it('lists the areas that went to none, or vanished, and not the ones only narrowed', () => {
    const before = access({ crm: 'write', chat: 'write', sink: 'read', ops: 'none' })
    const after = access({ crm: 'none', chat: 'read' })
    expect(lostAreas(before, after)).toEqual(['crm', 'sink'])
    expect(lostAreas(before, null)).toEqual(['chat', 'crm', 'sink'])
    expect(lostAreas(null, after)).toEqual([])
  })
})

describe('areaOfPath', () => {
  const features = [{ id: 'crm', nav: [{ to: '/crm' }] }, { id: 'planning', nav: [{ to: '/studio' }] }, { id: 'chat' }]
  it('finds the feature a path lies under, by nav path or id, on segment boundaries', () => {
    expect(areaOfPath('/crm/acme', features)).toBe('crm')
    expect(areaOfPath('/studio', features)).toBe('planning')
    expect(areaOfPath('/chat/general', features)).toBe('chat')
    expect(areaOfPath('/crmx', features)).toBeNull()
    expect(areaOfPath('/', features)).toBeNull()
  })
})

describe('a refused store', () => {
  it('recognizes a refusal and drops the cache with clear()', async () => {
    expect(isRefusal({ data: { code: 'FORBIDDEN' } })).toBe(true)
    expect(isRefusal(new Error('no read access to crm'))).toBe(true)
    expect(isRefusal(new Error('403 Forbidden'))).toBe(true)
    expect(isRefusal(new Error('network down'))).toBe(false)
    const store = createDataStore(async () => ['deal'])
    await store.load()
    expect(store.peek()).toEqual(['deal'])
    store.clear()
    expect(store.peek()).toBeNull()
  })
})
