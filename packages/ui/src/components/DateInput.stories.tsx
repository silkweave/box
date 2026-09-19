import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { useState } from 'react'
import { DateInput } from './DateInput.tsx'

const meta = {
  title: 'Base/DateInput',
  decorators: [withStage],
  component: DateInput,
} satisfies Meta<typeof DateInput>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Typing is buffered: a half-finished date ("2026-08") never reaches `onChange`, only a complete
 * ISO one does. The calendar and the "today" shortcut write directly.
 */
export const Default: Story = {
  args: { value: '2026-09-13', ariaLabel: 'Due date', onChange: () => {} },
  render: (args) => {
    const [value, setValue] = useState(args.value)
    return (
      <div className='flex items-center gap-3'>
        <DateInput {...args} value={value} onChange={setValue} />
        <span className='text-body-sm text-muted-foreground'>{value || 'empty'}</span>
      </div>
    )
  },
}

export const Empty: Story = { args: { value: '', ariaLabel: 'Due date', onChange: () => {} } }

/** Card-scale: no "today" shortcut and no width floor, for a field inside a task card. */
export const Compact: Story = {
  args: { value: '2026-09-13', ariaLabel: 'Due date', compact: true, onChange: () => {} },
}

export const Disabled: Story = {
  args: { value: '2026-09-13', ariaLabel: 'Due date', disabled: true, onChange: () => {} },
}
