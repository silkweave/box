import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { useState } from 'react'
import { UserPicker } from './UserPicker.tsx'
import { UsersProvider } from './directory.tsx'

const meta = {
  title: 'Users/UserPicker',
  decorators: [withStage],
  component: UserPicker,
} satisfies Meta<typeof UserPicker>

export default meta
type Story = StoryObj<typeof meta>

/** The directory comes from the `UsersProvider` the preview mounts - the picker takes no `users` prop. */
export const Default: Story = {
  args: { value: 'ada', onChange: () => {} },
  render: (args) => {
    const [value, setValue] = useState<string | null>(args.value)
    return <UserPicker {...args} value={value} onChange={setValue} />
  },
}

export const Unassigned: Story = { args: { value: null, onChange: () => {} } }

/** For a slot the viewer may see but not change (signal ownership is admin-only configuration). */
export const Readonly: Story = { args: { value: 'grace', readOnly: true, onChange: () => {} } }

/** A Box with genuinely no users yet says so. */
export const EmptyDirectory: Story = {
  args: { value: null, onChange: () => {} },
  render: (args) => (
    <UsersProvider users={[]}>
      <UserPicker {...args} />
    </UsersProvider>
  ),
}

/**
 * The directory has not loaded (or there is no provider). Distinct from empty on purpose: the
 * "no users yet" hint must not flash while a fetch is still in flight.
 */
export const NotLoaded: Story = {
  args: { value: 'ada', onChange: () => {} },
  render: (args) => (
    <UsersProvider users={null}>
      <UserPicker {...args} />
    </UsersProvider>
  ),
}
