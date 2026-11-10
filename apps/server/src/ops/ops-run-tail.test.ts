// opsRunTail against a throwaway warehouse: the log so far, each new line as it is written, then a
// settled chunk once the run is finalized; a settled run yields one chunk and ends.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '@silkweave/box-core/testing'
import { accessOf, appendRunLog, closeRunLog, fillRequest, finalizeRun, freshRequestFrame, insertRun, markRunning, newRunId, resolvePrincipalById, runInFrame, upsertRole, upsertUser, type Principal } from '@silkweave/box-core'
import { executor } from '@silkweave/box-core/warehouse/executor'
import { withClient } from '@silkweave/box-core/warehouse/pg/boot'
import { bumpRevisionInTransaction, lockPolicy } from '@silkweave/box-core/warehouse/pg/policy'
import { OpsController } from './ops.controller.js'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'box-run-tail-'))
  setInstanceDir(dir)
})

afterAll(() => {
  resetInstanceDir()
  rmSync(dir, { recursive: true, force: true })
})

type Line = { seq?: number; message: string }

const line = (message: string) => ({ channel: 'test', phase: 'progress', message })

describe('opsRunTail', () => {
  it('follows a running run line by line and ends on its outcome', async () => {
    const id = newRunId()
    await insertRun({ id, action_id: 'agent', trigger: 'manual', triggered_by: 'dan', acts_as: 'dan' })
    await markRunning(id)
    appendRunLog(id, line('one'))

    const tail = new OpsController().runTail({ id })
    const first = await tail.next()
    expect(first.value).toMatchObject({ status: 'running', done: false })
    expect(first.value?.lines.map((l: Line) => l.message)).toEqual(['one'])

    const second = tail.next()
    appendRunLog(id, line('two'))
    expect((await second).value?.lines.map((l: Line) => [l.seq, l.message])).toEqual([[1, 'two']])

    const third = tail.next()
    appendRunLog(id, line('three'))
    const log = await closeRunLog(id)
    await finalizeRun(id, { status: 'success', summary: 'all good', log })
    // The line, then (after the change feed announces the settled row) the outcome.
    const chunks = [(await third).value]
    while (!chunks.at(-1)?.done) chunks.push((await tail.next()).value)
    expect(chunks.flatMap((c) => c?.lines.map((l: Line) => l.message) ?? [])).toEqual(['three'])
    expect(chunks.at(-1)).toMatchObject({ status: 'success', done: true, summary: 'all good' })
    expect((await tail.next()).done).toBe(true)
  })

  it('answers a settled run with one chunk, honouring after', async () => {
    const id = newRunId()
    await insertRun({ id, action_id: 'agent', trigger: 'manual', triggered_by: 'dan', acts_as: 'dan' })
    for (const m of ['a', 'b', 'c']) appendRunLog(id, line(m))
    await finalizeRun(id, { status: 'error', error: 'boom', log: await closeRunLog(id) })

    const tail = new OpsController().runTail({ id, after: 0 })
    const only = await tail.next()
    expect(only.value).toMatchObject({ status: 'error', done: true, error: 'boom' })
    expect(only.value?.lines.map((l: Line) => l.message)).toEqual(['b', 'c'])
    expect((await tail.next()).done).toBe(true)
  })

  it('stops handing out lines once a revoke commits elsewhere, before this process hears of it', async () => {
    await upsertRole({ id: 'tail-ops', label: 'Ops reader', default: 'none', areas: { ops: 'read' } })
    await upsertRole({ id: 'tail-none', label: 'Nothing', default: 'none', areas: {} })
    await upsertUser({ id: 'tail-reader', first_name: 'Tail', role: 'tail-ops' })
    const id = newRunId()
    await insertRun({ id, action_id: 'warehouse-backup', trigger: 'manual', triggered_by: null })
    await markRunning(id)
    appendRunLog(id, line('before'))
    const principal = (await resolvePrincipalById('tail-reader')) as Principal
    const frame = freshRequestFrame()
    const access = await accessOf(principal)
    runInFrame(frame, () => fillRequest({ principal, access }))
    const tail = runInFrame(frame, () => new OpsController().runTail({ id }))
    expect((await runInFrame(frame, () => tail.next())).value?.lines.map((l: Line) => l.message)).toEqual(['before'])
    // Another process revokes (no listener here: this process's published policy stays older).
    const { host, port, database } = executor().target
    await withClient({ socket: host, port }, 'box_policy', database, async (c) => {
      await c.query('begin')
      await lockPolicy(c)
      await c.query(`update core.users set role = 'tail-none' where id = 'tail-reader'`)
      await bumpRevisionInTransaction(c)
      await c.query('commit')
    })
    const next = runInFrame(frame, () => tail.next())
    appendRunLog(id, line('after the revoke'))
    const end = await next
    expect(end.done).toBe(true)
    expect(JSON.stringify(end.value ?? null)).not.toContain('after the revoke')
    await finalizeRun(id, { status: 'success', log: await closeRunLog(id) })
  })

  it('refuses an unknown run', async () => {
    await expect(new OpsController().runTail({ id: 'run-nope' }).next()).rejects.toThrow(/no run/)
  })
})
