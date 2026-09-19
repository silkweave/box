import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { useState } from 'react'
import { SegmentedControl } from './SegmentedControl.tsx'

const meta = {
  title: 'Base/SegmentedControl',
  decorators: [withStage],
  component: SegmentedControl,
} satisfies Meta<typeof SegmentedControl<string>>

export default meta
type Story = StoryObj<typeof meta>

const GROUPINGS = [
  { value: 'channel', label: 'Channel' },
  { value: 'owner', label: 'Owner' },
  { value: 'status', label: 'Status' },
  { value: 'none', label: 'None' },
]

const RANGES = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: 'all', label: 'All' },
]

function Controlled({ options, initial, label }: { options: typeof GROUPINGS; initial: string; label?: string }) {
  const [value, setValue] = useState(initial)
  return <SegmentedControl value={value} options={options} onChange={setValue} label={label} />
}

/** Bare: no label, just the choice. */
export const Default: Story = {
  args: { value: 'channel', options: GROUPINGS, onChange: () => {} },
  render: () => <Controlled options={GROUPINGS} initial='channel' />,
}

/** With a label. The caller supplies the word - the control never composes it. */
export const Labelled: Story = {
  args: { value: 'channel', options: GROUPINGS, onChange: () => {}, label: 'Group by' },
  render: () => <Controlled options={GROUPINGS} initial='channel' label='Group by' />,
}

/**
 * The same widget as a range selector, which is the whole argument for the rename: nothing about it
 * knew what "group by" meant.
 */
export const AsRangeSelector: Story = {
  args: { value: '30d', options: RANGES, onChange: () => {} },
  render: () => <Controlled options={RANGES} initial='30d' />,
}

/** Two options is the floor - below that, use a toggle. */
export const TwoOptions: Story = {
  args: { value: 'list', options: [], onChange: () => {} },
  render: () => (
    <Controlled
      options={[
        { value: 'list', label: 'List' },
        { value: 'board', label: 'Board' },
      ]}
      initial='list'
      label='Layout'
    />
  ),
}
