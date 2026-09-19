import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './Select.tsx'

const meta = {
  title: 'Base/Select',
  decorators: [withStage],
  component: SelectTrigger,
} satisfies Meta<typeof SelectTrigger>

export default meta
type Story = StoryObj<typeof meta>

const CHANNELS = ['github', 'npm', 'reddit', 'linkedin', 'x']

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState<string | null>('github')
    return (
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger className='w-48'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CHANNELS.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  },
}
