// Runs under policy change (BOX-Review of d613f4e): a detached run's tail authorizes every delivery
// against the committed policy (finding 1), a request run is admitted again after its queue wait
// (finding 3), agent coverage reads reader and agent at one generation and fails closed on a role
// the generation does not define (finding 4), and an agent trigger's skip row keeps its principal.
// "Another process" commits policy through a raw box_policy session this process does not hear of.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { accessOf, AreaAccessError } from '../auth/access.js'
import { resolvePrincipalById, type Principal } from '../auth/principal.js'
import { upsertRole } from '../auth/roles.js'
import { fillRequest, freshRequestFrame, runInFrame, type ContextFrame } from '../request-context.js'
import { upsertUser } from '../users/state.js'
import { withRead } from '../warehouse/db.js'
import { executor, setAfterAdmissionForTests } from '../warehouse/executor.js'
import { withClient } from '../warehouse/pg/boot.js'
import { bumpRevisionInTransaction, lockPolicy } from '../warehouse/pg/policy.js'
import type { IngestProgress } from './types.js'

// Test actions owned by `ops` whose producers never touch the database.
const gates = new Map<string, { p: Promise<void>; open: () => void }>()
const started = new Set<string>()
const gate = (name: string) => {
  let open!: () => void
  const p = new Promise<void>((r) => { open = r })
  gates.set(name, { p, open })
}
const TEST_ACTIONS: Record<string, () => AsyncGenerator<IngestProgress>> = {
  async *'rl-two'() {
    started.add('rl-two')
    yield { channel: 'rl', phase: 'fetch', message: 'one' }
    yield { channel: 'rl', phase: 'fetch', message: 'two' }
    await gates.get('rl-two')!.p
    throw new Error('secret failure detail')
  },
  async *'rl-block'() {
    await gates.get('rl-block')!.p
    yield { channel: 'rl', phase: 'done', message: 'unblocked' }
  },
  async *'rl-probe'() {
    started.add('rl-probe')
    yield { channel: 'rl', phase: 'done', message: 'ran' }
  },
}
vi.mock('./registry.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./registry.js')>()
  return {
    ...orig,
    actionOwner: (id: string) => (id in TEST_ACTIONS ? 'ops' : orig.actionOwner(id)),
    resolveRunner: (id: string, opts?: Parameters<typeof orig.resolveRunner>[1]) => (id in TEST_ACTIONS ? TEST_ACTIONS[id]! : orig.resolveRunner(id, opts)),
  }
})
// A hook run before an agent's access is looked up: lands a commit between rows and lookup.
let beforeAgentLookup: (() => Promise<void>) | null = null
vi.mock('../auth/covers.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../auth/covers.js')>()
  return {
    ...orig,
    agentAccessAt: async (id: string, generation: number) => {
      const hook = beforeAgentLookup
      beforeAgentLookup = null
      if (hook) await hook()
      return orig.agentAccessAt(id, generation)
    },
  }
})
const { startDetachedRun, executeRecorded, activeRuns } = await import('./run.js')
const { canFollowRun, insertRun, insertSkippedRun, readRun, readRuns } = await import('./runs.js')
const { drain } = await import('./types.js')

/** Another process's policy commit: the statements, then a revision bump, never published here. */
const outside = async (sql: string, params: unknown[] = []): Promise<number> => {
  const { host, port, database } = executor().target
  return withClient({ socket: host, port }, 'box_policy', database, async (c) => {
    await c.query('begin')
    await lockPolicy(c)
    await c.query(sql, params)
    const revision = await bumpRevisionInTransaction(c)
    await c.query('commit')
    return revision
  })
}
const setRole = (id: string, role: string) => outside(`update core.users set role = $1 where id = $2`, [role, id])
/** A request frame filled now for `id`, as a transport fills it. */
const frameOf = async (id: string): Promise<ContextFrame> => {
  const principal = (await resolvePrincipalById(id)) as Principal
  const access = await accessOf(principal)
  const frame = freshRequestFrame()
  runInFrame(frame, () => fillRequest({ principal, access }))
  return frame
}
const inFrame = <T>(frame: ContextFrame, fn: () => Promise<T>) => runInFrame(frame, fn)
const until = async (ok: () => boolean | Promise<boolean>, ms = 10_000) => {
  const end = Date.now() + ms
  while (!(await ok())) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)) }
}
const runRow = async (id: string) => (await withRead<{ status: string; error: string | null; acts_as: string | null }>(
  `select status, error, acts_as from core.automation_runs where id = $1`, [id], { reach: 'core' }))[0]

