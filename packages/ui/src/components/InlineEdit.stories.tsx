import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { useState } from 'react'
import { InlineEdit } from './InlineEdit.tsx'

const meta = {
  title: 'Base/InlineEdit',
  decorators: [withStage],
  component: InlineEdit,
} satisfies Meta<typeof InlineEdit>

export default meta
type Story = StoryObj<typeof meta>

/** Enter or blur commits; Escape restores the original and never fires `onCommit`. */
export const Default: Story = {
  args: { defaultValue: 'Ship the UI package', onCommit: () => {}, 'aria-label': 'Title' },
  render: (args) => {
    const [value, setValue] = useState(String(args.defaultValue))
    return (
      <div className='flex items-center gap-3'>
        <InlineEdit {...args} key={value} defaultValue={value} onCommit={setValue} />
        <span className='text-body-sm text-muted-foreground'>committed: {value}</span>
      </div>
    )
  },
}

export const Multiline: Story = {
  args: {
    defaultValue: 'A longer note that wants more than one line to say what it means.',
    multiline: true,
    rows: 3,
    onCommit: () => {},
    'aria-label': 'Note',
  },
}

export const Number: Story = {
  args: { defaultValue: 8, type: 'number', min: 0, max: 100, onCommit: () => {}, 'aria-label': 'Points' },
}

export const Placeholder: Story = {
  args: { defaultValue: '', placeholder: 'Untitled', onCommit: () => {}, 'aria-label': 'Title' },
}
