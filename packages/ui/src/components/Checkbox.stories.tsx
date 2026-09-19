import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { useState } from 'react'
import { Checkbox } from './Checkbox.tsx'

const meta = {
  title: 'Base/Checkbox',
  decorators: [withStage],
  component: Checkbox,
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => {
    const [on, setOn] = useState(true)
    return (
      <label className='inline-flex items-center gap-2 text-body-sm text-text'>
        <Checkbox checked={on} onChange={(e) => setOn(e.currentTarget.checked)} />
        Only my items
      </label>
    )
  },
}

export const States: Story = {
  render: () => (
    <div className='flex items-center gap-4 text-body-sm text-text'>
      <label className='inline-flex items-center gap-2'><Checkbox checked={false} readOnly /> off</label>
      <label className='inline-flex items-center gap-2'><Checkbox checked readOnly /> on</label>
      <label className='inline-flex items-center gap-2 opacity-60'><Checkbox checked readOnly disabled /> disabled</label>
    </div>
  ),
}
