// changesFeed per subscriber (W8 R3, PERMISSIONS 8.1 and 9.2): every delivery is admitted against the
// committed policy, so an event queued while the consumer paused is judged at its own delivery; a
// policy move is announced (`policy`) before the next event.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resetInstanceDir, setInstanceDir } from '@silkweave/box-core/testing'
import { accessOf, emitChange, fillRequest, freshRequestFrame, resolvePrincipalById, runInFrame, upsertRole, upsertUser, type Principal } from '@silkweave/box-core'
import { executor } from '@silkweave/box-core/warehouse/executor'
import { withClient } from '@silkweave/box-core/warehouse/pg/boot'
import { bumpRevisionInTransaction, lockPolicy } from '@silkweave/box-core/warehouse/pg/policy'
import { ChangesController } from './changes.controller.js'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'box-changes-feed-'))
  setInstanceDir(dir)
})

afterAll(() => {
  resetInstanceDir()
  rmSync(dir, { recursive: true, force: true })
})

describe('changesFeed', () => {
  it('judges a queued event at its own delivery after a revoke committed elsewhere', async () => {
    await upsertRole({ id: 'feed-crm', label: 'CRM reader', default: 'none', areas: { crm: 'read' } })
    await upsertRole({ id: 'feed-none', label: 'Nothing', default: 'none', areas: {} })
    await upsertUser({ id: 'feed-reader', first_name: 'Feed', role: 'feed-crm' })
    const principal = (await resolvePrincipalById('feed-reader')) as Principal
    const frame = freshRequestFrame()
    const access = await accessOf(principal)
    runInFrame(frame, () => fillRequest({ principal, access }))
    const feed = runInFrame(frame, () => new ChangesController().feed())
    const next = () => runInFrame(frame, () => feed.next())
    expect((await next()).value?.scope).toBe('hello')

    // Two events queue up; the consumer takes the first, then pauses.
    const first = next()
    emitChange('table:crm_deals')
    emitChange('table:crm_accounts')
    expect((await first).value?.scope).toBe('table:crm_deals')

    // Another process revokes crm (no listener here: this process's published policy stays older).
    const { host, port, database } = executor().target
    await withClient({ socket: host, port }, 'box_policy', database, async (c) => {
      await c.query('begin')
      await lockPolicy(c)
      await c.query(`update core.users set role = 'feed-none' where id = 'feed-reader'`)
      await bumpRevisionInTransaction(c)
      await c.query('commit')
    })

    // Resumed: the policy move first, then the queued crm event is withheld; a directory change
    // (every principal's) comes through, proving the crm one was skipped, not delayed.
    expect((await next()).value?.scope).toBe('policy')
    const after = next()
    emitChange('table:users')
    expect((await after).value?.scope).toBe('table:users')
    await feed.return(undefined)
  })

  it('announces a policy move published in this process at once, with no other event', async () => {
    await upsertRole({ id: 'feed-crm2', label: 'CRM reader', default: 'none', areas: { crm: 'read' } })
    await upsertUser({ id: 'feed-idle', first_name: 'Idle', role: 'feed-crm2' })
    const principal = (await resolvePrincipalById('feed-idle')) as Principal
    const frame = freshRequestFrame()
    const access = await accessOf(principal)
    runInFrame(frame, () => fillRequest({ principal, access }))
    const feed = runInFrame(frame, () => new ChangesController().feed())
    const next = () => runInFrame(frame, () => feed.next())
    expect((await next()).value?.scope).toBe('hello')

    // The feed is idle (no events, the ping 45 s away); the role loses crm through this process.
    const pending = next()
    await upsertRole({ id: 'feed-crm2', label: 'CRM reader', default: 'none', areas: {} })
    const first = await Promise.race([pending, new Promise<'late'>((r) => setTimeout(() => r('late'), 3000))])
    expect(first === 'late' ? first : first.value?.scope).toBe('policy')
    await feed.return(undefined)
  })
  it('keeps a policy move and a change published while the consumer holds hello (BOX-Review 0bfd114)', async () => {
    await upsertRole({ id: 'feed-crm3', label: 'CRM reader', default: 'none', areas: { crm: 'read' } })
    await upsertUser({ id: 'feed-gap', first_name: 'Gap', role: 'feed-crm3' })
    const principal = (await resolvePrincipalById('feed-gap')) as Principal
    const frame = freshRequestFrame()
    const access = await accessOf(principal)
    runInFrame(frame, () => fillRequest({ principal, access }))
    const feed = runInFrame(frame, () => new ChangesController().feed())
    const next = () => runInFrame(frame, () => feed.next())
    expect((await next()).value?.scope).toBe('hello')

    // The generator is suspended at hello: the role loses crm and a directory change lands before
    // the consumer pulls again. Neither may wait for the 45 s ping.
    await upsertRole({ id: 'feed-crm3', label: 'CRM reader', default: 'none', areas: {} })
    emitChange('table:users')
    const late = <T>(p: Promise<T>) => Promise.race([p, new Promise<'late'>((r) => setTimeout(() => r('late'), 3000))])
    const first = await late(next())
    expect(first === 'late' ? first : first.value?.scope).toBe('policy')
    const second = await late(next())
    expect(second === 'late' ? second : second.value?.scope).toBe('table:users')
    await feed.return(undefined)
  })

  it('releases a feed parked in its wait as soon as the caller is gone, not at the next wake', async () => {
    await upsertRole({ id: 'feed-crm4', label: 'CRM reader', default: 'none', areas: { crm: 'read' } })
    await upsertUser({ id: 'feed-gone', first_name: 'Gone', role: 'feed-crm4' })
    const principal = (await resolvePrincipalById('feed-gone')) as Principal
    const frame = freshRequestFrame()
    const access = await accessOf(principal)
    const gone = new AbortController()
    runInFrame(frame, () => fillRequest({ principal, access, closed: gone.signal }))
    const feed = runInFrame(frame, () => new ChangesController().feed())
    const next = () => runInFrame(frame, () => feed.next())
    expect((await next()).value?.scope).toBe('hello')
    const parked = next()
    await new Promise((r) => setTimeout(r, 100))
    gone.abort()
    const result = await Promise.race([parked, new Promise<'late'>((r) => setTimeout(() => r('late'), 3000))])
    expect(result).toMatchObject({ done: true })
  })
})
