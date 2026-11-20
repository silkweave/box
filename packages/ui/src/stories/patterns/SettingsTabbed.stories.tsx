// Archetype: TABBED SECTION (docs/DESIGN.md 2.2 and 2.3). Use it for a section with several
// distinct tasks for different moments; each tab is one of the other archetypes. Never two levels.
// Copy this file's structure: `SettingsTabs` first on the canvas with the tab as the route
// ('triggers', 'defaults', 'runs'; in the app `#settings/automation/<tab>`), one component per tab,
// and `SettingsReadOnly` inside the panel (never around the tabs).
// Ownership: the open tab owns the title bar and the footer. The list tab renders its own
// `SettingsHeaderActions` (create) and its grid's count goes to the pane footer; the form tab renders
// its own `SettingsSaveBar`; the log tab has Refresh in its grid bar and no footer. A tab's primary
// list is a plain `DataGrid` (no `variant`, no title: the tab already names it). Switching away from
// a dirty form asks first. Members keep search, filters and opening rows; only write pieces go.

import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Plus, RefreshCw } from 'lucide-react'
import { Badge } from '../../components/Badge.tsx'
import { Button } from '../../components/Button.tsx'
import { RelativeTime } from '../../components/RelativeTime.tsx'
import { Field, FieldGrid } from '../../components/Field.tsx'
import { Input } from '../../components/Input.tsx'
import { StatusDot } from '../../components/StatusDot.tsx'
import { DataGrid } from '../../list/DataGrid.tsx'
import { NameCell } from '../../list/NameCell.tsx'
import {
  SettingsError,
  SettingsGroup,
  SettingsHeaderActions,
  SettingsIntro,
  SettingsLoading,
  SettingsReadOnly,
  SettingsSaveBar,
  SettingsTabs,
  useSettingsForm,
} from '../../settings/index.ts'
import { PaneFrame, later } from '../../settings/storyFrame.tsx'

type State = 'ready' | 'loading' | 'error' | 'empty'
type Args = { member: boolean; state: State }

const meta: Meta<Args> = {
  title: 'Patterns/Settings tabbed',
  parameters: { layout: 'fullscreen' },
  args: { member: false, state: 'ready' },
  argTypes: {
    member: { control: 'boolean', description: 'The member view: every tab without its change controls.' },
    state: { control: 'inline-radio', options: ['ready', 'loading', 'error', 'empty'] },
  },
}
export default meta

type Tab = 'triggers' | 'defaults' | 'runs'
const TRIGGERS = [
  { id: 't1', name: 'Morning digest', when: 'Every day at 08:00', active: true },
  { id: 't2', name: 'Stale deals', when: 'When a deal sits 14 days', active: true },
  { id: 't3', name: 'Weekly report', when: 'Every Monday at 09:00', active: false },
]
const NOW = Date.parse('2026-11-17T12:00:00Z')
const RUNS = [
  { id: 'r1', name: 'Morning digest', at: '2026-11-17T08:00:00Z', ok: true },
  { id: 'r2', name: 'Stale deals', at: '2026-11-16T17:42:00Z', ok: false },
  { id: 'r3', name: 'Morning digest', at: '2026-11-16T08:00:00Z', ok: true },
]

// The form tab's state switch; a list tab hands loading, error and empty to its grid.
function Gate({ state, label, children }: { state: State; label: string; children: React.ReactNode }) {
  if (state === 'loading') return <SettingsLoading label={label} />
  if (state === 'error') return <SettingsError error={new Error('The server did not answer.')} onRetry={() => undefined} />
  return <>{children}</>
}

// A list tab: create in the title bar, the tab's records as the primary grid (its count in the
// pane footer). Members search and open rows; New trigger is not offered to them.
function TriggersTab({ state }: { state: State }) {
  return (
    <>
      <SettingsHeaderActions>
        <Button size='sm'><Plus /> New trigger</Button>
      </SettingsHeaderActions>
      <DataGrid<(typeof TRIGGERS)[number]>
        rows={state === 'empty' ? [] : TRIGGERS}
        getId={(t) => t.id}
        loading={state === 'loading'}
        error={state === 'error' ? new Error('The server did not answer.') : undefined}
        onRetry={() => undefined}
        empty='No triggers yet. Add the first with New trigger.'
        bar={{ noun: 'triggers' }}
        searchText={(t) => t.name}
        rowLabel={(t) => t.name}
        onOpen={() => undefined}
        name={{ label: 'Name', render: (t) => <NameCell primary={t.name} secondary={t.when} /> }}
        columns={[{ key: 'active', label: 'State', width: 72, render: (t) => <Badge variant={t.active ? 'success' : 'neutral'}>{t.active ? 'On' : 'Off'}</Badge> }]}
      />
    </>
  )
}

