import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Field, FieldGrid } from '../components/Field.tsx'
import { Input } from '../components/Input.tsx'
import { SegmentedControl } from '../components/SegmentedControl.tsx'
import { Plus } from 'lucide-react'
import { Badge } from '../components/Badge.tsx'
import { Button } from '../components/Button.tsx'
import { DataGrid } from '../list/DataGrid.tsx'
import { InlineDialogScope } from '../components/InlineDialog.tsx'
import {
  SettingsGroup,
  SettingsIntro,
  SettingsPane,
  SettingsDeleteButton,
  SettingsHeaderActions,
  SettingsNotice,
  SettingsPage,
  SettingsReadOnly,
  SettingsSaveBar,
  useSettingsForm,
} from './index.ts'
import { ControlRowList, ROLES, later } from './storyFrame.tsx'

const meta = {
  title: 'Settings/SettingsPane',
  component: SettingsPane,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsPane>

export default meta

type Role = (typeof ROLES)[number]

function RolePage({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const form = useSettingsForm({
    stored: { name: role?.name ?? '', description: role?.description ?? '' },
    onSave: () => later(),
    validate: (v) => (v.name.trim() ? null : 'A role needs a name.'),
    create: !role,
  })
  return (
    <SettingsPage title={role?.name ?? 'New role'} info='A role is a set of access levels, one per area.' onClose={onClose}>
      <form {...form.formProps} className='contents'>
        <SettingsGroup title='Role'>
          <FieldGrid columns={2}>
            <Field label='Name'><Input value={form.values.name} onChange={(e) => form.set('name', e.target.value)} /></Field>
            <Field label='Description' hint='One line, shown in Users.'><Input value={form.values.description} onChange={(e) => form.set('description', e.target.value)} /></Field>
          </FieldGrid>
        </SettingsGroup>
      </form>
      <SettingsGroup title='Access' description='Each area is on its own level.'>
        <ControlRowList />
      </SettingsGroup>
      <SettingsSaveBar
        form={form}
        create={role ? undefined : 'Create role'}
        onCancel={onClose}
        start={role && (
          <SettingsDeleteButton
            label='Delete role'
            confirm={{ title: `Delete role "${role.name}"?`, message: 'Its holders keep their other roles.' }}
            onDelete={() => later()}
            disabledReason={role.holders > 0 ? 'Move its holders first.' : undefined}
          />
        )}
      />
    </SettingsPage>
  )
}

function Roles({ member }: { member: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  const [view, setView] = useState<'all' | 'custom'>('all')
  const rows = ROLES.filter((r) => view === 'all' || !r.builtIn)
  return (
    <>
      <SettingsIntro info='Assign roles in Users. A role with holders cannot be deleted.'>Roles decide what each person may see and change.</SettingsIntro>
      <SettingsReadOnly active={member} note='Only administrators can change roles.'>
        <SettingsHeaderActions>
          {!open && <Button size='sm' onClick={() => setOpen('new')}><Plus /> New role</Button>}
        </SettingsHeaderActions>
        <SettingsNotice tone='warning' title='One role has no holders'>Support is assigned to nobody. Assign it in Users or delete it.</SettingsNotice>
        <DataGrid<Role>
          rows={rows}
          getId={(r) => r.id}
          bar={{ noun: 'roles' }}
          searchText={(r) => r.name}
          rowLabel={(r) => r.name}
          onOpen={(r) => setOpen(r.id)}
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
            { key: 'holders', label: 'Holders', width: 96, priority: 2, render: (r) => <span className='text-body-sm text-muted-foreground'>{r.holders}</span> },
            { key: 'kind', label: '', width: 88, render: (r) => r.builtIn && <Badge>Built in</Badge> },
          ]}
          actions={<SegmentedControl value={view} onChange={setView} options={[{ value: 'all', label: 'All' }, { value: 'custom', label: 'Custom' }]} />}
        />
        <DataGrid<Role> variant='section' title='Archived' rows={[]} getId={(r) => r.id} bar={{ noun: 'roles' }} empty='No archived roles yet. Archive a role from its page.' name={{ label: 'Name', render: (r) => r.name }} columns={[]} />
      </SettingsReadOnly>
      {open && <RolePage role={ROLES.find((r) => r.id === open) ?? null} onClose={() => setOpen(null)} />}
    </>
  )
}

/**
 * The house rules of 2026-11-13 and 2026-11-17 in one section: the intro in the info popover, the
 * create action in the title bar, a notice, a grid with its column header and a view switch in its actions, a second
 * grid (`section`) with its title and empty sentence. A row opens a `SettingsPage` with groups, control rows and the save
 * bar with Delete at its left. `member` shows the member view.
 */
export const HouseRules: StoryObj<{ member: boolean }> = {
  args: { member: false },
  render: ({ member }) => (
    <div className='h-[40rem] w-[52rem] border border-border'>
      <SettingsPane title='Roles' onClose={() => undefined}>
        <InlineDialogScope scroll={false}>
          <Roles member={member} />
        </InlineDialogScope>
      </SettingsPane>
    </div>
  ),
}
