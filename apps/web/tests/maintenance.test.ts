import { describe, expect, test } from 'bun:test'
import { maintenanceBlocks } from '../src/lib/useMaintenance.ts'

describe('maintenanceBlocks', () => {
  test('nobody is blocked while maintenance is off', () => {
    expect(maintenanceBlocks(false, false, null, false)).toBe(false)
    expect(maintenanceBlocks(false, true, 'member', false)).toBe(false)
  })
  test('admins pass unless locked out', () => {
    expect(maintenanceBlocks(true, false, 'admin', false)).toBe(false)
    expect(maintenanceBlocks(true, true, 'admin', false)).toBe(true)
  })
  test('members are blocked', () => {
    expect(maintenanceBlocks(true, false, 'member', false)).toBe(true)
  })
  test('signed out: only a tab opened on /login keeps the sign-in form, and not when admins are locked out', () => {
    expect(maintenanceBlocks(true, false, null, false)).toBe(true)
    expect(maintenanceBlocks(true, false, null, true)).toBe(false)
    expect(maintenanceBlocks(true, true, null, true)).toBe(true)
  })
})
