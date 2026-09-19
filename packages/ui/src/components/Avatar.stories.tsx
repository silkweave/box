import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { Avatar } from './Avatar.tsx'
import { SAMPLE_USERS } from '../stories/fixtures.ts'

const meta = {
  title: 'Users/Avatar',
  decorators: [withStage],
  component: Avatar,
} satisfies Meta<typeof Avatar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { user: SAMPLE_USERS[2]! } }

/** No image: a deterministic initials chip, tinted by a stable hash of the id. */
export const Initials: Story = { args: { user: SAMPLE_USERS[0]! } }

export const Sizes: Story = {
  args: { user: SAMPLE_USERS[0]! },
  render: (args) => (
    <div className='flex items-center gap-3'>
      <Avatar {...args} size='xs' />
      <Avatar {...args} size='sm' />
      <Avatar {...args} size='nav' />
      <Avatar {...args} size='md' />
      <Avatar {...args} size='lg' />
    </div>
  ),
}

/** The tint is a hash of the id, so a person keeps the same one everywhere in the app. */
export const Everyone: Story = {
  args: { user: SAMPLE_USERS[0]! },
  render: () => (
    <div className='flex items-center gap-3'>
      {SAMPLE_USERS.map((u) => (
        <Avatar key={u.id} user={u} size='md' />
      ))}
    </div>
  ),
}
