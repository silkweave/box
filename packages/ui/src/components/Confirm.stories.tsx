import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { useState } from 'react'
import { Button } from './Button.tsx'
import { ConfirmHost, confirm } from './Confirm.tsx'

const meta = {
  title: 'Base/Confirm',
  decorators: [withStage],
  component: ConfirmHost,
} satisfies Meta<typeof ConfirmHost>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A promise-based replacement for window.confirm: `await confirm({...})` from anywhere, no hook
 * threading. One <ConfirmHost/> renders them all; the preview mounts it, so a story just calls it.
 * Requests queue, so overlapping confirms resolve one at a time.
 */
export const Default: Story = {
  render: () => {
    const [answer, setAnswer] = useState<string>('-')
    return (
      <div className='flex items-center gap-3'>
        <Button
          variant='destructive'
          onClick={async () => {
            const ok = await confirm({
              title: 'Delete this rule?',
              message: 'The alert stops firing immediately. This cannot be undone.',
              confirmLabel: 'Delete',
              danger: true,
            })
            setAnswer(ok ? 'confirmed' : 'cancelled')
          }}>
          Delete rule
        </Button>
        <span className='text-body-sm text-muted-foreground'>last answer: {answer}</span>
      </div>
    )
  },
}

/** A bare string is the shorthand for `{ message }`, with the default title. */
export const Shorthand: Story = {
  render: () => (
    <Button variant='outline' onClick={() => void confirm('Discard the draft?')}>
      Discard
    </Button>
  ),
}
