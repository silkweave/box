import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { useState } from 'react'
import { DateRangeInput, type DateRange } from './DateRangeInput.tsx'

const meta = {
  title: 'Base/DateRangeInput',
  decorators: [withStage],
  component: DateRangeInput,
} satisfies Meta<typeof DateRangeInput>

export default meta
type Story = StoryObj<typeof meta>

/** The whole range commits at once: a half-made range (a start with no end yet) never reaches the
 *  caller, so nothing downstream ever sees a window nobody chose. */
export const Default: Story = {
  args: { value: { start: '2026-09-01', end: '2026-09-13' }, ariaLabel: 'Date range', onChange: () => {} },
  render: (args) => {
    const [value, setValue] = useState<DateRange>(args.value)
    return <DateRangeInput {...args} value={value} onChange={setValue} />
  },
}

export const Empty: Story = {
  args: { value: { start: '', end: '' }, ariaLabel: 'Date range', onChange: () => {} },
}
