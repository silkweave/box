// Row security on core's shared tables (W8 R2; matrix A9 and BOX-Review finding 4): box_core sees and
// changes only rows whose stored area its frame reaches; box_system passes by its own policies.
// Principal frames on core reach run on box_core with the frame's area lists.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Access, AccessLevel } from '../../auth/access.js'
import { policyRevision } from '../../auth/access.js'
import type { Principal } from '../../auth/principal.js'
import { asBootstrap, asSystem, fillRequest, runInRequest } from '../../request-context.js'
import { withRead, withWrite } from '../db.js'

const CORE = { reach: 'core' } as const

/** Run `fn` as a principal holding `areas` (nothing else), on core reach. */
function as<T>(areas: Record<string, AccessLevel>, fn: () => Promise<T>, admin = false): Promise<T> {
  return runInRequest(() => {
    const access: Access = { role: 'r2-probe', areas: new Map(Object.entries(areas)), fallback: 'none', admin, revision: policyRevision() }
    fillRequest({ principal: { id: 'probe', display: 'Probe', role: 'r2-probe', kind: 'human' } as Principal, access })
    return fn()
  })
}
const ids = (sql: string) => withRead<{ id: string }>(sql, [], CORE).then((r) => r.map((x) => x.id).sort())
const run = (sql: string, params: unknown[] = []) => withWrite((tx) => tx.run(sql, params), CORE)
const RLS = /row-level security/

beforeAll(async () => {
  await asSystem('test: rls fixtures', () => withWrite(async (tx) => {
    for (const [id, area] of [['s-crm', 'crm'], ['s-sup', 'support'], ['s-adm', 'admin']]) {
      await tx.run(`insert into core.signals (id, label, signal_group, channel, source, "interval", accumulation, direction, description, depends_on, area, sort, created_at, updated_at)
        values ($1, $1, '', 'business', 'manual', 'day', 'snapshot', 'up', '', '[]'::jsonb, $2, 0, now(), now())`, [id, area])
      await tx.run(`insert into core.signal_points (signal_id, area, bucket, value, source, created_at, updated_at) values ($1, $2, '2026-11-01T00:00:00Z', 1, 'manual', now(), now())`, [id, area])
      await tx.run(`insert into core.snapshots (channel, snapshot_date, fetched_at, payload, area) values ($1, '2026-11-01', now(), '{}'::jsonb, $2)`, [id, area])
      await tx.run(`insert into core.automation_runs (id, action_id, trigger, status, started_at, area) values ($1, 'x', 'manual', 'success', now(), $2)`, [id, area])
    }
    for (const [id, areas] of [['e-crm', ['crm']], ['e-both', ['crm', 'support']], ['e-adm', ['admin']]] as const) {
      await tx.run(`insert into core.events (id, kind, dedup_key, areas) values ($1, 'r2.probe', $1, $2::text[])`, [id, areas])
    }
  }, CORE))
})
afterAll(async () => {
  await asSystem('test: rls fixtures', () => withWrite(async (tx) => {
    await tx.run(`delete from core.signal_points where signal_id like 's-%' or signal_id like 'n-%'`)
    await tx.run(`delete from core.signals where id like 's-%' or id like 'n-%'`)
  }, CORE))
})

