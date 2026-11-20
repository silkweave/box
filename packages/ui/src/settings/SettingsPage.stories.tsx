import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '../components/Button.tsx'
import { Field, FieldGrid } from '../components/Field.tsx'
import { Input } from '../components/Input.tsx'
import { SettingsPage } from './SettingsPage.tsx'
import { SettingsGroup } from './SettingsGroup.tsx'
import { DataGrid } from '../list/DataGrid.tsx'
import { SettingsHeaderActions, SettingsIntro } from './slots.tsx'
import { SettingsReadOnly } from './states.tsx'
import { SettingsSaveBar, useSettingsForm } from './form.tsx'
import { PaneFrame, ROLES, later } from './storyFrame.tsx'

const meta = {
  title: 'Settings/SettingsPage',
  component: SettingsPage,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsPage>

export default meta
type Story = StoryObj

function RoleForm({ name, create, onClose }: { name: string; create?: boolean; onClose: () => void }) {
  const form = useSettingsForm({ stored: { name, description: '' }, onSave: () => later(), create, validate: (v) => (v.name.trim() ? null : 'A role needs a name.') })
  return (
    <>
      <form {...form.formProps} className='contents'>
        <SettingsGroup title='Role'>
          <FieldGrid columns={2}>
            <Field label='Name'><Input value={form.values.name} onChange={(e) => form.set('name', e.target.value)} /></Field>
            <Field label='Description' hint='One line, shown in Users.'><Input value={form.values.description} onChange={(e) => form.set('description', e.target.value)} /></Field>
          </FieldGrid>
        </SettingsGroup>
      </form>
      <SettingsSaveBar form={form} create={create ? 'Create role' : undefined} onCancel={onClose} />
    </>
  )
}

/** A list section whose rows open a routed page; the section decides from its route what is open. */
function Section({ initial = null, member = false }: { initial?: string | null; member?: boolean }) {
  const [open, setOpen] = useState<string | null>(initial)
  const role = ROLES.find((r) => r.id === open)
  return (
    <>
      <SettingsIntro>Roles decide what each person may see and change.</SettingsIntro>
      <SettingsHeaderActions><Button size='sm' onClick={() => setOpen('new')}><Plus /> New role</Button></SettingsHeaderActions>
      <DataGrid<(typeof ROLES)[number]>
        rows={ROLES}
        getId={(r) => r.id}
        bar={{ noun: 'roles' }}
        searchText={(r) => r.name}
        rowLabel={(r) => r.name}
        onOpen={(r) => setOpen(r.id)}
        name={{ label: 'Name', render: (r) => <span className='truncate font-medium text-text'>{r.name}</span> }}
        columns={[]}
      />
      {open === 'new' && (
        <SettingsPage title='New role' info='Pick a name now; set its access on the next page.' onClose={() => setOpen(null)}>
          <RoleForm name='' create onClose={() => setOpen(null)} />
        </SettingsPage>
      )}
      {role && (
        <SettingsPage title={role.name} info={role.description} onClose={() => setOpen(null)}>
          <SettingsReadOnly active={member} note='Only administrators can change roles.'>
            <RoleForm name={role.name} onClose={() => setOpen(null)} />
          </SettingsReadOnly>
        </SettingsPage>
      )}
    </>
  )
}

/** A detail page: breadcrumb "Roles › Sales", the description in the info popover, the save bar. */
export const Default: Story = { render: () => <PaneFrame title='Roles'><Section initial='sales' /></PaneFrame> }

/** A create page: fields only, Cancel and "Create role", disabled until valid. */
export const Create: Story = { render: () => <PaneFrame title='Roles'><Section initial='new' /></PaneFrame> }

/** A page nested under another: the trail holds the pages between the section and this one. */
export const Nested: Story = {
  render: () => (
    <PaneFrame title='Automation'>
      <SettingsPage title='Nightly digest' trail={[{ title: 'Reports', onSelect: () => undefined }]} onRoot={() => undefined} onClose={() => undefined}>
        <RoleForm name='Nightly digest' onClose={() => undefined} />
      </SettingsPage>
    </PaneFrame>
  ),
}

/** States: the member view of a detail page (notice, disabled fields, no footer). */
export const States: Story = { render: () => <PaneFrame title='Roles'><Section initial='sales' member /></PaneFrame> }

/** Outside a pane the page falls back to a modal dialog. */
export const OutsidePane: Story = {
  render: () => (
    <SettingsPage title='Sales' onClose={() => undefined}>
      <p className='text-body-sm text-muted-foreground'>Outside a settings pane this is a dialog.</p>
    </SettingsPage>
  ),
}

/** InContext: the list the page opens from. */
export const InContext: Story = { render: () => <PaneFrame title='Roles'><Section /></PaneFrame> }

// The section stays mounted under its pages (as most sections do), so its own create button is
// still published while a page covers it.
function OwnershipSection() {
  const [route, setRoute] = useState<'' | 'sales' | 'sales/toby'>('sales')
  return (
    <>
      <SettingsHeaderActions>
        <Button size='sm'><Plus /> New role</Button>
      </SettingsHeaderActions>
      <p className='px-6 text-body-sm text-muted-foreground'>The role list. Open Sales with the button below.</p>
      <div className='px-6 pt-2'><Button size='sm' variant='outline' onClick={() => setRoute('sales')}>Open Sales</Button></div>
      {route !== '' && (
        <SettingsPage title='Sales' onClose={() => setRoute('')}>
          <SettingsHeaderActions>
            <Button size='sm'><Plus /> Add holder</Button>
          </SettingsHeaderActions>
          <p className='px-6 text-body-sm text-muted-foreground'>The role's page owns the title bar: Add holder, not New role.</p>
          <div className='px-6 pt-2'><Button size='sm' variant='outline' onClick={() => setRoute('sales/toby')}>Open holder Toby</Button></div>
          {route === 'sales/toby' && (
            <SettingsPage title='Toby' trail={[{ title: 'Sales', onSelect: () => setRoute('sales') }]} onRoot={() => setRoute('')} onClose={() => setRoute('sales')}>
              <p className='px-6 text-body-sm text-muted-foreground'>A page with no create button of its own: the title bar shows none, not Add holder.</p>
            </SettingsPage>
          )}
        </SettingsPage>
      )}
    </>
  )
}

/** Ownership: the deepest open page owns the title bar, with or without actions of its own;
 *  closing it hands the bar back (Toby: none; Sales: Add holder; the list: New role). */
export const Ownership: Story = { render: () => <PaneFrame title='Roles'><OwnershipSection /></PaneFrame> }
