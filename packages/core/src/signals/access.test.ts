// Signal accessors by area (W8 R3, PERMISSIONS 8.1 to 8.3): reads filtered by every area of a
// signal's closure, writes authorized on the old and new area, rename and delete as fixed core
// commands that cascade across areas without naming what the caller cannot read.

import { beforeAll, describe, expect, it } from 'vitest'
import type { Access, AccessLevel } from '../auth/access.js'
import { policyRevision } from '../auth/access.js'
import type { Principal } from '../auth/principal.js'
import { asSystem, fillRequest, runInRequest } from '../request-context.js'
import { withRead, withWrite } from '../warehouse/db.js'
import { insertPoints, pointWrite } from './write.js'
import { deleteSignalDefinition, readSignalDefinition, readSignalDefinitions, renameSignalDefinition, upsertSignalDefinition } from './definitions.js'
import { setSignalPoint } from './points.js'
import { readDataSource, readDataSources } from './sources/state.js'
import { onChange, type ChangeEvent } from '../changes.js'

function as<T>(areas: Record<string, AccessLevel>, fn: () => Promise<T>): Promise<T> {
  return runInRequest(() => {
    const access: Access = { role: 'r3-probe', areas: new Map(Object.entries(areas)), fallback: 'none', admin: false, revision: policyRevision() }
    fillRequest({ principal: { id: 'probe', display: 'Probe', role: 'r3-probe', kind: 'human' } as Principal, access })
    return fn()
  })
}
const sys = <T>(fn: () => Promise<T>) => asSystem('test: signal access', fn)
const ids = async () => (await readSignalDefinitions()).map((d) => d.id).filter((id) => id.startsWith('a-')).sort()
const pointsOf = (id: string) => sys(() => withRead<{ n: number }>(`select count(*)::int n from core.signal_points where signal_id = $1`, [id], { reach: 'core' })).then((r) => r[0]!.n)

beforeAll(async () => {
  await sys(async () => {
    await upsertSignalDefinition({ id: 'a-crm', area: 'crm' })
    await upsertSignalDefinition({ id: 'a-sup', area: 'support' })
    await upsertSignalDefinition({ id: 'a-f', formula: 'a-crm + a-sup' })
    await setSignalPoint({ signal_id: 'a-crm', at: '2026-11-01', value: 3 })
  })
})

describe('reads', () => {
  it('hide a formula whose input is hidden, and every signal outside the readable areas', async () => {
    await as({ crm: 'read', signals: 'read' }, async () => {
      expect(await ids()).toEqual(['a-crm'])
      expect(await readSignalDefinition('a-f')).toBeNull()
      expect(await readSignalDefinition('a-sup')).toBeNull()
    })
    await as({ crm: 'read', signals: 'read', support: 'read' }, async () => {
      expect(await ids()).toEqual(['a-crm', 'a-f', 'a-sup'])
      expect((await readSignalDefinition('a-f'))?.area).toBe('signals')
    })
  })
})

describe('writes', () => {
  it('need write on the current area and on the new one; a hidden row reads as not found', async () => {
    await as({ crm: 'read' }, () => expect(upsertSignalDefinition({ id: 'a-crm', label: 'x' })).rejects.toMatchObject({ area: 'crm', needed: 'write' }))
    await as({ crm: 'write' }, async () => {
      await expect(upsertSignalDefinition({ id: 'a-new', area: 'support' })).rejects.toMatchObject({ area: 'support', needed: 'write' })
      await expect(upsertSignalDefinition({ id: 'a-sup', label: 'x' })).rejects.toThrow(/signal id a-sup is not available/)
      // A hidden id is unknown as a dependency (its existence is not confirmed).
      await expect(upsertSignalDefinition({ id: 'a-crm', depends_on: ['a-sup'] })).rejects.toThrow(/unknown signal\(s\) a-sup/)
      expect((await upsertSignalDefinition({ id: 'a-crm', label: 'CRM' })).label).toBe('CRM')
    })
    // A formula row in a writable area but with a hidden input is hidden too.
    await as({ crm: 'write', signals: 'write' }, () => expect(upsertSignalDefinition({ id: 'a-f', label: 'x' })).rejects.toThrow(/signal a-f not found/))
    await as({ crm: 'write', support: 'write' }, async () => {
      // Moving a row needs both ends.
      expect((await upsertSignalDefinition({ id: 'a-move', area: 'crm' })).area).toBe('crm')
      expect((await upsertSignalDefinition({ id: 'a-move', area: 'support' })).area).toBe('support')
    })
    await as({ crm: 'write', support: 'read' }, () => expect(upsertSignalDefinition({ id: 'a-move', area: 'crm' })).rejects.toMatchObject({ area: 'support', needed: 'write' }))
  })
})

