import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { useState } from 'react'
import { TabNav } from './TabNav.tsx'

const meta = {
  title: 'Base/TabNav',
  decorators: [withStage],
  component: TabNav,
} satisfies Meta<typeof TabNav<string>>

export default meta
type Story = StoryObj<typeof meta>

const ITEMS = [
  { value: 'triggers', label: 'Triggers' },
  { value: 'runs', label: 'Runs' },
  { value: 'actions', label: 'Actions' },
]

function Controlled() {
  const [value, setValue] = useState('runs')
  return <TabNav label='Sections' value={value} items={ITEMS} onChange={setValue} />
}

export const Default: Story = {
  args: { label: 'Sections', value: 'runs', items: ITEMS, onChange: () => undefined },
  render: () => <Controlled />,
}
