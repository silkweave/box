import { describe, expect, it } from 'bun:test'
import type { NavGroup } from '@silkweave/box-ui'
import { WORKSPACE_SECTION, type NavEntry, type NavSection } from '../src/feature.ts'
import { sidebarGroups } from '../src/lib/navSections.ts'

const icon = () => null
const REPORTING: NavSection = { id: 'reporting', label: 'Reporting', order: 200 }
const SALES: NavSection = { id: 'sales', label: 'Sales', order: 400 }
const e = (id: string, order: number, section?: NavSection): NavEntry => ({ id, label: id, icon, to: `/${id}`, order, section })
const shape = (groups: NavGroup[]) => groups.map((g) => `${g.section}:${g.id}`)

describe('sidebar sections', () => {
  it('groups entries by declared section, sections by order, entries by nav order', () => {
    const entries = [e('crm', 600, SALES), e('chat', 500, WORKSPACE_SECTION), e('boards', 110, REPORTING), e('home', 0, WORKSPACE_SECTION), e('signals', 100, REPORTING)]
    expect(shape(sidebarGroups(entries))).toEqual(['Workspace:home', 'Workspace:chat', 'Reporting:signals', 'Reporting:boards', 'Sales:crm'])
  })

  it('puts entries without a section last, under Other', () => {
    const groups = sidebarGroups([e('loose', 1), e('home', 0, WORKSPACE_SECTION)])
    expect(shape(groups)).toEqual(['Workspace:home', 'Other:loose'])
    expect(groups[0]?.href).toBe('/home')
  })

  it('takes a section label and order from its first entry in nav order, whatever the registration order', () => {
    const late = { id: 'reporting', label: 'Numbers', order: 50 }
    const a = [e('signals', 100, REPORTING), e('extra', 900, late), e('home', 0, WORKSPACE_SECTION)]
    const b = [e('extra', 900, late), e('home', 0, WORKSPACE_SECTION), e('signals', 100, REPORTING)]
    expect(shape(sidebarGroups(a))).toEqual(['Workspace:home', 'Reporting:signals', 'Reporting:extra'])
    expect(shape(sidebarGroups(b))).toEqual(shape(sidebarGroups(a)))
  })

  it('breaks section and entry order ties on id', () => {
    const one = { id: 'b', label: 'B', order: 10 }
    const two = { id: 'a', label: 'A', order: 10 }
    expect(shape(sidebarGroups([e('y', 5, one), e('x', 5, one), e('z', 1, two)]))).toEqual(['A:z', 'B:x', 'B:y'])
  })

  it('shows no heading for a section without entries', () => {
    expect(sidebarGroups([])).toEqual([])
  })
})
