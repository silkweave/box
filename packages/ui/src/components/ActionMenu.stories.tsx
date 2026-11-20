import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Archive, Check, Copy, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { withStage } from '../stories/Stage.tsx'
import { SAMPLE_USERS } from '../stories/fixtures.ts'
import { Avatar } from './Avatar.tsx'
import { Badge } from './Badge.tsx'
import { ActionMenu, type ActionMenuItem } from './ActionMenu.tsx'
import { DataGrid } from '../list/DataGrid.tsx'

const meta = {
  title: 'Base/ActionMenu',
  decorators: [withStage],
  component: ActionMenu,
} satisfies Meta<typeof ActionMenu>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const PLAIN: ActionMenuItem[] = [
  { label: 'Edit', icon: <Pencil />, onSelect: noop },
  { label: 'Check now', icon: <RefreshCw />, onSelect: noop },
  { label: 'Copy id', icon: <Copy />, onSelect: noop },
]

/** A record's secondary acts. Open it with a click or Enter; arrows move, Escape closes. */
export const Default: Story = { args: { items: PLAIN } }

/**
 * Danger items sort last, below a separator, whatever order they are passed in. In Settings a row's
 * menu may repeat Delete; the detail page's own Delete stays in the footer.
 */
export const WithDanger: Story = {
  args: {
    items: [
      { label: 'Delete server', icon: <Trash2 />, onSelect: noop, danger: true },
      ...PLAIN,
      { label: 'Archive', icon: <Archive />, onSelect: noop },
    ],
  },
}

/** A disabled item stays in place, so the menu keeps its shape; say why elsewhere (a hint, a title). */
export const DisabledItem: Story = {
  args: {
    items: [
      { label: 'Edit', icon: <Pencil />, onSelect: noop },
      { label: 'Check now', icon: <RefreshCw />, onSelect: noop, disabled: true },
      { label: 'Delete role', icon: <Trash2 />, onSelect: noop, danger: true, disabled: true },
    ],
  },
}

function CopyTick() {
  const [copied, setCopied] = useState(false)
  return (
    <ActionMenu
      label='Server actions'
      triggerIcon={copied ? <Check className='text-success' /> : undefined}
      items={[
        {
          label: 'Copy id',
          icon: <Copy />,
          onSelect: () => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          },
        },
        ...PLAIN.slice(0, 2),
      ]}
    />
  )
}

/** `triggerIcon` replaces the ellipsis for a moment: a tick after the copy item ran. */
export const TriggerIcon: Story = { args: { items: PLAIN }, render: () => <CopyTick /> }

const ROWS = SAMPLE_USERS.slice(0, 3).map((u, i) => ({ user: u, role: i === 0 ? 'Admin' : 'Member' }))

function RowList() {
  const [opened, setOpened] = useState<string | null>(null)
  return (
    <div className='max-w-2xl'>
      <DataGrid<(typeof ROWS)[number]>
        variant='section'
        rows={ROWS}
        getId={(r) => r.user.id}
        bar={{ noun: 'users' }}
        totals={false}
        rowLabel={(r) => r.user.nickname}
        onOpen={(r) => setOpened(r.user.nickname)}
        name={{
          label: 'Name',
          render: ({ user }) => (
            <span className='flex min-w-0 items-center gap-2'>
              <Avatar user={user} size='md' />
              <span className='truncate font-medium text-text'>{user.first_name} {user.last_name}</span>
            </span>
          ),
        }}
        columns={[{ key: 'role', label: 'Role', width: 96, render: ({ role }) => <Badge variant={role === 'Admin' ? 'accent' : 'neutral'}>{role}</Badge> }]}
        rowActions={({ user }) => (
          <ActionMenu
            size='sm'
            label={`Actions for ${user.nickname}`}
            items={[
              { label: 'Copy sign-in link', icon: <Copy />, onSelect: noop },
              { label: 'Delete user', icon: <Trash2 />, onSelect: noop, danger: true },
            ]}
          />
        )}
      />
      <p className='mt-3 text-label text-muted-foreground'>{opened ? `Opened ${opened}.` : 'Click a row to open it; the menu does not.'}</p>
    </div>
  )
}

/**
 * The row-sized trigger (`size='sm'`) as the one trailing control of a list row whose whole
 * surface opens the item. Trailing content is at most one status and this menu.
 */
export const InRow: Story = { args: { items: PLAIN }, render: () => <RowList /> }
