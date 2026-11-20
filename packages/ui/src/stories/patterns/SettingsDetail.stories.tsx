// Archetype: DETAIL (docs/DESIGN.md 2.2 and 2.3). Use it for one thing opened from a list: a routed
// `SettingsPage` with the thing's header, optional tabs, groups of fields, and a footer with Delete
// at the left and Cancel and Save at the right.
// Copy this file's structure: the `route` string ('<id>' or '<id>/<tab>') and `open(path)`, the
// state switch, `SettingsDetailHeader`, `SettingsTabs`, `SettingsReadOnly` inside the panel.
// Title: the page title is the record's name only; the pane already shows the section as the first
// crumb ("Pods > Growth").
// Ownership: the page owns the title bar while it is open (the section's own create buttons hide),
// and within it the open tab: the Members tab renders `SettingsHeaderActions` with Add member (a
// child create; the list is the tab's primary grid, no title), the Details tab renders
// `SettingsSaveBar` with `SettingsDeleteButton` as `start`, the Activity tab is a log with Refresh in
// its bar and no footer. Leaving a dirty Details tab asks first.
// A role-like thing whose name is its whole identity omits `SettingsDetailHeader`: the breadcrumb
// is its title, and the page starts with its groups.

import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Plus, RefreshCw } from 'lucide-react'
import { ActionMenu } from '../../components/ActionMenu.tsx'
import { Avatar } from '../../components/Avatar.tsx'
import { Badge } from '../../components/Badge.tsx'
import { Button } from '../../components/Button.tsx'
import { Field, FieldGrid } from '../../components/Field.tsx'
import { Input } from '../../components/Input.tsx'
import { RelativeTime } from '../../components/RelativeTime.tsx'
import { StatusDot } from '../../components/StatusDot.tsx'
import { Textarea } from '../../components/Textarea.tsx'
import { DataGrid } from '../../list/DataGrid.tsx'
import { NameCell } from '../../list/NameCell.tsx'
import {
  SettingsDeleteButton,
  SettingsDetailHeader,
  SettingsEmpty,
  SettingsError,
  SettingsGroup,
  SettingsHeaderActions,
  SettingsIntro,
  SettingsLoading,
  SettingsPage,
  SettingsReadOnly,
  SettingsSaveBar,
  SettingsTabs,
  useSettingsForm,
  useSettingsReadOnly,
} from '../../settings/index.ts'
import { PaneFrame, later } from '../../settings/storyFrame.tsx'

type State = 'ready' | 'loading' | 'error' | 'empty'
type Args = { member: boolean; state: State }

const meta: Meta<Args> = {
  title: 'Patterns/Settings detail',
  parameters: { layout: 'fullscreen' },
  args: { member: false, state: 'ready' },
  argTypes: {
    member: { control: 'boolean', description: 'The member view: same page, search and rows live, no Add, Save or Delete.' },
    state: { control: 'inline-radio', options: ['ready', 'loading', 'error', 'empty'] },
  },
}
export default meta

type Tab = 'members' | 'details' | 'activity'
const NOW = Date.parse('2026-11-17T12:00:00Z')
const POD = { id: 'growth', name: 'Growth', description: 'Engages with every launch post within the hour.' }
const person = (id: string, first_name: string, last_name: string) => ({ id, first_name, last_name, nickname: first_name.toLowerCase(), image: null })
const MEMBERS = [
  { id: 'toby', user: person('toby', 'Toby', 'Strebitzer'), email: 'toby@example.com', role: 'admin' as const },
  { id: 'mira', user: person('mira', 'Mira', 'Okafor'), email: 'mira@example.com', role: 'member' as const },
  { id: 'dan', user: person('dan', 'Dan', 'Ruli'), email: 'dan@example.com', role: 'member' as const },
]
const EVENTS = [
  { id: 'e1', what: 'Mira commented on "Box 1.0 is out"', at: '2026-11-17T10:12:00Z', ok: true },
  { id: 'e2', what: 'Dan missed "Pricing update"', at: '2026-11-16T15:40:00Z', ok: false },
  { id: 'e3', what: 'Toby added Dan', at: '2026-11-15T09:03:00Z', ok: true },
]

// A child list: the tab's primary grid; its create (Add member) is the tab's title bar action.
function MembersTab({ state }: { state: State }) {
  const readOnly = useSettingsReadOnly()
  return (
    <>
      <SettingsHeaderActions>
        <Button size='sm'><Plus /> Add member</Button>
      </SettingsHeaderActions>
      <DataGrid<(typeof MEMBERS)[number]>
        rows={state === 'empty' ? [] : MEMBERS}
        getId={(m) => m.id}
        empty='No members yet. Add the first with Add member.'
        bar={{ noun: 'members' }}
        searchText={(m) => `${m.user.first_name} ${m.user.last_name} ${m.email}`}
        rowLabel={(m) => `${m.user.first_name} ${m.user.last_name}`}
        name={{
          label: 'Member',
          render: (m) => (
            <NameCell
              primary={`${m.user.first_name} ${m.user.last_name}`}
              secondary={m.email}
              mark={<Avatar user={m.user} size='sm' />}
              badge={m.id === 'toby' ? { label: 'You', variant: 'accent' } : null}
            />
          ),
        }}
        columns={[{ key: 'role', label: 'Role', width: 96, render: (m) => <span className='text-body-sm text-muted-foreground'>{m.role === 'admin' ? 'Admin' : 'Member'}</span> }]}
        rowActions={readOnly ? undefined : (m) => <ActionMenu size='sm' label={`Actions for ${m.user.first_name}`} items={[{ label: 'Remove from pod', danger: true, onSelect: () => undefined }]} />}
      />
    </>
  )
}