// A form tab: its own Save in the footer while it is open.
function DefaultsTab({ state }: { state: State }) {
  const form = useSettingsForm({ stored: { retries: '3', timeout: '60' }, onSave: () => later() })
  return (
    <Gate state={state} label='Loading defaults'>
      <form {...form.formProps} className='contents'>
        <SettingsGroup title='Runs' description='Applied to every trigger that does not set its own.'>
          <FieldGrid columns={3}>
            <Field label='Retries' hint='Attempts before a run fails.'>
              <Input inputMode='numeric' value={form.values.retries} onChange={(e) => form.set('retries', e.target.value)} />
            </Field>
            <Field label='Timeout in seconds'>
              <Input inputMode='numeric' value={form.values.timeout} onChange={(e) => form.set('timeout', e.target.value)} />
            </Field>
          </FieldGrid>
        </SettingsGroup>
      </form>
      <SettingsSaveBar form={form} />
    </Gate>
  )
}

// A log tab: the LOG archetype (SettingsLog) as the tab's grid: newest first, no sort, a result
// filter, Refresh in the bar, relative time. No title bar action, no footer of its own.
function RunsTab({ state }: { state: State }) {
  const [refreshing, setRefreshing] = useState(false)
  return (
    <DataGrid<(typeof RUNS)[number]>
      rows={state === 'empty' ? [] : RUNS}
      getId={(r) => r.id}
      loading={state === 'loading'}
      error={state === 'error' ? new Error('The server did not answer.') : undefined}
      onRetry={() => undefined}
      empty='Nothing has run yet. Runs appear here once a trigger fires.'
      bar={{ noun: 'runs', fields: [{ key: 'result', title: 'Result', type: 'options', options: [{ value: 'ok', label: 'Succeeded' }, { value: 'failed', label: 'Failed' }] }] }}
      searchText={(r) => r.name}
      filterValue={(r) => (r.ok ? 'ok' : 'failed')}
      rowLabel={(r) => `run of ${r.name}`}
      onOpen={() => undefined}
      icon={(r) => <StatusDot tone={r.ok ? 'success' : 'danger'} label={r.ok ? 'Succeeded' : 'Failed'} />}
      name={{ label: 'Trigger', render: (r) => <NameCell primary={r.name} /> }}
      columns={[{ key: 'at', label: 'When', width: 96, render: (r) => <RelativeTime value={r.at} now={NOW} className='text-body-sm text-muted-foreground' /> }]}
      actions={
        <Button variant='outline' size='sm' disabled={refreshing} onClick={() => { setRefreshing(true); void later(500).then(() => setRefreshing(false)) }}>
          <RefreshCw /> Refresh
        </Button>
      }
    />
  )
}

function Automation({ member, state }: Args) {
  // In the app: `params[0]` of `render(params)` is the tab; `open` is `useSettingsDialog().open`
  // with `#settings/automation/<tab>`.
  const [route, setRoute] = useState<string>('triggers')
  const open = (path = '') => setRoute(path)
  const tab: Tab = route === 'defaults' || route === 'runs' ? route : 'triggers'
  return (
    <>
      <SettingsIntro>Automation runs work for you on a schedule or when something happens.</SettingsIntro>
      <SettingsTabs
        label='Automation sections'
        value={tab}
        onChange={(t) => open(t)}
        items={[{ value: 'triggers', label: 'Triggers' }, { value: 'defaults', label: 'Defaults' }, { value: 'runs', label: 'Runs' }]}>
        <SettingsReadOnly active={member} note='Only administrators can change automation.'>
          {tab === 'triggers' && <TriggersTab state={state} />}
          {tab === 'defaults' && <DefaultsTab state={state} />}
          {tab === 'runs' && <RunsTab state={state} />}
        </SettingsReadOnly>
      </SettingsTabs>
    </>
  )
}

/** A section of distinct tasks: a list tab, a form tab and a log tab, each owning bar and footer.
 *  With `member`, search, filters and rows stay usable; New trigger, Save and the inputs do not. */
export const Tabbed: StoryObj<Args> = {
  render: (args) => (
    <PaneFrame title='Automation'>
      <Automation key={args.state} {...args} />
    </PaneFrame>
  ),
}
