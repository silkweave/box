import { describe, expect, it } from 'bun:test'
import type { NavGroup } from '@silkweave/box-ui'
import { arrangeSidebar, layoutOf, orderGroups } from '../../../packages/ui/src/shell/sidebarLayout.ts'

const icon = () => null
const g = (id: string, section: string): NavGroup => ({ id, label: id, icon, section })
const GROUPS = [g('home', 'Workspace'), g('chat', 'Workspace'), g('signals', 'Reporting'), g('reports', 'Reporting'), g('crm', 'Sales')]
const ids = (list: NavGroup[]) => list.map((x) => x.id)

describe('sidebar arrangement', () => {
  it('keeps the default without a layout', () => {
    expect(ids(orderGroups(GROUPS, null))).toEqual(['home', 'chat', 'signals', 'reports', 'crm'])
  })

  it('orders sections, then groups within each section; unnamed ones keep their default place last', () => {
    const layout = { sections: ['Sales', 'Workspace'], groups: ['chat', 'home'], hidden: [] }
    expect(ids(orderGroups(GROUPS, layout))).toEqual(['crm', 'chat', 'home', 'signals', 'reports'])
  })

  it('hides groups, and a section whose groups are all hidden disappears with them', () => {
    const layout = { sections: [], groups: [], hidden: ['signals', 'reports'] }
    const { shown, hidden, revealed } = arrangeSidebar(GROUPS, layout, 'home')
    expect(ids(shown)).toEqual(['home', 'chat', 'crm'])
    expect(ids(hidden)).toEqual(['signals', 'reports'])
    expect(shown.some((x) => x.section === 'Reporting')).toBe(false)
    expect(revealed).toBeNull()
  })

  it('shows a hidden group while it is the active one, at its own place', () => {
    const layout = { sections: [], groups: [], hidden: ['signals', 'reports'] }
    const { shown, revealed } = arrangeSidebar(GROUPS, layout, 'reports')
    expect(ids(shown)).toEqual(['home', 'chat', 'reports', 'crm'])
    expect(revealed).toBe('reports')
  })

  it('records an arrangement and keeps the ids of groups the app no longer has', () => {
    const previous = { sections: ['Gone'], groups: ['gone'], hidden: ['gone'] }
    const layout = layoutOf(orderGroups(GROUPS, null), ['crm'], previous)
    expect(layout.sections).toEqual(['Workspace', 'Reporting', 'Sales', 'Gone'])
    expect(layout.groups).toEqual(['home', 'chat', 'signals', 'reports', 'crm', 'gone'])
    expect(layout.hidden).toEqual(['crm', 'gone'])
  })
})