// A form tab: its Save, with Delete at the left, in the footer while it is open.
function DetailsTab({ onDeleted }: { onDeleted: () => void }) {
  const form = useSettingsForm({
    stored: { name: POD.name, description: POD.description },
    onSave: () => later(),
    validate: (v) => (v.name.trim() ? null : 'A pod needs a name.'),
  })
  return (
    <>
      <form {...form.formProps} className='contents'>
        <SettingsGroup title='Pod'>
          <FieldGrid columns={2}>
            <Field label='Name'><Input value={form.values.name} onChange={(e) => form.set('name', e.target.value)} /></Field>
            <Field label='Description' span='full' hint='Shown to members on the pod board.'>
              <Textarea value={form.values.description} onChange={(e) => form.set('description', e.target.value)} />
            </Field>
          </FieldGrid>
        </SettingsGroup>
      </form>
      <SettingsSaveBar
        form={form}
        onCancel={form.reset}
        start={
          <SettingsDeleteButton
            label='Delete pod'
            confirm={{ title: `Delete pod "${POD.name}"?`, message: 'Its members stay; their engagement history goes.' }}
            onDelete={async () => { await later(); onDeleted() }}
          />
        }
      />
    </>
  )
}

// A log tab: things that happened, newest first, Refresh in the bar, no footer.
function ActivityTab({ state }: { state: State }) {
  const [refreshing, setRefreshing] = useState(false)
  return (
    <DataGrid<(typeof EVENTS)[number]>
      rows={state === 'empty' ? [] : EVENTS}
      getId={(e) => e.id}
      empty='Nothing has happened in this pod yet.'
      bar={{ noun: 'events' }}
      searchText={(e) => e.what}
      rowLabel={(e) => e.what}
      icon={(e) => <StatusDot tone={e.ok ? 'success' : 'warning'} label={e.ok ? 'Done' : 'Missed'} />}
      name={{ label: 'Event', render: (e) => <NameCell primary={e.what} /> }}
      columns={[{ key: 'at', label: 'When', width: 96, render: (e) => <RelativeTime value={e.at} now={NOW} className='text-body-sm text-muted-foreground' /> }]}
      actions={
        <Button variant='outline' size='sm' disabled={refreshing} onClick={() => { setRefreshing(true); void later(500).then(() => setRefreshing(false)) }}>
          <RefreshCw /> Refresh
        </Button>
      }
    />
  )
}

function PodPage({ member, state }: Args) {
  // In the app: `params` come from `render(params)`; `open` is `useSettingsDialog().open` and the
  // route is `#settings/pods/<path>`: '' the list, 'growth' this page, 'growth/details' its tab.
  const [route, setRoute] = useState('growth')
  const open = (path = '') => setRoute(path)
  const [id = '', rawTab = 'members'] = route.split('/')
  const tab: Tab = rawTab === 'details' || rawTab === 'activity' ? rawTab : 'members'

  if (!id) {
    return (
      <>
        <SettingsIntro>Pods are small groups that engage with each other's posts.</SettingsIntro>
        {/* The section's own create: hidden while a pod's page is open. */}
        <SettingsHeaderActions>
          <Button size='sm' onClick={() => open('growth')}><Plus /> New pod</Button>
        </SettingsHeaderActions>
        <SettingsEmpty>This story shows the detail page. Use New pod to open it again.</SettingsEmpty>
      </>
    )
  }

  return (
    <SettingsPage title={POD.name} info='A pod is a group of people who engage with each other’s posts.' onClose={() => open()}>
      {state === 'loading' ? (
        <SettingsLoading label='Loading pod' />
      ) : state === 'error' ? (
        <SettingsError error={new Error('The server did not answer.')} onRetry={() => undefined} />
      ) : (
        <>
          <SettingsDetailHeader
            title={POD.name}
            media={<Avatar label={POD.name} size='lg' />}
            badges={<Badge variant='success'>Active</Badge>}
            meta={<span>{MEMBERS.length} members &middot; last activity <RelativeTime value={EVENTS[0]!.at} now={NOW} /></span>}
          />
          <SettingsTabs
            label='Pod sections'
            value={tab}
            onChange={(t) => open(`${id}/${t}`)}
            items={[
              { value: 'members', label: 'Members', badge: <Badge size='sm'>{MEMBERS.length}</Badge> },
              { value: 'details', label: 'Details' },
              { value: 'activity', label: 'Activity' },
            ]}>
            <SettingsReadOnly active={member} note='Only administrators can change pods.'>
              {tab === 'members' && <MembersTab state={state} />}
              {tab === 'details' && <DetailsTab onDeleted={() => open()} />}
              {tab === 'activity' && <ActivityTab state={state} />}
            </SettingsReadOnly>
          </SettingsTabs>
        </>
      )}
    </SettingsPage>
  )
}

/** One thing from a list: header, tabs; a child list with its own create, a form with Delete and
 *  Save, a log with Refresh. Only the open tab's actions and footer show. */
export const Detail: StoryObj<Args> = {
  render: (args) => (
    <PaneFrame title='Pods'>
      <PodPage key={args.state} {...args} />
    </PaneFrame>
  ),
}
