import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { useState } from 'react'
import { Filter } from 'lucide-react'
import { AccountMenu, MenuIcon, MenuRow, MenuSwitch } from './AccountMenu.tsx'

const meta = {
  title: 'Users/AccountMenu',
  decorators: [withStage],
  component: AccountMenu,
} satisfies Meta<typeof AccountMenu>

export default meta
type Story = StoryObj<typeof meta>

const BASE = { onSignOut: () => {}, onPickUser: () => {} }

/** Signed in: the active user is LOCKED to the principal, so there is no picker - only Sign out. */
export const SignedIn: Story = {
  args: { ...BASE, principal: { id: 'ada', display: 'Ada Lovelace' }, activeUserId: 'ada' },
}

/** No auth: the menu is a picker for who is operating the Box. */
export const Picker: Story = {
  args: { ...BASE, principal: null, activeUserId: 'grace' },
  render: (args) => {
    const [activeUserId, setActiveUserId] = useState<string | null>(args.activeUserId)
    return <AccountMenu {...args} activeUserId={activeUserId} onPickUser={setActiveUserId} />
  },
}

/**
 * The `extra` slot, built from the exported `MenuRow` / `MenuIcon` / `MenuSwitch` so it matches the
 * rows above it.
 *
 * This story is the argument for the slot: "Only my items" used to be `filterMine` /
 * `onFilterMine` props on this component - one app's FEATURE welded into the shell's account menu.
 * The shape is general; what a Box hangs under the separator is not.
 */
export const WithExtraRows: Story = {
  args: { ...BASE, principal: null, activeUserId: 'grace' },
  render: (args) => {
    const [activeUserId, setActiveUserId] = useState<string | null>(args.activeUserId)
    const [mine, setMine] = useState(false)
    return (
      <AccountMenu
        {...args}
        activeUserId={activeUserId}
        onPickUser={setActiveUserId}
        extra={
          <MenuRow onClick={() => setMine((v) => !v)}>
            <MenuIcon>
              <Filter className='size-4' />
            </MenuIcon>
            <span className='flex-1'>Only my items</span>
            <MenuSwitch on={mine && !!activeUserId} />
          </MenuRow>
        }
      />
    )
  },
}

/** An empty directory: the hint is a prop, because the library does not know where users come from. */
export const EmptyDirectory: Story = {
  args: {
    ...BASE,
    principal: null,
    activeUserId: null,
    emptyHint: 'No users yet. Add one in Settings → Users.',
  },
}