beforeAll(async () => {
  await upsertRole({ id: 'rl-ops', label: 'Ops', default: 'none', areas: { ops: 'write' } })
  await upsertRole({ id: 'rl-none', label: 'None', default: 'none', areas: {} })
  await upsertRole({ id: 'rl-crm', label: 'Crm', default: 'none', areas: { automation: 'read', crm: 'read' } })
  await upsertRole({ id: 'rl-sup', label: 'Support', default: 'none', areas: { automation: 'read', support: 'read' } })
  await upsertRole({ id: 'rl-all', label: 'All read', default: 'read', areas: {} })
  for (const [id, role] of [['rl-sub', 'rl-ops'], ['rl-queued', 'rl-ops'], ['rl-reader', 'rl-crm'], ['rl-agent', 'rl-sup'], ['rl-wide', 'rl-all'], ['rl-ghostbot', 'rl-none']] as const) {
    await upsertUser({ id, first_name: id, role })
  }
})

describe('a detached run\'s tail', () => {
  it('authorizes each delivery, also of buffered lines, against the committed policy', async () => {
    gate('rl-two')
    const frame = await frameOf('rl-sub')
    const run = inFrame(frame, async () => startDetachedRun('rl-two', { trigger: 'manual', triggeredBy: 'rl-sub' }))
    const { runId, tail } = await run
    const stream = inFrame(frame, async () => tail())
    const it1 = await stream
    expect((await inFrame(frame, () => it1.next())).value).toMatchObject({ message: 'one' })
    // 'two' is buffered; the producer now waits without touching the database.
    await until(async () => (await runRow(runId))?.status === 'running')
    await setRole('rl-sub', 'rl-none')
    await expect(inFrame(frame, () => it1.next())).rejects.toBeInstanceOf(AreaAccessError)
    gates.get('rl-two')!.open()
    // The run itself goes on and settles (bookkeeping is the funnel's, not the caller's).
    await until(async () => (await runRow(runId))?.status === 'error')
  })

  it('withholds the final error from a subscriber who lost the run', async () => {
    await outside(`update core.users set role = 'rl-ops' where id = 'rl-sub'`)
    gate('rl-two')
    const frame = await frameOf('rl-sub')
    const { runId, tail } = await inFrame(frame, async () => startDetachedRun('rl-two', { trigger: 'manual', triggeredBy: 'rl-sub' }))
    gates.get('rl-two')!.open()
    await until(async () => (await runRow(runId))?.status === 'error')
    const stream = await inFrame(frame, async () => tail())
    expect((await inFrame(frame, () => stream.next())).value).toMatchObject({ message: 'one' })
    expect((await inFrame(frame, () => stream.next())).value).toMatchObject({ message: 'two' })
    await setRole('rl-sub', 'rl-none')
    const last = inFrame(frame, () => stream.next())
    await expect(last).rejects.toBeInstanceOf(AreaAccessError)
    await expect(last).rejects.not.toThrow(/secret/)
  })
})

describe('a request run', () => {
  it('is admitted again after its queue wait and settles as refused, never starting', async () => {
    started.delete('rl-probe')
    gate('rl-block')
    const blocker = startDetachedRun('rl-block', { trigger: 'manual' })
    const frame = await frameOf('rl-queued')
    const { runId } = await inFrame(frame, async () => startDetachedRun('rl-probe', { trigger: 'manual', triggeredBy: 'rl-queued' }))
    await until(() => activeRuns().some((r) => r.runId === runId))
    await until(async () => (await runRow(runId))?.status === 'queued')
    await setRole('rl-queued', 'rl-none')
    gates.get('rl-block')!.open()
    await until(async () => (await runRow(runId))?.status === 'error')
    expect((await runRow(runId))?.error).toMatch(/no write access to ops/)
    expect(started.has('rl-probe')).toBe(false)
    await until(async () => (await runRow(blocker.runId))?.status === 'success')
  })

  it('called directly (a backup handler) needs write on the action\'s area before any row', async () => {
    const frame = await frameOf('rl-ghostbot')
    await expect(inFrame(frame, () => drain(executeRecorded('rl-probe', { trigger: 'manual', runId: 'rl-direct' })))).rejects.toBeInstanceOf(AreaAccessError)
    expect(await runRow('rl-direct')).toBeUndefined()
  })
})

