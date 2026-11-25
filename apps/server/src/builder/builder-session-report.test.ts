import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applySessionReport, parseReadyReport, parseTaskPlan, readSessionReport } from './builder-session-report.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const instance = (): string => { const root = mkdtempSync(join(tmpdir(), 'builder-report-')); roots.push(root); return root }

describe('builder session report', () => {
  it('validates a task plan and rejects malformed tasks', () => {
    expect(parseTaskPlan({ tasks: [{ title: 'Fetch', status: 'done', estimateMinutes: 2.4 }, { title: 'Build' }] }))
      .toEqual([{ title: 'Fetch', status: 'done', estimateMinutes: 2 }, { title: 'Build', status: 'pending' }])
    expect(() => parseTaskPlan({ tasks: [] })).toThrow('non-empty')
    expect(() => parseTaskPlan({ tasks: [{ title: 'x', status: 'later' }] })).toThrow('pending, running or done')
    expect(() => parseTaskPlan({ tasks: [{ title: 'x', estimateMinutes: -1 }] })).toThrow('minutes')
  })

  it('validates a ready report', () => {
    expect(parseReadyReport({ summary: ' Done ', try: ['Open it'], commitMessage: 'feat: x' }))
      .toEqual({ summary: 'Done', built: [], try: ['Open it'], open: [], commitMessage: 'feat: x' })
    expect(() => parseReadyReport({ built: ['x'] })).toThrow('summary')
    expect(() => parseReadyReport({ summary: 'x', try: 'Open it' })).toThrow('array')
  })

  it('keeps task start and finish times across re-sent plans', () => {
    const dir = instance()
    applySessionReport(dir, 's1', 'tasks', { tasks: [{ title: 'A', status: 'running' }, { title: 'B' }] }, '2026-11-25T10:00:00.000Z')
    const next = applySessionReport(dir, 's1', 'tasks', { tasks: [{ title: 'A', status: 'done' }, { title: 'B', status: 'running' }] }, '2026-11-25T10:05:00.000Z')
    expect(next.plan).toEqual({
      startedAt: '2026-11-25T10:00:00.000Z',
      updatedAt: '2026-11-25T10:05:00.000Z',
      tasks: [
        { title: 'A', status: 'done', startedAt: '2026-11-25T10:00:00.000Z', doneAt: '2026-11-25T10:05:00.000Z' },
        { title: 'B', status: 'running', startedAt: '2026-11-25T10:05:00.000Z' },
      ],
    })
  })

  it('keeps the plan beside the ready report and forgets both for another session', () => {
    const dir = instance()
    applySessionReport(dir, 's1', 'tasks', { tasks: [{ title: 'A', status: 'done' }] })
    applySessionReport(dir, 's1', 'ready', { summary: 'Ready' })
    expect(readSessionReport(dir, 's1')).toMatchObject({ plan: { tasks: [{ title: 'A' }] }, ready: { summary: 'Ready' } })
    expect(readSessionReport(dir, 's2')).toBeNull()
    applySessionReport(dir, 's2', 'ready', { summary: 'Other' })
    expect(readSessionReport(dir, 's2')?.plan).toBeUndefined()
    expect(() => applySessionReport(dir, 's2', 'other', {})).toThrow('tasks or ready')
  })
})
