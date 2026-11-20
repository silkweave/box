// Archetype: LIST in Settings (docs/DESIGN.md), plus its variants: grouped, editable in place, and
// the member view. THE BOILERPLATE for a Settings list: copy the component that matches and rename.
//
// One `DataGrid` is the whole list: its bar (search, filters, sort, grouping), the column header,
// the rows, the group rows with counts, the empty and no-match states, loading and error, and the
// count in the pane's footer. A Settings section writes no list markup of its own.
// The same component is the app's list page (Patterns/List view): Settings only changes the frame.

import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Plus } from 'lucide-react'
import { ActionMenu } from '../../components/ActionMenu.tsx'
import { Badge } from '../../components/Badge.tsx'
import { Button } from '../../components/Button.tsx'
import { confirm } from '../../components/Confirm.tsx'
import { Input } from '../../components/Input.tsx'
import { DataGrid } from '../../list/DataGrid.tsx'
import { SettingsEmpty, SettingsHeaderActions, SettingsIntro, SettingsPage, SettingsReadOnly } from '../../settings/index.ts'
import { PaneFrame, ROLES, later } from '../../settings/storyFrame.tsx'

type State = 'ready' | 'loading' | 'error' | 'empty'
type Args = { member: boolean; state: State }

const meta: Meta<Args> = {
  title: 'Patterns/Settings list',
  parameters: { layout: 'fullscreen' },
  args: { member: false, state: 'ready' },
  argTypes: {
    member: { control: 'boolean', description: 'The member view: same list, no create, delete or editing.' },
    state: { control: 'inline-radio', options: ['ready', 'loading', 'error', 'empty'] },
  },
}
export default meta
type Story = StoryObj<Args>

type Role = (typeof ROLES)[number]

function Roles({ member, state }: Args) {
  // In the app: `params` of the section's `render(params)`; `open` is `useSettingsDialog().open`
  // with `#settings/roles/<path>` ('' is the list, 'new' the create page, '<id>' a detail page).
  const [route, setRoute] = useState('')
  const open = (path = '') => setRoute(path)
  const [roles, setRoles] = useState<Role[]>(ROLES)
  const [status, setStatus] = useState(state)

  if (route) {
    // The detail and create pages are their own archetypes; this story only shows the way in.
    return (
      <SettingsPage title={route === 'new' ? 'New role' : `Roles › ${roles.find((r) => r.id === route)?.name ?? route}`} onClose={() => open()}>
        <SettingsEmpty>See Patterns/Settings detail and Patterns/Settings create for this page.</SettingsEmpty>
      </SettingsPage>
    )
  }

  const remove = async (r: Role) => {
    if (await confirm({ title: `Delete role "${r.name}"?`, message: 'Its holders keep their other roles.', confirmLabel: 'Delete role', danger: true }))
      setRoles((all) => all.filter((x) => x.id !== r.id))
  }

  const list = (
    <DataGrid<Role>
      rows={status === 'empty' ? [] : roles}
      getId={(r) => r.id}
      loading={status === 'loading'}
      error={status === 'error' ? new Error('The server did not answer.') : undefined}
      onRetry={() => setStatus('ready')}
      empty='No roles yet. Add the first with New role.'
      bar={{
        noun: 'roles',
        fields: [{ key: 'kind', title: 'Kind', type: 'options', options: [{ value: 'built-in', label: 'Built in' }, { value: 'custom', label: 'Custom' }] }],
        sort: [{ value: 'name', label: 'Name' }, { value: 'holders', label: 'Holders', defaultDir: 'desc' }],
      }}
      searchText={(r) => `${r.name} ${r.description}`}
      filterValue={(r, key) => (key === 'kind' ? (r.builtIn ? 'built-in' : 'custom') : null)}
      sortValue={(r, key) => (key === 'holders' ? r.holders : r.name)}
      rowLabel={(r) => r.name}
      onOpen={(r) => open(r.id)}
      name={{
        label: 'Name',
        render: (r) => (
          <div className='min-w-0'>
            <p className='truncate font-medium text-text'>{r.name}</p>
            <p className='truncate text-label text-muted-foreground'>{r.description}</p>
          </div>
        ),
      }}
      columns={[
        { key: 'holders', label: 'Holders', width: 96, priority: 2, render: (r) => <span className='text-muted-foreground'>{r.holders === 1 ? '1 person' : `${r.holders} people`}</span> },
        { key: 'kind', label: 'Kind', width: 88, priority: 3, render: (r) => r.builtIn && <Badge>Built in</Badge> },
      ]}
      // Only the actions this person may take: Delete is left out for members and refused roles.
      rowActions={(r) => (
        <ActionMenu size='sm' label={`Actions for ${r.name}`} items={[{ label: 'Open', onSelect: () => open(r.id) }, ...(!member && !r.builtIn && r.holders === 0 ? [{ label: 'Delete role', danger: true, onSelect: () => void remove(r) }] : [])]} />
      )}
    />
  )

  return (
    <>
      <SettingsIntro info='Assign roles in Users. A role with holders cannot be deleted.'>Roles decide what each person may see and change.</SettingsIntro>
      {/* The grid goes in `lead`: a member still searches, filters and opens, outside the disabled scope. */}
      <SettingsReadOnly active={member} note='Only administrators can change roles.'>
        {list}
        <SettingsHeaderActions>
          <Button size='sm' onClick={() => open('new')}><Plus /> New role</Button>
        </SettingsHeaderActions>
      </SettingsReadOnly>
    </>
  )
}

