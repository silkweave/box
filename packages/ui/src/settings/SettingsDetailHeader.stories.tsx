import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Plug, RefreshCw, Copy, Trash2 } from 'lucide-react'
import { Avatar } from '../components/Avatar.tsx'
import { Badge } from '../components/Badge.tsx'
import { SAMPLE_USERS } from '../stories/fixtures.ts'
import { SettingsDetailHeader } from './SettingsDetailHeader.tsx'
import { SettingsPage } from './SettingsPage.tsx'
import { SettingsFact, SettingsFacts } from './SettingsFacts.tsx'
import { SettingsGroup } from './SettingsGroup.tsx'
import { SettingsTabs } from './SettingsTabs.tsx'
import { SettingsNotice, SettingsReadOnly } from './states.tsx'
import { PaneFrame, SERVER } from './storyFrame.tsx'

const meta = {
  title: 'Settings/SettingsDetailHeader',
  component: SettingsDetailHeader,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsDetailHeader>

export default meta
type Story = StoryObj

const tile = <span className='flex size-12 items-center justify-center rounded-lg bg-accent-tint text-accent'><Plug className='size-5' /></span>
const actions = [
  { label: 'Check now', icon: <RefreshCw />, onSelect: () => undefined },
  { label: 'Copy id', icon: <Copy />, onSelect: () => undefined },
  { label: 'Delete server', icon: <Trash2 />, danger: true, onSelect: () => undefined },
]

const ada = SAMPLE_USERS[0]!

/** A server: icon tile, name, status badge, meta line and the "..." menu. */
export const Default: Story = {
  render: () => (
    <PaneFrame title='MCP servers' className='h-auto'>
      <>
        <SettingsDetailHeader title={SERVER.name} media={tile} badges={<Badge variant='success'>Connected</Badge>} meta={<><span>{SERVER.url}</span><span>Connected by {SERVER.connectedBy} 2d ago</span></>} actions={actions} />
      </>
    </PaneFrame>
  ),
}

/** Variants: a person with an avatar, a thing with no media, a header with a warning line. */
export const Variants: Story = {
  render: () => (
    <PaneFrame title='Variants' className='h-auto'>
      <>
        <SettingsDetailHeader title='Ada Lovelace' media={<Avatar user={ada} size='lg' />} badges={<Badge variant='accent'>Admin</Badge>} meta='ada@example.com' />
        <SettingsDetailHeader title='Sales pod' badges={<Badge>4 members</Badge>} meta='Posts on LinkedIn and X' />
        <SettingsDetailHeader title={SERVER.name} media={tile} badges={<Badge variant='warning'>Needs sign-in</Badge>} meta={SERVER.url}>
          <span className='text-warning'>The key expired on 2026-11-12. Sign in again to keep the tools.</span>
        </SettingsDetailHeader>
      </>
    </PaneFrame>
  ),
}

/** States: a long name truncates; in the member view the menu keeps only `reader` items. */
export const States: Story = {
  render: () => (
    <PaneFrame title='States' className='h-auto'>
      <>
        <SettingsDetailHeader title='A server with a remarkably long name that does not fit on one line at all' media={tile} badges={<Badge variant='success'>Connected</Badge>} meta={SERVER.url} actions={actions} />
        <SettingsReadOnly active note='Only administrators can change servers.'>
          <SettingsDetailHeader title={SERVER.name} media={tile} meta={SERVER.url} actions={actions} />
        </SettingsReadOnly>
      </>
    </PaneFrame>
  ),
}

function ServerPage() {
  const [tab, setTab] = useState<'tools' | 'details'>('details')
  return (
    <SettingsPage title={SERVER.name} info='A server the Box reaches on your behalf.' onClose={() => undefined}>
      <SettingsDetailHeader title={SERVER.name} media={tile} badges={<Badge variant='success'>Connected</Badge>} meta={SERVER.url} actions={actions.filter((a) => !a.danger)} />
      <SettingsNotice title='Read only key'>This key can read, not change. Stripe refuses writes.</SettingsNotice>
      <SettingsTabs label='Server sections' value={tab} onChange={setTab} items={[{ value: 'tools', label: 'Tools', badge: <Badge size='sm'>{SERVER.tools}</Badge> }, { value: 'details', label: 'Details' }]}>
        <SettingsGroup title='Connection'>
          <SettingsFacts>
            <SettingsFact label='Address' mono copy={SERVER.url}>{SERVER.url}</SettingsFact>
            <SettingsFact label='Id' mono copy={SERVER.id}>{SERVER.id}</SettingsFact>
          </SettingsFacts>
        </SettingsGroup>
      </SettingsTabs>
    </SettingsPage>
  )
}

/** InContext: first on a detail page, then a notice, then the detail tabs. */
export const InContext: Story = { render: () => <PaneFrame title='MCP servers'><ServerPage /></PaneFrame> }
