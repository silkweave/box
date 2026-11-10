// Recipients at one committed generation (BOX-Review R5 finding 3): a commit landing after a read's
// admission probe and before its SELECT shows the new identity while this process still publishes
// the old definitions. The recipient must be judged at the generation its row was read at, never as
// the new identity with the old grants. "Another process" commits through a raw box_policy session
// this process does not hear of.

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { levelOf } from './access.js'
import { upsertRole } from './roles.js'
import { upsertUser } from '../users/state.js'
import { executor, setAfterAdmissionForTests } from '../warehouse/executor.js'
import { withClient } from '../warehouse/pg/boot.js'
import { bumpRevisionInTransaction, lockPolicy } from '../warehouse/pg/policy.js'
import { activeRecipients, recipientById } from './recipients.js'

const outside = async (sql: string): Promise<number> => {
  const { host, port, database } = executor().target
  return withClient({ socket: host, port }, 'box_policy', database, async (c) => {
    await c.query('begin')
    await lockPolicy(c)
    await c.query(sql)
    const revision = await bumpRevisionInTransaction(c)
    await c.query('commit')
    return revision
  })
}
/** Land `sql` as another process's commit right after the next admission probe. */
const inWindow = (sql: string) => {
  setAfterAdmissionForTests(async () => {
    setAfterAdmissionForTests(null)
    await outside(sql)
  })
}
// Moves rc-person onto rc-b and takes chat from rc-b, atomically.
const SWAP = `update core.users set role = 'rc-b' where id = 'rc-person';
  update core.roles set areas = '{"crm":"read"}'::jsonb where id = 'rc-b'`
const BACK = `update core.users set role = 'rc-a' where id = 'rc-person';
  update core.roles set areas = '{"chat":"read","crm":"read"}'::jsonb where id = 'rc-b'`

beforeAll(async () => {
  await upsertRole({ id: 'rc-a', label: 'A', default: 'none', areas: { crm: 'read' } })
  await upsertRole({ id: 'rc-b', label: 'B', default: 'none', areas: { chat: 'read', crm: 'read' } })
  await upsertUser({ id: 'rc-person', first_name: 'Rc', role: 'rc-a' })
})
afterEach(() => setAfterAdmissionForTests(null))

describe('recipients', () => {
  it('a single recipient is never the new identity with the old grants', async () => {
    await outside(BACK)
    expect(levelOf((await recipientById('rc-person'))!.access!, 'chat')).toBe('none')
    inWindow(SWAP)
    const r = (await recipientById('rc-person'))!
    expect(r.principal.role).toBe('rc-b')
    // Judged at the swap's generation: rc-b without chat. (Old grants for rc-b would read chat.)
    expect(levelOf(r.access!, 'chat')).toBe('none')
    expect(r.revision).toBe(r.access!.revision)
  })

  it('a reader set is judged at the generation it was read at', async () => {
    await outside(BACK)
    inWindow(SWAP)
    const all = await activeRecipients()
    const person = all.find((r) => r.principal.id === 'rc-person')!
    expect(person.principal.role).toBe('rc-b')
    expect(levelOf(person.access!, 'chat')).toBe('none')
    expect(new Set(all.map((r) => r.revision)).size).toBe(1)
  })

  it('fails closed on a role the generation does not define, and resolves nobody for an unknown id', async () => {
    await outside(`update core.users set role = 'rc-undefined' where id = 'rc-person'`)
    expect((await recipientById('rc-person'))?.access).toBeNull()
    expect(await recipientById('rc-nobody')).toBeNull()
    await outside(BACK)
  })
})
