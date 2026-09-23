import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Sidebar, SidebarRail } from './Sidebar.tsx'
import { SAMPLE_GROUP_NAV, SAMPLE_NAV_ITEMS } from '../stories/fixtures.ts'

const meta = {
  title: 'Layout/Sidebar',
  component: Sidebar,
} satisfies Meta<typeof Sidebar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    ...SAMPLE_GROUP_NAV,
    onSelectGroup: () => {},
    items: SAMPLE_NAV_ITEMS,
    activeId: 'overview',
    onSelect: () => {},
  },
  render: (args) => {
    const [activeId, setActiveId] = useState(args.activeId)
    const [activeGroup, setActiveGroup] = useState(args.activeGroup)
    return (
      <div className='flex h-[36rem] bg-sidebar'>
        <Sidebar
          {...args}
          activeGroup={activeGroup}
          onSelectGroup={setActiveGroup}
          activeId={activeId}
          onSelect={setActiveId}
        />
      </div>
    )
  },
}

/** Section headings draw whenever the value CHANGES down the list, so a section's items must be contiguous. */
export const WithoutSections: Story = {
  args: {
    ...SAMPLE_GROUP_NAV,
    onSelectGroup: () => {},
    items: SAMPLE_NAV_ITEMS.map((item) => ({ ...item, section: undefined })),
    activeId: 'overview',
    onSelect: () => {},
  },
  render: (args) => (
    <div className='flex h-[36rem] bg-sidebar'>
      <Sidebar {...args} />
    </div>
  ),
}

/** Collapsed: an icon-only rail of the groups, with no sub-nav at all. */
export const Rail: Story = {
  args: {
    ...SAMPLE_GROUP_NAV,
    onSelectGroup: () => {},
    items: SAMPLE_NAV_ITEMS,
    activeId: 'overview',
    onSelect: () => {},
  },
  render: (args) => (
    <div className='flex h-[36rem] bg-sidebar'>
      <SidebarRail {...args} onExpand={() => {}} />
    </div>
  ),
}

/** Top-level headings are supplied by the app, independently of sub-nav sections. */
export const GroupHeadings: Story = {
  ...Default,
  args: {
    ...Default.args,
    groups: SAMPLE_GROUP_NAV.groups.map((group, index) => ({
      ...group,
      section: index < 2 ? 'Marketing' : 'Workspace',
    })),
  },
}