describe('reads', () => {
  it('show only rows in a readable area, on every table', async () => {
    await as({ crm: 'read' }, async () => {
      expect(await ids(`select id from core.signals where id like 's-%'`)).toEqual(['s-crm'])
      expect(await ids(`select signal_id as id from core.signal_points where signal_id like 's-%'`)).toEqual(['s-crm'])
      expect(await ids(`select channel as id from core.snapshots where channel like 's-%'`)).toEqual(['s-crm'])
      expect(await ids(`select id from core.automation_runs where id like 's-%'`)).toEqual(['s-crm'])
      // An event needs every area it names.
      expect(await ids(`select id from core.events where kind = 'r2.probe'`)).toEqual(['e-crm'])
    })
    await as({ crm: 'read', support: 'read' }, async () => {
      expect(await ids(`select id from core.events where kind = 'r2.probe'`)).toEqual(['e-both', 'e-crm'])
      expect(await ids(`select id from core.signals where id like 's-%'`)).toEqual(['s-crm', 's-sup'])
    })
  })

  it('give admin rows to admin authority only, not to a role holding every area', async () => {
    await as({ crm: 'write', support: 'write', signals: 'write', ops: 'write' }, async () => {
      expect(await ids(`select id from core.signals where id like 's-%'`)).toEqual(['s-crm', 's-sup'])
      expect(await ids(`select id from core.events where kind = 'r2.probe'`)).toEqual(['e-both', 'e-crm'])
    })
    await as({}, async () => {
      expect(await ids(`select id from core.signals where id like 's-%'`)).toEqual(['s-adm'])
      expect(await ids(`select id from core.events where kind = 'r2.probe'`)).toEqual(['e-adm'])
    }, true)
  })

  it('deny everything without area context (bootstrap on box_core) and pass box_system by its own policy', async () => {
    await asBootstrap(async () => {
      expect(await ids(`select id from core.signals where id like 's-%'`)).toEqual([])
      expect(await ids(`select id from core.events where kind = 'r2.probe'`)).toEqual([])
    })
    await asSystem('test: rls system', async () => {
      expect(await ids(`select id from core.signals where id like 's-%'`)).toEqual(['s-adm', 's-crm', 's-sup'])
      expect(await ids(`select id from core.events where kind = 'r2.probe'`)).toEqual(['e-adm', 'e-both', 'e-crm'])
    })
  })
})