describe('agent run coverage', () => {
  beforeAll(async () => {
    await insertRun({ id: 'rl-agent-run', action_id: 'agent', trigger: 'manual', triggered_by: null, acts_as: 'rl-agent' })
    await insertRun({ id: 'rl-ghost-run', action_id: 'agent', trigger: 'manual', triggered_by: null, acts_as: 'rl-ghostbot' })
  })

  it('judges reader and agent at one generation across an atomic swap', async () => {
    // Generation N: the reader holds crm, the agent needs support (deny).
    const frame = await frameOf('rl-reader')
    expect(await inFrame(frame, () => readRun('rl-agent-run'))).toBeNull()
    // Generation N+1, one commit elsewhere: the reader holds support, the agent needs crm (deny).
    // The reader's frame is still at N; mixing it with the agent at N+1 would read crm/crm.
    await outside(`update core.users set role = case id when 'rl-reader' then 'rl-sup' when 'rl-agent' then 'rl-crm' end where id in ('rl-reader', 'rl-agent')`)
    expect(await inFrame(frame, () => readRun('rl-agent-run'))).toBeNull()
    expect((await inFrame(frame, () => readRuns(500))).map((r) => r.id)).not.toContain('rl-agent-run')
    // And the commit landing between the rows and the agent's lookup (reader read at N).
    await outside(`update core.users set role = case id when 'rl-reader' then 'rl-crm' when 'rl-agent' then 'rl-sup' end where id in ('rl-reader', 'rl-agent')`)
    const atN = await frameOf('rl-reader')
    beforeAgentLookup = async () => {
      await outside(`update core.users set role = case id when 'rl-reader' then 'rl-sup' when 'rl-agent' then 'rl-crm' end where id in ('rl-reader', 'rl-agent')`)
    }
    expect(await inFrame(atN, () => readRun('rl-agent-run'))).toBeNull()
    expect(beforeAgentLookup).toBeNull()
    // A reader who covers the agent at the generation both are read at still sees the run.
    await outside(`update core.users set role = 'rl-sup' where id = 'rl-agent'`)
    expect((await inFrame(await frameOf('rl-reader'), () => readRun('rl-agent-run')))?.id).toBe('rl-agent-run')
  })

  it('binds the agent\'s identity to the revision its row was read at', async () => {
    // A commit landing after the identity read's admission probe and before its row is read:
    // the row shows the swapped role while this process still publishes N.
    const swap = `update core.users set role = case id when 'rl-reader' then 'rl-sup' when 'rl-agent' then 'rl-crm' end where id in ('rl-reader', 'rl-agent')`
    const back = `update core.users set role = case id when 'rl-reader' then 'rl-crm' when 'rl-agent' then 'rl-sup' end where id in ('rl-reader', 'rl-agent')`
    const inWindow = (sql: string) => {
      beforeAgentLookup = async () => {
        setAfterAdmissionForTests(async () => {
          setAfterAdmissionForTests(null)
          await outside(sql)
        })
      }
    }
    await outside(back)
    inWindow(swap)
    expect(await inFrame(await frameOf('rl-reader'), () => readRun('rl-agent-run'))).toBeNull()
    await outside(back)
    inWindow(swap)
    expect((await inFrame(await frameOf('rl-reader'), () => readRuns(500))).map((r) => r.id)).not.toContain('rl-agent-run')
    await outside(back)
    inWindow(swap)
    expect(await inFrame(await frameOf('rl-reader'), () => canFollowRun('rl-agent-run'))).toBe(false)
    setAfterAdmissionForTests(null)
  })

  it('fails closed on an agent role the generation does not define', async () => {
    await outside(`update core.users set role = 'rl-undefined' where id = 'rl-ghostbot'`)
    const frame = await frameOf('rl-wide')
    expect(await inFrame(frame, () => readRun('rl-ghost-run'))).toBeNull()
    await outside(`update core.users set role = 'rl-none' where id = 'rl-ghostbot'`)
    expect((await inFrame(frame, () => readRun('rl-ghost-run')))?.id).toBe('rl-ghost-run')
  })
})

describe('an agent trigger\'s skip row', () => {
  it('keeps the principal it would have acted as', async () => {
    await insertSkippedRun({ trigger: 'time', triggerId: 'rl-trigger', actionId: 'agent', actsAs: 'rl-agent' }, 'skipped - busy')
    const rows = await withRead<{ acts_as: string | null }>(`select acts_as from core.automation_runs where trigger_id = 'rl-trigger'`, [], { reach: 'core' })
    expect(rows.map((r) => r.acts_as)).toEqual(['rl-agent'])
  })
})
