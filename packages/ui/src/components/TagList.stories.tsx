import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { withStage } from '../stories/Stage.tsx'
import { TagList, type TagItem } from './TagList.tsx'

const meta = {
  title: 'Base/TagList',
  decorators: [withStage],
  component: TagList,
} satisfies Meta<typeof TagList>

export default meta
type Story = StoryObj

const START: TagItem[] = [
  { value: '*@example.com', fixed: 'box.json', title: 'From box.json' },
  { value: 'ops@partner.io', title: 'Added by toby 2d ago' },
  { value: 'billing@vendor.com', title: 'Added by mayumi 5h ago' },
]

function Live() {
  const [items, setItems] = useState(START)
  return <TagList label='Trusted senders' items={items} onRemove={(v) => setItems((xs) => xs.filter((x) => x.value !== v))} empty='None' />
}

/** Removable tags beside a fixed one from configuration. */
export const Default: Story = { render: () => <Live /> }

/** States: empty, and read-only (no `onRemove`). */
export const States: Story = {
  render: () => (
    <div className='flex flex-col gap-4'>
      <TagList items={[]} empty='None yet' />
      <TagList label='Allowed recipients' items={START.slice(1)} />
    </div>
  ),
}
