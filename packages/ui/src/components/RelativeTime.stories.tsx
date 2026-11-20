import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { RelativeTime } from './RelativeTime.tsx'

const NOW = Date.parse('2026-11-17T12:00:00Z')
const at = (ms: number) => new Date(NOW + ms).toISOString()

const meta = {
  title: 'Base/RelativeTime',
  decorators: [withStage],
  component: RelativeTime,
  args: { now: NOW },
} satisfies Meta<typeof RelativeTime>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { value: at(-5 * 60_000) },
}

const CASES = [
  ['Just now', at(-10_000)],
  ['Minutes ago', at(-12 * 60_000)],
  ['Hours ago', at(-3 * 3_600_000)],
  ['Days ago', at(-4 * 86_400_000)],
  ['In the future', at(2 * 3_600_000)],
  ['Server format', '2026-11-17 09:30:00'],
  ['Never', null],
] as const

/** Hover a time for its full local date and time. */
export const Range: Story = {
  args: { value: null },
  render: (args) => (
    <dl className='grid grid-cols-[10rem_auto] gap-x-4 gap-y-2 text-body-sm'>
      {CASES.map(([label, value]) => (
        <div key={label} className='contents'>
          <dt className='text-muted-foreground'>{label}</dt>
          <dd className='text-text'>
            <RelativeTime value={value} now={args.now} />
          </dd>
        </div>
      ))}
    </dl>
  ),
}
