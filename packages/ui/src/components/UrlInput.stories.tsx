import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { withStage } from '../stories/Stage.tsx'
import { UrlInput } from './UrlInput.tsx'

const meta = {
  title: 'Base/UrlInput',
  decorators: [withStage],
  component: UrlInput,
} satisfies Meta<typeof UrlInput>

export default meta
type Story = StoryObj<typeof meta>

function Controlled({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial)
  return (
    <div className='max-w-md'>
      <UrlInput value={value} onChange={setValue} placeholder='optional' />
      <p className='mt-2 px-2 text-label text-muted-foreground'>value: {value || '(empty)'}</p>
    </div>
  )
}

/** Controlled. The field rests transparent and only draws a border once you are in it. */
export const Default: Story = {
  args: { value: 'silkweave.dev/box', onChange: () => {} },
  render: () => <Controlled initial='silkweave.dev/box' />,
}

/** Empty: the addon is still there, and does nothing rather than opening `https://`. */
export const Empty: Story = {
  args: { value: '', onChange: () => {}, placeholder: 'optional' },
  render: () => <Controlled initial='' />,
}

/**
 * Uncontrolled - `defaultValue` plus `onCommit` on blur, for a field inside a form that saves when
 * you leave it. The addon reads the live input either way.
 */
export const Uncontrolled: Story = {
  args: { defaultValue: 'https://example.com/spec', onCommit: () => {} },
  render: (args) => (
    <div className='max-w-md'>
      <UrlInput {...args} />
    </div>
  ),
}
