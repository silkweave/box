import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { SaveStatus, type SaveStatusValue } from './SaveStatus.tsx'

const meta = {
  title: 'Base/SaveStatus',
  decorators: [withStage],
  component: SaveStatus,
  args: { status: 'saved', compact: false },
  argTypes: { status: { control: 'inline-radio', options: ['idle', 'loading', 'dirty', 'saving', 'saved', 'error'] } },
} satisfies Meta<typeof SaveStatus>

export default meta
type Story = StoryObj<typeof meta>

/** Where an autosaving document stands, in its editor's toolbar or the top bar. `idle` draws nothing. */
export const Default: Story = {}

const ALL: SaveStatusValue[] = ['loading', 'dirty', 'saving', 'saved', 'error']

/** Every state, full and `compact` (icon only; the label stays for screen readers and as the tooltip). */
export const States: Story = {
  render: () => (
    <div className='grid w-fit grid-cols-2 gap-x-8 gap-y-2'>
      {ALL.map((s) => [<SaveStatus key={s} status={s} />, <SaveStatus key={`${s}-c`} status={s} compact />])}
    </div>
  ),
}
