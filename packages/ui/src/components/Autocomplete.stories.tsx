import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { withStage } from '../stories/Stage.tsx'
import { Autocomplete } from './Autocomplete.tsx'

const meta = {
  title: 'Base/Autocomplete',
  decorators: [withStage],
  component: Autocomplete,
} satisfies Meta<typeof Autocomplete>

export default meta
type Story = StoryObj<typeof meta>

const KINDS = [
  { value: 'content.published', hint: '12 in 30 days' },
  { value: 'goal.met', hint: '3 in 30 days' },
  { value: 'signal.threshold', hint: '41 in 30 days' },
]

function Demo() {
  const [value, setValue] = useState('')
  return (
    <div className='max-w-sm'>
      <Autocomplete aria-label='Event kind' mono value={value} onValueChange={setValue} suggestions={KINDS} placeholder='content.published' />
    </div>
  )
}

export const Default: Story = {
  args: { value: '', onValueChange: () => undefined, suggestions: KINDS },
  render: () => <Demo />,
}
