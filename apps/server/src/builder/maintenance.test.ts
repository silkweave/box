import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyMaintenancePatch, MaintenanceError, maintenancePath, maintenanceReturnPath, publicNotice, readMaintenance, writeMaintenance } from './maintenance.js'
import { maintenancePage } from './maintenance-page.js'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const instance = () => { const dir = mkdtempSync(join(tmpdir(), 'box-maintenance-')); dirs.push(dir); return dir }
const at = new Date('2026-10-20T01:00:00Z')
const off = () => readMaintenance(instance(), at)

const failsWith = (fn: () => unknown, status: number) => {
  try { fn() } catch (error) { expect(error).toBeInstanceOf(MaintenanceError); expect((error as MaintenanceError).statusCode).toBe(status); return }
  throw new Error('expected a MaintenanceError')
}

describe('maintenance state', () => {
  it('starts off without a file and round-trips through it', () => {
    const dir = instance()
    expect(readMaintenance(dir, at)).toMatchObject({ enabled: false, lockAdmins: false, tasks: [], eta: null })
    const on = writeMaintenance(dir, applyMaintenancePatch(readMaintenance(dir, at), { enabled: true, status: ' Upgrading ', eta: '2026-10-20T01:15:00Z', tasks: [{ label: 'Back up' }, { label: 'Deploy' }], by: 'BOX-Lead' }, at))
    expect(readMaintenance(dir)).toEqual(on)
    expect(on).toMatchObject({ enabled: true, status: 'Upgrading', startedAt: at.toISOString(), eta: '2026-10-20T01:15:00.000Z', updatedBy: 'BOX-Lead' })
    expect(on.tasks.map(task => [task.label, task.state])).toEqual([['Back up', 'pending'], ['Deploy', 'pending']])
  })

  it('ticks tasks by number or id and revises the estimate in the same change', () => {
    let state = applyMaintenancePatch(off(), { enabled: true, tasks: [{ label: 'A' }, { label: 'B' }] }, at)
    state = applyMaintenancePatch(state, { task: { op: 'done', ref: '1' }, eta: '2026-10-20T01:10:00Z' }, at)
    state = applyMaintenancePatch(state, { task: { op: 'start', ref: state.tasks[1]!.id } }, at)
    expect(state.tasks.map(task => task.state)).toEqual(['done', 'active'])
    expect(state.eta).toBe('2026-10-20T01:10:00.000Z')
    state = applyMaintenancePatch(state, { task: { op: 'add', label: 'C' } }, at)
    state = applyMaintenancePatch(state, { task: { op: 'skip', ref: '3' } }, at)
    state = applyMaintenancePatch(state, { task: { op: 'remove', ref: '1' } }, at)
    expect(state.tasks.map(task => [task.label, task.state])).toEqual([['B', 'active'], ['C', 'skipped']])
    failsWith(() => applyMaintenancePatch(state, { task: { op: 'done', ref: '9' } }, at), 404)
  })

  it('clears the notice when switched off and refuses notice edits while off', () => {
    const on = applyMaintenancePatch(off(), { enabled: true, lockAdmins: true, status: 'x', tasks: [{ label: 'A' }] }, at)
    const cleared = applyMaintenancePatch(on, { enabled: false }, at)
    expect(cleared).toMatchObject({ enabled: false, lockAdmins: false, status: '', tasks: [], eta: null, startedAt: null })
    failsWith(() => applyMaintenancePatch(cleared, { status: 'late note' }, at), 409)
  })

  it('validates input', () => {
    failsWith(() => applyMaintenancePatch(off(), { enabled: true, eta: 'soon' }, at), 400)
    failsWith(() => applyMaintenancePatch(off(), { enabled: true, status: 'x'.repeat(1001) }, at), 400)
    failsWith(() => applyMaintenancePatch(off(), { enabled: true, tasks: [{ label: 'A', state: 'finished' }] }, at), 400)
    failsWith(() => applyMaintenancePatch(off(), { enabled: 'yes' }, at), 400)
  })

  it('lets only the host lock admins out, and freezes Builder while they are', () => {
    const on = applyMaintenancePatch(off(), { enabled: true }, at, 'builder')
    failsWith(() => applyMaintenancePatch(on, { lockAdmins: true }, at, 'builder'), 403)
    const locked = applyMaintenancePatch(on, { lockAdmins: true }, at, 'host')
    expect(locked.lockAdmins).toBe(true)
    failsWith(() => applyMaintenancePatch(locked, { enabled: false }, at, 'builder'), 423)
    failsWith(() => applyMaintenancePatch(locked, { task: { op: 'add', label: 'A' } }, at, 'builder'), 423)
    expect(applyMaintenancePatch(locked, { lockAdmins: false }, at, 'host').lockAdmins).toBe(false)
  })

  it('rejects a damaged file instead of guessing', () => {
    const dir = instance()
    mkdirSync(join(dir, 'builder'), { recursive: true })
    writeFileSync(maintenancePath(dir), JSON.stringify({ version: 1, enabled: true }))
    failsWith(() => readMaintenance(dir), 503)
  })

  it('publishes only the notice: no author, nothing while off', () => {
    const on = applyMaintenancePatch(off(), { enabled: true, status: 'Upgrading', by: 'BOX-Lead' }, at)
    expect(publicNotice(on)).not.toHaveProperty('updatedBy')
    expect(publicNotice(applyMaintenancePatch(on, { enabled: false }, at))).toBeNull()
  })
})

describe('maintenance page', () => {
  const brand = { name: 'Team Box', logoUrl: '/brand-logo.svg', themeColor: '#7b7ef5' }

  it('embeds the notice as data the script renders as text, never as markup', () => {
    const notice = publicNotice(applyMaintenancePatch(off(), { enabled: true, status: '</script><img src=x onerror=alert(1)>', tasks: [{ label: '<b>A</b>' }] }, at))
    const html = maintenancePage(brand, notice)
    expect(html).not.toContain('</script><img')
    expect(html).toContain('\\u003c/script>')
    expect(html).toContain('textContent')
    expect(html).toContain('src="/builder-assets/brand-logo.svg"')
    expect(html).toContain('<title>Team Box: maintenance</title>')
  })

  it('takes the logo from the current Builder snapshot when its version is known', () => {
    const version = '07955069-14b1-48fa-bd55-f6617df53947'
    expect(maintenancePage(brand, null, version)).toContain(`src="/builder-assets/${version}/brand-logo.svg"`)
  })

  it('has a restarting variant and refuses a non-colour accent', () => {
    const html = maintenancePage({ ...brand, themeColor: 'red;}body{display:none' }, null)
    expect(html).toContain('<title>Team Box: restarting</title>')
    expect(html).toContain('--accent:#7b7ef5')
  })
})

describe('maintenanceReturnPath', () => {
  it('returns to a same-origin path only', () => {
    expect(maintenanceReturnPath('/support?preset=Open#x')).toBe('/support?preset=Open#x')
    expect(maintenanceReturnPath(null)).toBe('/')
    expect(maintenanceReturnPath('https://evil.example/')).toBe('/')
    expect(maintenanceReturnPath('//evil.example/')).toBe('/')
    expect(maintenanceReturnPath('/\\evil.example/')).toBe('/')
    expect(maintenanceReturnPath('/api/box-status/page?return=/')).toBe('/')
    expect(maintenanceReturnPath('/a\nb')).toBe('/')
  })
})