/** A collection of named things: create in the title bar, the whole row opens the detail page. */
export const List: Story = {
  render: (args) => (
    <PaneFrame title='Roles'>
      <Roles key={args.state} {...args} />
    </PaneFrame>
  ),
}

// ---- Grouped, with folders known before their rows ------------------------------------------------

type Trigger = { id: string; name: string; folder: string; schedule: string }
const FOLDERS = [
  { key: 'backups', name: 'Backups' },
  { key: 'reports', name: 'Reports' },
  { key: 'later', name: 'Later' },
]
const TRIGGERS: Trigger[] = [
  { id: 'nightly', name: 'Nightly backup', folder: 'backups', schedule: 'Every day at 02:00' },
  { id: 'weekly', name: 'Weekly offsite copy', folder: 'backups', schedule: 'Sundays at 03:00' },
  { id: 'kpis', name: 'KPI digest', folder: 'reports', schedule: 'Mondays at 08:00' },
]

function Triggers() {
  return (
    <DataGrid<Trigger>
      rows={TRIGGERS}
      getId={(t) => t.id}
      bar={{ noun: 'triggers', groupBy: [{ value: 'folder', label: 'Folder' }] }}
      defaultView={{ groupBy: 'folder' }}
      searchText={(t) => t.name}
      groupOf={(t) => ({ key: t.folder, label: FOLDERS.find((f) => f.key === t.folder)?.name ?? t.folder })}
      // "Later" has no triggers yet and still shows (not while searching); each folder has its menu.
      groupCatalog={{
        folder: FOLDERS.map((f) => ({ key: f.key, label: f.name, name: f.name, aside: <ActionMenu size='sm' label={`Actions for ${f.name}`} items={[{ label: 'Rename folder', onSelect: () => undefined }]} /> })),
      }}
      rowLabel={(t) => t.name}
      onOpen={() => undefined}
      name={{ label: 'Name', render: (t) => <span className='truncate font-medium text-text'>{t.name}</span> }}
      columns={[{ key: 'schedule', label: 'Schedule', width: 180, priority: 2, render: (t) => <span className='text-muted-foreground'>{t.schedule}</span> }]}
    />
  )
}

/** Rows in named folders: one group row per folder (chevron, name, count, the folder's menu). */
export const Grouped: Story = {
  render: () => (
    <PaneFrame title='Automation'>
      <Triggers />
    </PaneFrame>
  ),
}

// ---- Editable in place ----------------------------------------------------------------------------

type Kind = { id: string; name: string; description: string }
const KINDS: Kind[] = [
  { id: 'program', name: 'Program', description: 'A funded programme with a fixed end date.' },
  { id: 'sales', name: 'Sales', description: 'Work that wins or keeps revenue.' },
  { id: 'product', name: 'Product', description: 'A release of something we sell.' },
]
const NEW = '__new'

