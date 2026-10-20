import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { parseMaintenanceArgs, parseWhen } from '../maintenance.ts'

const now = new Date('2026-10-20T09:00:00')

describe('box maintenance', () => {
  test('reads an estimate as a duration, a clock time or an ISO time', () => {
    assert.equal(parseWhen('20m', now), new Date('2026-10-20T09:20:00').toISOString())
    assert.equal(parseWhen('1h30m', now), new Date('2026-10-20T10:30:00').toISOString())
    assert.equal(parseWhen('14:30', now), new Date('2026-10-20T14:30:00').toISOString())
    assert.equal(parseWhen('08:00', now), new Date('2026-10-21T08:00:00').toISOString())
    assert.equal(parseWhen('2026-10-20T03:00:00Z', now), '2026-10-20T03:00:00.000Z')
    assert.equal(parseWhen('none', now), null)
    assert.throws(() => parseWhen('soon', now))
  })

  test('turns a command line into one change', () => {
    assert.deepEqual(parseMaintenanceArgs([], now), { action: 'show', patch: {}, json: false })
    assert.deepEqual(parseMaintenanceArgs(['on', '--lock-admins', '--status', 'Upgrading', '--eta', '15m', '--task', 'A', '--task', 'B'], now).patch, {
      enabled: true, lockAdmins: true, status: 'Upgrading', eta: new Date('2026-10-20T09:15:00').toISOString(), tasks: [{ label: 'A' }, { label: 'B' }],
    })
    assert.deepEqual(parseMaintenanceArgs(['task', 'done', '2', '--eta', '5m'], now).patch, { task: { op: 'done', ref: '2' }, eta: new Date('2026-10-20T09:05:00').toISOString() })
    assert.deepEqual(parseMaintenanceArgs(['task', 'add', 'Publish'], now).patch, { task: { op: 'add', label: 'Publish' } })
    assert.deepEqual(parseMaintenanceArgs(['note', 'Halfway'], now).patch, { status: 'Halfway' })
    assert.deepEqual(parseMaintenanceArgs(['lock-admins'], now).patch, { lockAdmins: true })
    assert.deepEqual(parseMaintenanceArgs(['off', '--json'], now), { action: 'change', patch: { enabled: false }, json: true })
  })

  test('refuses what it cannot read', () => {
    assert.throws(() => parseMaintenanceArgs(['task', 'finish', '1'], now))
    assert.throws(() => parseMaintenanceArgs(['note', '--task', 'A', 'x'], now))
    assert.throws(() => parseMaintenanceArgs(['tasks', '--lock-admins', 'A'], now))
    assert.throws(() => parseMaintenanceArgs(['on', '--wat'], now))
  })
})
