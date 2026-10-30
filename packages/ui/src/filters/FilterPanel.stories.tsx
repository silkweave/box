import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { FilterPanel } from './FilterPanel.tsx'
import { FIELDS, STORY_TODAY } from './fixtures.ts'
import type { Filters } from './types.ts'

const meta = {
  title: 'Filters/FilterPanel',
  component: FilterPanel,
} satisfies Meta<typeof FilterPanel>

export default meta
type Story = StoryObj<typeof meta>

function Frame({ start = {}, pins = true }: { start?: Filters; pins?: boolean }) {
  const [value, setValue] = useState<Filters>(start)
  const [pinned, setPinned] = useState<string[]>(['owner', 'due'])
  return (
    <div className='flex flex-col gap-3'>
      <div className='w-[30rem] max-w-full rounded-md bg-popover ring-1 ring-foreground/10'>
        <FilterPanel
          fields={FIELDS}
          value={value}
          onChange={setValue}
          pinned={pins ? pinned : undefined}
          onPinnedChange={pins ? setPinned : undefined}
          today={STORY_TODAY}
        />
      </div>
      {/* What the panel writes, so a story shows each editor's stored value. */}
      <pre className='overflow-x-auto font-mono text-label text-muted-foreground'>{JSON.stringify({ filters: value, pinned }, null, 2)}</pre>
    </div>
  )
}

/**
 * What the board bar's funnel opens: the fields down the left, the selected field's editor on the
 * right, the editor being whatever the field's TYPE calls for. A dot marks a field that is
 * narrowing; the star pins a field to the bar (offered only when the host passes `onPinnedChange`).
 * It opens on the first active field, else the first. Every editor commits as you go.
 */
export const Default: Story = {
  args: { fields: FIELDS, value: {}, onChange: () => {} },
  render: () => <Frame />,
}

/** Opens on the first field that is narrowing - here Due, set to a window. */
export const WithActiveFilters: Story = {
  args: { fields: FIELDS, value: {}, onChange: () => {} },
  render: () => <Frame start={{ due: { window: 'next_7' }, estimate: { op: 'gt', value: 4 } }} />,
}

/** A board without presets has nowhere to keep a pin, so the host leaves `onPinnedChange` out and
 *  no star draws. */
export const WithoutPins: Story = {
  args: { fields: FIELDS, value: {}, onChange: () => {} },
  render: () => <Frame pins={false} />,
}
