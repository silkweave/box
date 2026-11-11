// The record layer on PostgreSQL: instants (PHASE1.md choice 7), routing by table owner (core's
// shared tables on box_core, a feature's on the role login), and the upsert's transaction.

import { describe, expect, it } from 'vitest'
import type { Access } from '../auth/access.js'
import { policyRevision } from '../auth/policy-revision.js'
import type { Principal } from '../auth/principal.js'
import { FEATURE_LIST } from '../generated/features.js'
import { fillRequest, runInRequest } from '../request-context.js'
import { USERS, KV_STATE } from './core-models.js'
import { getKvState, setKvState, withRead, withWrite } from './db.js'
import { ExecutorError } from './executor.js'
import { changedColumns, instantMicros, readRecord, readRecords, rowToRecord, sameRecord, toInstant, toParam, upsertRecord, type ModelSpec } from './model.js'
import { createTableSql } from './pg/ddl.js'
import { reachOf, table } from './tables.js'

const asMember = <T>(fn: () => Promise<T>): Promise<T> =>
  runInRequest(() => {
    const access: Access = { role: 'member', areas: new Map(), fallback: 'write', admin: false, revision: policyRevision() }
    fillRequest({ principal: { id: 'mia', display: 'Mia', role: 'member', kind: 'human' } as Principal, access })
    return fn()
  })

describe('changedColumns', () => {
  const m = {
    table: 't', pk: ['id'],
    columns: { id: { kind: 'text' }, title: { kind: 'text' }, status: { kind: 'text' }, done_at: { kind: 'timestamp', nullable: true } },
  } as unknown as ModelSpec
  const prev = { id: 'a', title: 'A', status: 'active', done_at: null }

  it('sends the key, the actor and what changed, nothing equal to the read', () => {
    expect(changedColumns(m, prev, { id: 'a', title: 'B', status: 'active', done_at: null, actor: 'mia' })).toEqual({ id: 'a', title: 'B', actor: 'mia' })
  })

  it('sends a whole group when one of its columns changes, including a clear equal to the read', () => {
    const next = { id: 'a', title: 'A', status: 'planned', done_at: null }
    expect(changedColumns(m, prev, next)).toEqual({ id: 'a', status: 'planned' })
    expect(changedColumns(m, prev, next, [['status', 'done_at']])).toEqual({ id: 'a', status: 'planned', done_at: null })
    expect(changedColumns(m, prev, { ...next, status: 'active', title: 'C' }, [['status', 'done_at']])).toEqual({ id: 'a', title: 'C' })
  })
})

describe('instants', () => {
  it('passes ISO text through and converts other date strings', () => {
    expect(toInstant('2026-11-06T05:00:01.123456Z')).toBe('2026-11-06T05:00:01.123456Z')
    expect(toInstant('2026-11-06 05:00:01')).toBe('2026-11-06 05:00:01')
    expect(toInstant(new Date(Date.UTC(2026, 10, 6)))).toBe('2026-11-06T00:00:00.000Z')
    expect(() => toInstant('not a time')).toThrow(/invalid timestamp/)
  })

  it('compares offset-equivalent instants as equal, at microsecond precision', () => {
    expect(instantMicros('2026-11-06T13:00:00+08:00')).toBe(instantMicros('2026-11-06T05:00:00Z'))
    expect(instantMicros('2026-11-06T05:00:00.000001Z')).toBeGreaterThan(instantMicros('2026-11-06T05:00:00Z'))
    expect(instantMicros('2026-11-06 05:00:00')).toBe(instantMicros('2026-11-06T05:00:00Z'))
    const m: ModelSpec = { table: 't', pk: ['id'], columns: { id: { kind: 'text' }, at: { kind: 'timestamp' } } }
    expect(sameRecord(m, { id: 'a', at: '2026-11-06T05:00:00Z' }, { id: 'a', at: '2026-11-06T06:00:00+01:00' })).toBe(true)
    expect(sameRecord(m, { id: 'a', at: '2026-11-06T05:00:00Z' }, { id: 'a', at: '2026-11-06T05:00:00.5Z' })).toBe(false)
  })

  it('stores microseconds and reads them back exactly, and dates independent of the host zone', async () => {
    const rows = await withRead<{ at: string; d: string; big: number }>(
      `select $1::timestamptz as at, $2::date as d, 9007199254740991::int8 as big`,
      ['2026-11-06T13:00:01.123456+08:00', '2026-03-01'],
      { reach: 'core' },
    )
    expect(rows[0]).toEqual({ at: '2026-11-06T05:00:01.123456Z', d: '2026-03-01', big: 9007199254740991 })
  })
})