describe('rename and delete', () => {
  it('rename cascades into formulas the caller cannot write, as one system transaction', async () => {
    await as({ crm: 'write', support: 'read', signals: 'read' }, () => renameSignalDefinition('a-crm', 'a-crm2'))
    const f = await sys(() => readSignalDefinition('a-f'))
    expect(f?.formula).toBe('a-crm2 + a-sup')
    expect(f?.depends_on).toEqual(['a-crm2', 'a-sup'])
    expect(await pointsOf('a-crm2')).toBe(1)
    expect(await pointsOf('a-crm')).toBe(0)
    await as({ support: 'read' }, () => expect(renameSignalDefinition('a-crm2', 'a-x')).rejects.toThrow(/signal a-crm2 not found/))
  })

  it('delete refuses while a formula reads the signal, naming only formulas the caller can read', async () => {
    await as({ crm: 'write' }, () => expect(deleteSignalDefinition('a-crm2')).rejects.toThrow(/cannot delete a-crm2: 1 formula signal\(s\) you cannot see read it/))
    await as({ crm: 'write', signals: 'read', support: 'read' }, () => expect(deleteSignalDefinition('a-crm2')).rejects.toThrow(/cannot delete a-crm2: formula signal\(s\) a-f read it/))
  })

  it('delete takes the points with the definition', async () => {
    await sys(() => upsertSignalDefinition({ id: 'a-gone', area: 'crm' }))
    await sys(() => setSignalPoint({ signal_id: 'a-gone', at: '2026-11-01', value: 1 }))
    await as({ crm: 'read' }, () => expect(deleteSignalDefinition('a-gone')).rejects.toMatchObject({ area: 'crm', needed: 'write' }))
    const report = await as({ crm: 'write' }, () => deleteSignalDefinition('a-gone'))
    expect(report.warnings).toEqual([])
    expect(await pointsOf('a-gone')).toBe(0)
  })
})

describe('points', () => {
  it('need write on the signal; an unreadable signal is not found', async () => {
    await sys(() => upsertSignalDefinition({ id: 'a-pts', area: 'crm' }))
    await as({ crm: 'read' }, () => expect(setSignalPoint({ signal_id: 'a-pts', at: '2026-11-02', value: 1 })).rejects.toMatchObject({ area: 'crm', needed: 'write' }))
    await as({ support: 'write' }, () => expect(setSignalPoint({ signal_id: 'a-pts', at: '2026-11-02', value: 1 })).rejects.toThrow(/signal a-pts not found/))
    await as({ crm: 'write' }, () => setSignalPoint({ signal_id: 'a-pts', at: '2026-11-02', value: 1 }))
    expect(await pointsOf('a-pts')).toBe(1)
  })
})

describe('point writes against a concurrent delete (BOX-Review slice 2, 4)', () => {
  it('lock the signals: a delete after the check waits, then removes the points it wrote; nothing is dropped silently', async () => {
    await sys(() => upsertSignalDefinition({ id: 'a-race', area: 'crm' }))
    const locked = gate()
    const resume = gate()
    const write = as({ crm: 'write' }, () => pointWrite([{ id: 'a-race', area: 'crm' }], async (tx) => {
      locked.open()
      await resume.p
      await insertPoints(tx, [{ signal_id: 'a-race', bucket: '2026-11-01T00:00:00Z', value: 1 }], 'live')
    }))
    await locked.p
    let deleted = false
    const del = sys(() => withWrite((tx) => tx.run(`delete from core.signals where id = 'a-race'`), { reach: 'core' })).then(() => { deleted = true })
    await new Promise((r) => setTimeout(r, 300))
    expect(deleted).toBe(false)
    resume.open()
    await write
    await del
    expect(await pointsOf('a-race')).toBe(0)
  })

  it('refuse the whole write when a signal is already gone', async () => {
    await expect(as({ crm: 'write' }, () => pointWrite([{ id: 'a-crm', area: 'crm' }, { id: 'a-gone', area: 'crm' }], async () => undefined))).rejects.toThrow(/gone or belong to another area/)
  })
})

function gate() { let open!: () => void; const p = new Promise<void>((r) => { open = r }); return { p, open } }

describe('data sources', () => {
  it('need signals read (one area for the table, checked by the accessor)', async () => {
    await sys(() => withWrite((tx) => tx.run(`insert into core.data_sources (id, provider, label) values ('a-src', 'probe', 'Probe') on conflict do nothing`), { reach: 'core' }))
    await as({ crm: 'write' }, async () => {
      expect(await readDataSources()).toEqual([])
      expect(await readDataSource('a-src')).toBeNull()
    })
    await as({ signals: 'read' }, async () => {
      expect((await readDataSources()).map((s) => s.id)).toContain('a-src')
      expect((await readDataSource('a-src'))?.label).toBe('Probe')
    })
  })
})

describe('change events', () => {
  it('carry the owning areas of the rows a write touched (the feed delivers by them)', async () => {
    const seen: ChangeEvent[] = []
    const off = onChange((ev) => { if (ev.scope.startsWith('table:signal')) seen.push(ev) })
    try {
      await sys(() => setSignalPoint({ signal_id: 'a-sup', at: '2026-11-02', value: 1 }))
      await sys(() => upsertSignalDefinition({ id: 'a-sup', label: 'Support' }))
    } finally { off() }
    expect(seen.map((e) => [e.scope, e.areas])).toEqual([
      ['table:signal_points', ['support']],
      ['table:signals', ['support']],
    ])
  })
})