function Kinds({ member, state }: Args) {
  const [kinds, setKinds] = useState(KINDS)
  const [status, setStatus] = useState(state)
  // The host owns the draft and which row edits: a kind id, NEW, or null.
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState({ name: '', description: '' })
  const begin = (id: string, from: Kind | null) => {
    setDraft({ name: from?.name ?? '', description: from?.description ?? '' })
    setEditing(id)
  }
  const save = async () => {
    const saved = editing
    await later()
    if (draft.name.trim().toLowerCase() === 'fail') throw new Error('A kind by that name exists.')
    const next = { id: editing === NEW ? draft.name.toLowerCase().replace(/\W+/g, '-') : editing!, ...draft }
    setKinds((all) => (editing === NEW ? [next, ...all] : all.map((k) => (k.id === editing ? next : k))))
    // Close only the row this save was for: the title bar's New kind may have opened another.
    setEditing((cur) => (cur === saved ? null : cur))
  }
  const remove = async (k: Kind) => {
    if (await confirm({ title: `Delete kind "${k.name}"?`, message: 'Initiatives of this kind keep it until you change them.', confirmLabel: 'Delete kind', danger: true }))
      setKinds((all) => all.filter((x) => x.id !== k.id))
  }

  const list = (
    <DataGrid<Kind>
      rows={status === 'empty' ? [] : kinds}
      getId={(k) => k.id}
      loading={status === 'loading'}
      error={status === 'error' ? new Error('The server did not answer.') : undefined}
      onRetry={() => setStatus('ready')}
      empty='No kinds yet. Add the first with New kind.'
      bar={{ noun: 'kinds' }}
      searchText={(k) => `${k.name} ${k.description}`}
      rowLabel={(k) => k.name}
      // A click on a row edits it (no detail page for a kind).
      onOpen={member ? undefined : (k) => begin(k.id, k)}
      openLabel={(k) => `Edit ${k.name}`}
      // Edit cells read and write the host's draft; Enter saves, Escape cancels, a failed save keeps
      // the draft and shows its message in the row. Try the name "fail".
      editing={{
        id: editing,
        row: editing === NEW ? { id: NEW, name: '', description: '' } : undefined,
        onSave: save,
        onCancel: () => setEditing(null),
        canSave: draft.name.trim() !== '',
        saveLabel: editing === NEW ? 'Create kind' : 'Save',
      }}
      name={{
        label: 'Name',
        render: (k) => <span className='truncate font-medium text-text'>{k.name}</span>,
        edit: () => <Input size='sm' aria-label='Name' placeholder='Name' value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />,
      }}
      columns={[
        {
          key: 'description',
          label: 'Description',
          width: 260,
          priority: 2,
          render: (k) => <span className='block truncate text-muted-foreground'>{k.description}</span>,
          edit: () => <Input size='sm' aria-label='Description' placeholder='What this kind is for' value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />,
        },
      ]}
      rowActions={member ? undefined : (k) => <ActionMenu size='sm' label={`Actions for ${k.name}`} items={[{ label: 'Delete kind', danger: true, onSelect: () => void remove(k) }]} />}
    />
  )

  return (
    <>
      <SettingsIntro>Kinds sort initiatives into the types your team plans.</SettingsIntro>
      <SettingsReadOnly active={member} note='Only administrators can change kinds.'>
        {list}
        <SettingsHeaderActions>
          {/* Stays visible and disabled while the create row is open. */}
          <Button size='sm' disabled={editing === NEW} onClick={() => begin(NEW, null)}><Plus /> New kind</Button>
        </SettingsHeaderActions>
      </SettingsReadOnly>
    </>
  )
}

/** Things small enough to edit in a row: rows edit in place, create adds a row on top. Offer this
 *  wherever a record's fields fit a row (Toby, 2026-11-18). */
export const Editable: Story = {
  render: (args) => (
    <PaneFrame title='Initiative kinds'>
      <Kinds key={args.state} {...args} />
    </PaneFrame>
  ),
}
