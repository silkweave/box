import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { Button } from './Button.tsx'
import { notice } from './Confirm.tsx'
import { NotifyHost, notify, notifyError } from './Notify.tsx'

const meta = {
  title: 'Base/Notify',
  decorators: [withStage],
  component: NotifyHost,
} satisfies Meta<typeof NotifyHost>

export default meta
type Story = StoryObj<typeof meta>

/**
 * `notify(...)` from anywhere for a write that has nowhere else to say it failed: a status picked in
 * a row, a crumb renamed, a card dropped. One `<NotifyHost/>` draws them at the bottom of the window
 * (the preview mounts it). Danger notices stay 8 s, neutral 4 s, at most three show.
 */
export const Default: Story = {
  render: () => (
    <div className='flex flex-wrap items-center gap-3'>
      <Button variant='outline' onClick={() => notifyError('Could not save the status', new Error('The ticket was deleted meanwhile.'))}>
        A failed write
      </Button>
      <Button variant='outline' onClick={() => notify('Copied the link to 3 tickets.', { tone: 'neutral' })}>
        A plain fact
      </Button>
    </div>
  ),
}

/** `notice(...)` is for what the person must read before going on: a write that landed with warnings. One OK, no Cancel. */
export const Notice: Story = {
  render: () => (
    <Button
      variant='outline'
      onClick={() =>
        void notice({
          title: 'Imported 41 of 43 accounts',
          message: 'Row 12: no name.\nRow 30: "acme" exists already.',
        })
      }>
      Import with warnings
    </Button>
  ),
}

/** A long report scrolls inside the dialog; the title and OK stay in view, long ids wrap. */
export const LongNotice: Story = {
  render: () => (
    <Button
      variant='outline'
      onClick={() =>
        void notice({
          title: 'Imported 12 of 80 accounts',
          message: Array.from({ length: 68 }, (_, i) => `Row ${i + 2}: "acme-${'x'.repeat(i % 3 === 0 ? 60 : 4)}" exists already.`).join('\n'),
        })
      }>
      Import with 68 warnings
    </Button>
  ),
}
