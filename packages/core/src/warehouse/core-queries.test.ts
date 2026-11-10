// Core accessor queries (Kysely on the executor, core-db.ts) that the other suites do not reach: the
// range-scoped live replace, increments derived from events, the full points read, user reordering,
// the trigger-run cap count and the data-source reads.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '../testing.js'
import { GATE_DECLINED_PREFIX, countTriggerRunsSince, insertSkippedRun } from '../ops/runs.js'
import { upsertSignalDefinition } from '../signals/definitions.js'
import { deriveSignalIncrements, readAllSignalPointRecords, readSignalPointRecords, recordSignalIncrement, replaceLiveSignalPoints, setSignalPoints } from '../signals/points.js'
import { readDataSourceViews, readSourceBindings, upsertDataSource } from '../signals/sources/state.js'
import { readSnapshots, upsertSnapshot } from '../signals/write.js'
import { readUsers, reorderUsers, upsertUser } from '../users/state.js'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'box-core-queries-'))
  setInstanceDir(dir)
})

afterAll(() => {
  resetInstanceDir()
  rmSync(dir, { recursive: true, force: true })
})

describe('signal points', () => {
  it('replaces live points within a range, with and without an upper bound, and reads them all back', async () => {
    await upsertSignalDefinition({ id: 'q-live', label: 'Live' })
    await replaceLiveSignalPoints(['q-live'], { from: '2026-10-01' }, [1, 2, 3, 4].map((d) => ({ signal_id: 'q-live', at: `2026-10-0${d}`, value: d })))
    await replaceLiveSignalPoints(['q-live'], { from: '2026-10-02', to: '2026-10-03' }, [{ signal_id: 'q-live', at: '2026-10-02', value: 20 }])
    const rows = await readSignalPointRecords('q-live')
    expect(rows.map((r) => r.value)).toEqual([1, 20, 4])
    expect((await readAllSignalPointRecords()).filter((r) => r.signal_id === 'q-live')).toHaveLength(3)
    await replaceLiveSignalPoints(['q-live'], { from: '2026-10-03' }, [])
    expect((await readSignalPointRecords('q-live')).map((r) => r.value)).toEqual([1, 20])
    await setSignalPoints('q-live', [{ at: '2026-10-09', value: 9, note: 'by hand' }])
  })

  it('derives an increment signal from its events', async () => {
    await upsertSignalDefinition({ id: 'q-inc', label: 'Inc', accumulation: 'increment' })
    await recordSignalIncrement({ signal_id: 'q-inc', at: '2026-10-01T10:00:00Z', dedup_key: 'a' })
    await recordSignalIncrement({ signal_id: 'q-inc', at: '2026-10-01T11:00:00Z', dedup_key: 'b' })
    expect(await deriveSignalIncrements('q-inc')).toBe(1)
    expect((await readSignalPointRecords('q-inc')).map((r) => r.value)).toEqual([2])
  })
})

describe('users and runs', () => {
  it('reorders users by the given id order', async () => {
    await upsertUser({ id: 'q-a', first_name: 'A' })
    await upsertUser({ id: 'q-b', first_name: 'B' })
    await reorderUsers(['q-b', 'q-a'])
    const order = (await readUsers()).filter((u) => u.id.startsWith('q-')).map((u) => u.id)
    expect(order).toEqual(['q-b', 'q-a'])
  })

  it('counts started runs and gate declines toward a trigger cap, not guard skips', async () => {
    const run = { trigger: 'event' as const, triggerId: 'q-trigger', actionId: 'sources-sync' }
    await insertSkippedRun(run, `${GATE_DECLINED_PREFIX}: not worth a job`)
    await insertSkippedRun(run, 'busy: already running')
    expect(await countTriggerRunsSince('q-trigger', '2000-01-01T00:00:00Z')).toBe(1)
  })
})

describe('data sources', () => {
  it('reads bindings and refuses an id some channel already writes snapshots under', async () => {
    expect(await readSourceBindings('q-none')).toEqual([])
    expect(await readDataSourceViews()).toEqual([])
    await upsertSnapshot('q-channel', '2026-10-01', { ok: true }, 'signals')
    expect((await readSnapshots('q-channel')).map((r) => r.snapshot_date)).toEqual(['2026-10-01'])
    await expect(upsertDataSource({ id: 'q-channel', provider: 'any' })).rejects.toThrow(/already keys 1 snapshot row/)
  })
})
