// Event reads by area (W8 R3, PERMISSIONS 8.3): a request caller sees and counts only events whose
// every area it can read; system work sees all. Summaries carry the areas of what they counted.

import { beforeAll, describe, expect, it } from 'vitest'
import type { Access, AccessLevel } from './auth/access.js'
import { policyRevision } from './auth/access.js'
import type { Principal } from './auth/principal.js'
import { asSystem, fillRequest, runInRequest } from './request-context.js'
import { dailyKindCounts, listEvents, recentEventKinds, recordEvent, subjectActivity } from './events.js'
import { onChange, type ChangeEvent } from './changes.js'
import { visibleChange } from './change-access.js'

function as<T>(areas: Record<string, AccessLevel>, fn: () => Promise<T>, admin = false): Promise<T> {
  return runInRequest(() => {
    const access: Access = { role: 'r3-events', areas: new Map(Object.entries(areas)), fallback: 'none', admin, revision: policyRevision() }
    fillRequest({ principal: { id: 'probe', display: 'Probe', role: 'r3-events', kind: 'human' } as Principal, access })
    return fn()
  })
}
const sys = <T>(fn: () => Promise<T>) => asSystem('test: event access', fn)

const SINCE = '2000-01-01T00:00:00Z'
const KINDS = ['r3e.a', 'r3e.b']
const at = new Date().toISOString()

beforeAll(async () => {
  await sys(async () => {
    const add = (kind: string, key: string, subject: string, areas: string[]) =>
      recordEvent({ kind, dedup_key: key, event_at: at, fields: { key }, subject, areas })
    await add('r3e.a', 'crm-1', 'post-1', ['crm'])
    await add('r3e.a', 'crm-2', 'post-1', ['crm'])
    await add('r3e.b', 'both-1', 'post-1', ['crm', 'support'])
    await add('r3e.b', 'sup-1', 'post-2', ['support'])
    await add('r3e.a', 'adm-1', 'post-3', ['admin'])
  })
})

const keys = (rows: { dedup_key: string }[]) => rows.map((r) => r.dedup_key).sort()
const kindCount = (rows: { kind: string; count: number }[], kind: string) => rows.find((r) => r.kind === kind)?.count ?? 0

describe('listEvents', () => {
  it('returns only events whose every area the caller reads; admin rows need admin authority', async () => {
    await as({ crm: 'read' }, async () => expect(keys(await listEvents(KINDS, SINCE))).toEqual(['crm-1', 'crm-2']))
    await as({ crm: 'read', support: 'read' }, async () => expect(keys(await listEvents(KINDS, SINCE))).toEqual(['both-1', 'crm-1', 'crm-2', 'sup-1']))
    await as({}, async () => expect(keys(await listEvents(KINDS, SINCE))).toEqual(['adm-1']), true)
    expect(keys(await sys(() => listEvents(KINDS, SINCE)))).toEqual(['adm-1', 'both-1', 'crm-1', 'crm-2', 'sup-1'])
  })
})

describe('aggregates', () => {
  it('count only readable events', async () => {
    await as({ crm: 'read' }, async () => {
      const kinds = await recentEventKinds(SINCE)
      expect(kindCount(kinds, 'r3e.a')).toBe(2)
      expect(kindCount(kinds, 'r3e.b')).toBe(0)
      expect((await dailyKindCounts(KINDS)).reduce((n, d) => n + d.value, 0)).toBe(2)
    })
    const all = await sys(() => recentEventKinds(SINCE))
    expect([kindCount(all, 'r3e.a'), kindCount(all, 'r3e.b')]).toEqual([3, 2])
    expect((await sys(() => dailyKindCounts(KINDS))).reduce((n, d) => n + d.value, 0)).toBe(5)
  })

  it('subjectActivity counts readable events and reports the areas it counted', async () => {
    const mine = await as({ crm: 'read' }, () => subjectActivity(KINDS, SINCE))
    expect(mine.map((a) => [a.subject, a.total, a.areas])).toEqual([['post-1', 2, ['crm']]])
    expect(['crm-1', 'crm-2']).toContain(mine[0]!.latest.dedup_key)

    const all = await sys(() => subjectActivity(KINDS, SINCE))
    expect(all.map((a) => [a.subject, a.total, a.byKind, a.areas])).toEqual([
      ['post-1', 3, { 'r3e.a': 2, 'r3e.b': 1 }, ['crm', 'support']],
      ['post-2', 1, { 'r3e.b': 1 }, ['support']],
      ['post-3', 1, { 'r3e.a': 1 }, ['admin']],
    ])
    // The latest event is one of the counted kinds, not any event on the subject.
    expect(all.every((a) => KINDS.includes(a.latest.kind))).toBe(true)
  })

  it('subjectActivity takes the representative event from the rows it counted (one snapshot)', async () => {
    // BOX-Review d7f5f4e finding 5: a newer, more restricted event's text never rides under the
    // areas of the older events alone.
    const kinds = ['r3e.snap']
    await sys(async () => {
      await recordEvent({ kind: 'r3e.snap', dedup_key: 'snap-old', event_at: '2026-01-01T00:00:00Z', fields: {}, subject: 'post-4', areas: ['crm'] })
      await recordEvent({ kind: 'r3e.snap', dedup_key: 'snap-new', event_at: '2026-01-02T00:00:00Z', fields: {}, subject: 'post-4', areas: ['crm', 'support'] })
    })
    const [a] = await sys(() => subjectActivity(kinds, SINCE))
    expect(a!.latest.dedup_key).toBe('snap-new')
    expect(a!.areas).toEqual(['crm', 'support'])
    expect(a!.latest.areas.every((x) => a!.areas.includes(x))).toBe(true)
    // A crm reader counts only the older event, and its representative is that event.
    const [mine] = await as({ crm: 'read' }, () => subjectActivity(kinds, SINCE))
    expect([mine!.total, mine!.areas, mine!.latest.dedup_key]).toEqual([1, ['crm'], 'snap-old'])
  })
})

describe('change events', () => {
  it('a fresh event announces table:events with its stored areas; a duplicate announces nothing', async () => {
    const seen: ChangeEvent[] = []
    const off = onChange((ev) => { if (ev.scope === 'table:events') seen.push(ev) })
    try {
      const input = { kind: 'r3e.feed', dedup_key: 'feed-1', event_at: at, fields: {}, subject: 'post-5', areas: ['support', 'crm'] }
      expect(await sys(() => recordEvent(input))).toBe(true)
      expect(await sys(() => recordEvent(input))).toBe(false)
    } finally { off() }
    expect(seen.map((e) => e.areas)).toEqual([['crm', 'support']])
    // The feed: a reader of every area gets it, a reader missing one does not.
    await as({ crm: 'read', support: 'read' }, async () => expect(visibleChange(seen[0]!)?.scope).toBe('table:events'))
    await as({ crm: 'read' }, async () => expect(visibleChange(seen[0]!)).toBeNull())
  })
})