describe('the record layer', () => {
  it('round-trips a core record with parsed json and exact timestamps', async () => {
    const saved = await upsertRecord<Record<string, unknown>>(USERS, { id: 'rec-a', first_name: 'A', channels: { slack: 'a' }, token_issued_at: '2026-11-06T13:00:00.250+08:00' })
    expect(saved.channels).toEqual({ slack: 'a' })
    expect(saved.token_issued_at).toBe('2026-11-06T05:00:00.25Z')
    const again = await upsertRecord<Record<string, unknown>>(USERS, { id: 'rec-a', nickname: 'Ay' })
    expect(again.first_name).toBe('A') // absent keys keep the previous values
    expect(again.created_at).toBe(saved.created_at)
    expect((await readRecords(USERS, { where: 'id = $1', params: ['rec-a'], limit: 1 })).length).toBe(1)
  })

  it('routes core tables to box_core and feature tables to the role login', async () => {
    const feature = FEATURE_LIST.find((f) => f.models.length > 0)!
    const fm = feature.models[0]!
    expect(reachOf(USERS)).toBe('core')
    expect(reachOf(fm)).toBe('area')
    expect(table(USERS)).toBe('"core"."users"')
    await asMember(async () => {
      const who = await withRead<{ u: string }>(`select current_user as u`, [], { reach: 'core' })
      expect(who[0]!.u).toBe('box_core')
      const role = await withRead<{ u: string }>(`select current_user as u`)
      expect(role[0]!.u).toMatch(/^box_role_\d+$/)
      await setKvState('member-key', { ok: true })
      expect(await getKvState('member-key')).toEqual({ ok: true })
      expect(await readRecords(fm)).toEqual([])
      // A role login cannot read core's shared tables directly.
      await expect(withRead(`select id from ${table(USERS)}`)).rejects.toThrow(/permission denied/)
      // Nor can a core accessor open inside a feature transaction.
      await expect(withWrite(async () => readRecord(USERS, { id: 'rec-a' }))).rejects.toBeInstanceOf(ExecutorError)
    })
  })

  it('rolls an upsert back with its transaction and publishes nothing', async () => {
    await expect(withWrite(async () => {
      await upsertRecord(KV_STATE, { key: 'rolled', value: 1 })
      throw new Error('stop')
    }, { reach: 'core' })).rejects.toThrow('stop')
    expect(await getKvState('rolled')).toBeNull()
  })
})

describe('search column kinds', () => {
  const m: ModelSpec = {
    table: 'probe',
    pk: ['id'],
    columns: { id: { kind: 'text' }, tsv: { kind: 'tsvector' }, emb: { kind: 'vector', dimensions: 3 } },
  }

  it('emit tsvector and a dimensioned pgvector type from the ext schema', () => {
    const sql = createTableSql(m, 'probe_area')
    expect(sql).toContain('"tsv" tsvector not null')
    expect(sql).toContain('"emb" ext.vector(3) not null')
    expect(() => createTableSql({ ...m, columns: { id: { kind: 'text' }, emb: { kind: 'vector' } } }, 'probe_area')).toThrow(/dimensions/)
  })

  it('write a vector as pgvector text and read it back as numbers', () => {
    expect(toParam({ kind: 'vector', dimensions: 3 }, [1, 0.5, -2])).toBe('[1,0.5,-2]')
    expect(() => toParam({ kind: 'vector', dimensions: 3 }, [1, Number.NaN, 0])).toThrow(/finite/)
    expect(rowToRecord<{ emb: number[] }>(m, { id: 'a', tsv: "'a':1", emb: '[1,0.5,-2]' }).emb).toEqual([1, 0.5, -2])
  })
})
