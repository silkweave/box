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
  render: () => (
    <div className='flex items-center gap-3'>
      <Avatar user={SAMPLE_USERS[0]!} size='xs' />
      <Avatar user={SAMPLE_USERS[0]!} size='sm' />
      <Avatar user={SAMPLE_USERS[0]!} size='nav' />
      <Avatar user={SAMPLE_USERS[0]!} size='md' />
      <Avatar user={SAMPLE_USERS[0]!} size='lg' />
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

/** `label`: a letter tile for a service, server or channel. A rounded square, so it never reads as a person. */
export const Letter: Story = {
  args: { label: 'Linear' },
  render: () => (
    <div className='flex items-center gap-3'>
      <Avatar label='Linear' size='sm' />
      <Avatar label='Stripe' size='md' />
      <Avatar label='tracker' size='lg' />
    </div>
  ),
}
