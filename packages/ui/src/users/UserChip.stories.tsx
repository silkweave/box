import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { UserChip } from './UserChip.tsx'

const meta = {
  title: 'Users/UserChip',
  decorators: [withStage],
  component: UserChip,
} satisfies Meta<typeof UserChip>

export default meta
type Story = StoryObj<typeof meta>

/** An id resolved through the directory. The app decides the id means "owner" - the chip does not. */
export const Default: Story = { args: { userId: 'ada' } }

export const WithName: Story = { args: { userId: 'grace', showName: true } }

/** Null or unknown id renders NOTHING - not a placeholder, not a dash. */
export const Unknown: Story = { args: { userId: 'nobody' } }

/** The same chip serving four different app roles, which is the argument for the name. */
export const RolesAreTheAppsBusiness: Story = {
  args: { userId: 'ada' },
  render: () => (
    <dl className='flex flex-col gap-2 text-body-sm'>
      {[
        ['Owner', 'ada'],
        ['Assignee', 'grace'],
        ['Triggered by', 'linus'],
        ['Created by', 'ada'],
      ].map(([role, id]) => (
        <div key={role} className='flex items-center gap-3'>
          <dt className='w-28 text-muted-foreground'>{role}</dt>
          <dd>
            <UserChip userId={id} showName />
          </dd>
        </div>
      ))}
    </dl>
  ),
}
