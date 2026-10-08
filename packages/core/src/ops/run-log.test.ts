// The live run log against a throwaway warehouse: readable while a run is active, flushed to the
// row on a timer, kept and closed by the orphan sweep, written in full at finalization.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '../io.js'
import { withRead } from '../warehouse/db.js'
import { RUN_LOG_CAP, RUN_LOG_FLUSH_MS, appendRunLog, closeRunLog, liveRunLog, sliceRunLog } from './run-log.js'
import { finalizeRun, insertRun, markOrphanedRuns, markRunning, newRunId, readRun } from './runs.js'
import type { RunLogLine } from './types.js'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'box-run-log-'))
  setInstanceDir(dir)
})

afterAll(() => {
  resetInstanceDir()
  rmSync(dir, { recursive: true, force: true })
})

afterEach(() => {
  vi.useRealTimers()
})

async function startRun(): Promise<string> {
  const id = newRunId()
  await insertRun({ id, action_id: 'agent', trigger: 'manual', triggered_by: 'dan' })
  await markRunning(id)
  return id
}

const storedLog = async (id: string): Promise<RunLogLine[]> => {
  const rows = await withRead<{ log: string | null }>(`SELECT CAST(log AS VARCHAR) AS log FROM automation_runs WHERE id = ?`, [id])
  return rows[0]?.log ? (JSON.parse(rows[0].log) as RunLogLine[]) : []
}

const line = (message: string): Omit<RunLogLine, 'ts' | 'seq'> => ({ channel: 'test', phase: 'progress', message })

describe('run log', () => {
  it('serves the live lines of a running run, with after and tail', async () => {
    const id = await startRun()
    for (const m of ['one', 'two', 'three']) appendRunLog(id, line(m))
    const run = await readRun(id)
    expect(run?.status).toBe('running')
    expect(run?.log.map((l) => [l.seq, l.message])).toEqual([[0, 'one'], [1, 'two'], [2, 'three']])
    expect((await readRun(id, { after: 0 }))?.log.map((l) => l.message)).toEqual(['two', 'three'])
    expect((await readRun(id, { tail: 1 }))?.log.map((l) => l.message)).toEqual(['three'])
    await finalizeRun(id, { status: 'success', log: await closeRunLog(id) })
    expect(liveRunLog(id)).toBeNull()
    expect((await readRun(id))?.log.map((l) => l.message)).toEqual(['one', 'two', 'three'])
  })

  it('flushes to the row while running, at most once per interval', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const id = await startRun()
    appendRunLog(id, line('first'))
    appendRunLog(id, line('second'))
    expect(await storedLog(id)).toEqual([])
    await vi.advanceTimersByTimeAsync(RUN_LOG_FLUSH_MS)
    await vi.waitFor(async () => expect((await storedLog(id)).map((l) => l.message)).toEqual(['first', 'second']))
    await finalizeRun(id, { status: 'success', log: await closeRunLog(id) })
  })

  it('never flushes over a settled row', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const id = await startRun()
    appendRunLog(id, line('kept'))
    await finalizeRun(id, { status: 'error', error: 'stopped', log: [{ ts: '2026-10-09T00:00:00Z', channel: 'test', phase: 'done', message: 'final' }] })
    await vi.advanceTimersByTimeAsync(RUN_LOG_FLUSH_MS)
    await closeRunLog(id)
    expect((await storedLog(id)).map((l) => l.message)).toEqual(['final'])
  })

  it('keeps an orphaned run\'s flushed log and closes it with a line', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const id = await startRun()
    appendRunLog(id, line('tool call'))
    await vi.advanceTimersByTimeAsync(RUN_LOG_FLUSH_MS)
    await vi.waitFor(async () => expect(await storedLog(id)).toHaveLength(1))
    // A restart: the process (and its live buffer) is gone; the boot sweep finds the row running.
    await closeRunLog(id)
    expect(await markOrphanedRuns()).toBeGreaterThanOrEqual(1)
    const run = await readRun(id)
    expect(run).toMatchObject({ status: 'error', error: 'orphaned by server restart' })
    expect(run?.log.map((l) => [l.seq, l.message])).toEqual([
      [0, 'tool call'],
      [1, expect.stringMatching(/^error: orphaned by server restart; the log stops at \d{4}-/)],
    ])
  })

  it('caps the buffer but keeps each line\'s seq', async () => {
    const id = await startRun()
    for (let i = 0; i < RUN_LOG_CAP + 5; i++) appendRunLog(id, line(`l${i}`))
    const live = liveRunLog(id)!
    expect(live).toHaveLength(RUN_LOG_CAP)
    expect(live[0]).toMatchObject({ seq: 5, message: 'l5' })
    await finalizeRun(id, { status: 'success', log: await closeRunLog(id) })
  })

  it('reads stored lines without seq as their index', () => {
    const old: RunLogLine[] = [{ ts: 't', channel: 'c', phase: 'start', message: 'a' }, { ts: 't', channel: 'c', phase: 'done', message: 'b' }]
    expect(sliceRunLog(old).map((l) => l.seq)).toEqual([0, 1])
    expect(sliceRunLog(old, { after: 0 }).map((l) => l.message)).toEqual(['b'])
  })
})
