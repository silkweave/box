import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { PinnedFilterChip } from './PinnedFilterChip.tsx'
import { DUE_FIELD, ESTIMATE_FIELD, OWNER_FIELD, STORY_TODAY } from './fixtures.ts'
import type { FilterField, FilterValue } from './types.ts'

const meta = {
  title: 'Filters/PinnedFilterChip',
  component: PinnedFilterChip,
} satisfies Meta<typeof PinnedFilterChip>

export default meta
type Story = StoryObj<typeof meta>

function Chip({ field, start = null }: { field: FilterField; start?: FilterValue | null }) {
  const [value, setValue] = useState<FilterValue | null>(start)
  return <PinnedFilterChip field={field} value={value} onChange={setValue} today={STORY_TODAY} />
}

/**
 * A field pinned to the bar: its title and its value in a few words. Unset it reads "Any" and sits
 * quiet; set, it is accent-tinted and grows its own x. Click it for that one field's editor.
 */
export const Default: Story = {
  args: { field: OWNER_FIELD, value: null, onChange: () => {} },
  render: () => (
    <div className='flex flex-wrap items-center gap-1.5'>
      <Chip field={OWNER_FIELD} start={['me', 'ada']} />
      <Chip field={DUE_FIELD} />
      <Chip field={ESTIMATE_FIELD} start={{ op: 'gt', value: 5 }} />
    </div>
  ),
}