describe('writes', () => {
  const insertSignal = (id: string, area: string) =>
    run(`insert into core.signals (id, label, signal_group, channel, source, "interval", accumulation, direction, description, depends_on, area, sort, created_at, updated_at)
      values ($1, $1, '', 'business', 'manual', 'day', 'snapshot', 'up', '', '[]'::jsonb, $2, 0, now(), now())`, [id, area])

  it('refuse a new row outside the write areas (WITH CHECK), read access is not enough', async () => {
    await as({ crm: 'read' }, () => expect(insertSignal('n-1', 'crm')).rejects.toThrow(RLS))
    await as({ crm: 'write' }, () => expect(insertSignal('n-1', 'support')).rejects.toThrow(RLS))
    await as({ crm: 'write' }, async () => {
      // RETURNING reads the new row back through the SELECT policy: write implies read.
      const back = await withWrite((tx) => tx.query<{ id: string }>(`insert into core.signals (id, label, signal_group, channel, source, "interval", accumulation, direction, description, depends_on, area, sort, created_at, updated_at)
        values ('n-1', 'n', '', 'business', 'manual', 'day', 'snapshot', 'up', '', '[]'::jsonb, 'crm', 0, now(), now()) returning id`), CORE)
      expect(back).toEqual([{ id: 'n-1' }])
    })
  })

  it('refuse rebinding out of a writable area or into an unreachable one, and hide rows it cannot write', async () => {
    await as({ crm: 'write', support: 'read' }, async () => {
      await expect(run(`update core.signals set area = 'support' where id = 'n-1'`)).rejects.toThrow(RLS)
      // A readable but not writable row: the UPDATE's USING hides it, nothing changes.
      expect(await run(`update core.signals set area = 'crm' where id = 's-sup'`)).toBe(0)
      expect(await run(`delete from core.signals where id = 's-sup'`)).toBe(0)
      expect(await run(`delete from core.signal_points where signal_id = 's-sup'`)).toBe(0)
    })
    await as({ crm: 'write', support: 'write' }, async () => {
      expect(await run(`update core.signals set area = 'support' where id = 'n-1'`)).toBe(1)
      expect(await run(`update core.signals set area = 'crm' where id = 'n-1'`)).toBe(1)
    })
  })

  it('refuse ON CONFLICT DO UPDATE onto a row the frame cannot write', async () => {
    await as({ crm: 'write', support: 'read' }, async () => {
      await expect(run(`insert into core.signals (id, label, signal_group, channel, source, "interval", accumulation, direction, description, depends_on, area, sort, created_at, updated_at)
        values ('s-sup', 'x', '', 'business', 'manual', 'day', 'snapshot', 'up', '', '[]'::jsonb, 'crm', 0, now(), now())
        on conflict (id) do update set label = excluded.label, area = excluded.area`)).rejects.toThrow(RLS)
    })
    expect(await asSystem('test: rls check', () => withRead<{ label: string; area: string }>(`select label, area from core.signals where id = 's-sup'`, [], CORE))).toEqual([{ label: 's-sup', area: 'support' }])
  })

  it('tie points to their signal: same-row security, the area held to the signal by foreign key', async () => {
    const point = (id: string, area: string) => run(`insert into core.signal_points (signal_id, area, bucket, value, source, created_at, updated_at) values ($1, $2, '2026-11-02T00:00:00Z', 2, 'manual', now(), now())`, [id, area])
    // The writers' shape: the area comes from the signal row, read through row security.
    const derived = (id: string) => run(`insert into core.signal_points (signal_id, area, bucket, value, source, created_at, updated_at)
      select s.id, s.area, '2026-11-03T00:00:00Z', 3, 'manual', now(), now() from core.signals s where s.id = $1`, [id])
    await as({ crm: 'write', support: 'read' }, async () => {
      await expect(point('s-sup', 'support')).rejects.toThrow(RLS)
      // A forged area that the frame can write: the foreign key refuses it.
      await expect(point('s-sup', 'crm')).rejects.toThrow(/foreign key/)
      await expect(point('no-such-signal', 'crm')).rejects.toThrow(/foreign key/)
      expect(await derived('s-adm')).toBe(0)
      expect(await point('s-crm', 'crm')).toBe(1)
      expect(await derived('s-crm')).toBe(1)
      // The record layer locks rows (SELECT ... FOR UPDATE); pgrust refused that under a subquery policy.
      const locked = await withWrite((tx) => tx.query<{ signal_id: string }>(`select signal_id from core.signal_points where signal_id in ('s-crm', 's-sup') for update`), CORE)
      expect([...new Set(locked.map((r) => r.signal_id))]).toEqual(['s-crm'])
      // Moving a point on its own is refused (the new row's area is not writable, or the key is not the signal's).
      await expect(run(`update core.signal_points set area = 'support' where signal_id = 's-crm'`)).rejects.toThrow(RLS)
    })
    // A rebind and a rename of the signal carry its points (ON UPDATE CASCADE); row security follows.
    await asSystem('test: rls rebind', () => run(`update core.signals set area = 'support' where id = 's-crm'`))
    await as({ crm: 'write' }, async () => expect(await ids(`select signal_id as id from core.signal_points where signal_id = 's-crm'`)).toEqual([]))
    await asSystem('test: rls rebind', async () => {
      expect(await withRead<{ area: string }>(`select distinct area from core.signal_points where signal_id = 's-crm'`, [], CORE)).toEqual([{ area: 'support' }])
      await run(`update core.signals set id = 's-crm2', area = 'crm' where id = 's-crm'`)
      expect(await withRead<{ id: string; area: string }>(`select distinct signal_id id, area from core.signal_points where signal_id like 's-crm%'`, [], CORE)).toEqual([{ id: 's-crm2', area: 'crm' }])
      await run(`update core.signals set id = 's-crm' where id = 's-crm2'`)
    })
    // Deleting a signal takes its points.
    await as({ crm: 'write' }, async () => {
      await insertSignal('n-del', 'crm')
      expect(await point('n-del', 'crm')).toBe(1)
      expect(await run(`delete from core.signals where id = 'n-del'`)).toBe(1)
    })
    expect(await asSystem('test: rls check', () => withRead(`select 1 from core.signal_points where signal_id = 'n-del'`, [], CORE))).toEqual([])
  })

  it('keep events append-only for box_core and refuse an event naming an unwritable area', async () => {
    const event = (id: string, areas: string[]) => run(`insert into core.events (id, kind, dedup_key, areas) values ($1, 'r2.probe', $1, $2::text[])`, [id, areas])
    await as({ crm: 'write', support: 'read' }, async () => {
      await expect(event('e-new', ['crm', 'support'])).rejects.toThrow(RLS)
      expect(await event('e-new', ['crm'])).toBe(1)
      expect(await run(`update core.events set kind = 'r2.changed' where id = 'e-crm'`)).toBe(0)
      expect(await run(`delete from core.events where id = 'e-crm'`)).toBe(0)
    })
  })
})
