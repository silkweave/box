// Archetype: OVERVIEW (docs/DESIGN.md 2.2 and 2.3). Use it for the state of an integration: health,
// facts and a few lists. Notices first (at most one warning), then `SettingsFacts`, then lists under
// `section` grids. Operational acts (Reconnect, Send test) sit in the `aside` of the group
// they act on, never in the title bar.
// Copy this file's structure: the pieces are direct children of the section (the pane is the canvas); facts that can be
// copied use `copy`; a missing value is a muted "Not set".

import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Send } from 'lucide-react'
import { Badge } from '../../components/Badge.tsx'
import { Button } from '../../components/Button.tsx'
import { DataGrid } from '../../list/DataGrid.tsx'
import {
  SettingsError,
  SettingsFact,
  SettingsFacts,
  SettingsGroup,
  SettingsIntro,
  SettingsLoading,
  SettingsNotice,
  SettingsReadOnly,
} from '../../settings/index.ts'
import { PaneFrame, later } from '../../settings/storyFrame.tsx'

type State = 'ready' | 'loading' | 'error' | 'empty'
type Args = { member: boolean; state: State }

const meta: Meta<Args> = {
  title: 'Patterns/Settings overview',
  parameters: { layout: 'fullscreen' },
  args: { member: false, state: 'ready' },
  argTypes: {
    member: { control: 'boolean', description: 'The member view: same page, Send test disabled.' },
    state: { control: 'inline-radio', options: ['ready', 'loading', 'error', 'empty'] },
  },
}
export default meta

const DELIVERIES = [
  { id: 'd1', to: 'ada@example.com', subject: 'Your invoice', at: '2026-11-17 09:12', ok: true },
  { id: 'd2', to: 'alan@example.com', subject: 'Welcome to the box', at: '2026-11-17 08:40', ok: true },
  { id: 'd3', to: 'grace@example.org', subject: 'Reset your sign-in', at: '2026-11-16 18:03', ok: false },
]
const MAILBOXES = [
  { id: 'm1', address: 'support@example.com', role: 'Support' },
  { id: 'm2', address: 'sales@example.com', role: 'Sales' },
]

function Mail({ member, state }: Args) {
  const [test, setTest] = useState<'idle' | 'sending' | 'sent'>('idle')
  const sendTest = async () => {
    setTest('sending')
    await later(800)
    setTest('sent')
  }
  return (
    <>
      <SettingsIntro info='Mail goes out through your own provider. The box keeps no copy of the message bodies.'>The state of outgoing and incoming mail.</SettingsIntro>
      {state === 'loading' && <SettingsLoading label='Loading mail status' />}
      {state === 'error' && <SettingsError error={new Error('The server did not answer.')} onRetry={() => undefined} />}
      {(state === 'ready' || state === 'empty') && (
        <>
          <SettingsNotice tone='warning' title='One delivery failed yesterday'>
            Check the address for grace@example.org, then send a test.
          </SettingsNotice>
          <SettingsReadOnly active={member} note='Only administrators can send test mail.'>
            <SettingsGroup
              title='Connection'
              aside={
                <>
                  {test === 'sent' && <span role='status' className='text-body-sm text-success'>Test sent</span>}
                  <Button variant='outline' size='sm' disabled={test === 'sending'} onClick={() => void sendTest()}>
                    <Send /> {test === 'sending' ? 'Sending…' : 'Send test'}
                  </Button>
                </>
              }>
              <SettingsFacts columns={2}>
                <SettingsFact label='Provider'>Postmark <Badge variant='success'>Connected</Badge></SettingsFact>
                <SettingsFact label='Sending domain'>example.com</SettingsFact>
                <SettingsFact label='Inbound address' mono copy='inbound@mail.example.com' span='full'>inbound@mail.example.com</SettingsFact>
                <SettingsFact label='Reply-to'><span className='text-muted-foreground'>Not set</span></SettingsFact>
              </SettingsFacts>
            </SettingsGroup>
            <DataGrid<(typeof MAILBOXES)[number]>
              variant='section'
              title='Mailboxes'
              rows={MAILBOXES}
              getId={(m) => m.id}
              bar={{ noun: 'mailboxes' }}
              searchText={(m) => m.address}
              name={{ label: 'Address', render: (m) => <span className='truncate font-medium text-text'>{m.address}</span> }}
              columns={[{ key: 'role', label: 'Role', width: 96, render: (m) => <Badge>{m.role}</Badge> }]}
            />
            <DataGrid<(typeof DELIVERIES)[number]>
              variant='section'
              title='Recent deliveries'
              rows={state === 'empty' ? [] : DELIVERIES}
              getId={(d) => d.id}
              empty='Nothing sent yet. Send a test to see the first delivery.'
              bar={{ noun: 'deliveries' }}
              searchText={(d) => `${d.subject} ${d.to}`}
              name={{
                label: 'Message',
                render: (d) => (
                  <div className='min-w-0'>
                    <p className='truncate font-medium text-text'>{d.subject}</p>
                    <p className='truncate text-label text-muted-foreground'>{d.to}</p>
                  </div>
                ),
              }}
              columns={[
                { key: 'at', label: 'Sent', width: 144, priority: 2, render: (d) => <span className='text-body-sm text-muted-foreground'>{d.at}</span> },
                { key: 'result', label: 'Result', width: 88, render: (d) => <Badge variant={d.ok ? 'success' : 'danger'}>{d.ok ? 'Delivered' : 'Failed'}</Badge> },
              ]}
            />
          </SettingsReadOnly>
        </>
      )}
    </>
  )
}

/** The state of an integration: a notice, facts with a copy value, lists, Send test in the group. */
export const Overview: StoryObj<Args> = {
  render: (args) => (
    <PaneFrame title='Mail'>
      <Mail key={args.state} {...args} />
    </PaneFrame>
  ),
}
