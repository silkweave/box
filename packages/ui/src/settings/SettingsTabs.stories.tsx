import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Mail, MessageCircle, Phone } from 'lucide-react'
import { Badge } from '../components/Badge.tsx'
import { Field, FieldGrid } from '../components/Field.tsx'
import { Input } from '../components/Input.tsx'
import { SettingsTabs } from './SettingsTabs.tsx'
import { SettingsGroup } from './SettingsGroup.tsx'
import { DataGrid } from '../list/DataGrid.tsx'
import { SettingsEmpty, SettingsReadOnly } from './states.tsx'
import { PaneFrame } from './storyFrame.tsx'

const meta = {
  title: 'Settings/SettingsTabs',
  component: SettingsTabs,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsTabs<string>>

export default meta
type Story = StoryObj

const RUNS = ['Nightly digest', 'Weekly report', 'Stars sync']

function Automation({ member = false }: { member?: boolean }) {
  const [tab, setTab] = useState<'triggers' | 'runs' | 'settings'>('runs')
  return (
    <SettingsTabs label='Automation sections' value={tab} onChange={setTab} items={[{ value: 'triggers', label: 'Triggers' }, { value: 'runs', label: 'Runs' }, { value: 'settings', label: 'Settings' }]}>
      {tab === 'runs' && (
        <DataGrid<string>
          variant='section'
          title='Runs'
          rows={RUNS}
          getId={(r) => r}
          bar={{ noun: 'runs' }}
          searchText={(r) => r}
          name={{ label: 'Run', render: (r) => <span className='truncate text-text'>{r}</span> }}
          columns={[{ key: 'at', label: 'When', width: 96, render: () => <span className='text-label text-muted-foreground'>5m ago</span> }]}
        />
      )}
      {tab === 'triggers' && <SettingsEmpty>No triggers yet. Add the first with New trigger.</SettingsEmpty>}
      {tab === 'settings' && (
        <SettingsReadOnly active={member} note='Only administrators can change this.'>
          <SettingsGroup title='Schedule'>
            <FieldGrid columns={2}>
              <Field label='Time zone'><Input defaultValue='Europe/Vienna' /></Field>
              <Field label='Quiet hours' hint='No runs start in this window.'><Input defaultValue='22:00-06:00' /></Field>
            </FieldGrid>
          </SettingsGroup>
          <SettingsGroup title='Retention'>
            <FieldGrid columns={3}><Field label='Keep runs for'><Input defaultValue='30 days' /></Field></FieldGrid>
          </SettingsGroup>
        </SettingsReadOnly>
      )}
    </SettingsTabs>
  )
}

/** Section tabs directly under the title bar; the panel's first list drops its top rule. */
export const Default: Story = { render: () => <PaneFrame title='Automation'><Automation /></PaneFrame> }

/** Items with icons and badges. */
export const IconsAndBadges: Story = {
  render: function Render() {
    const [tab, setTab] = useState('email')
    return (
      <PaneFrame title='Channels'>
        <>
          <SettingsTabs label='Channels' value={tab} onChange={setTab} items={[
            { value: 'email', label: 'Email', icon: <Mail /> },
            { value: 'sms', label: 'SMS', icon: <MessageCircle />, badge: <Badge size='sm' variant='warning'>Setup</Badge> },
            { value: 'phone', label: 'Phone', icon: <Phone /> },
          ]}>
            <SettingsEmpty>Pick a channel to see its settings.</SettingsEmpty>
          </SettingsTabs>
        </>
      </PaneFrame>
    )
  },
}

/** States: the member view inside a panel (the tabs stay usable). Open the Settings tab. */
export const States: Story = { render: () => <PaneFrame title='Automation'><><Automation member /></></PaneFrame> }

/** InContext: on the bare pane of a section that has not moved to the canvas yet; the tabs bring their own layout. */
export const InContext: Story = { render: () => <PaneFrame title='Automation'><Automation /></PaneFrame> }
