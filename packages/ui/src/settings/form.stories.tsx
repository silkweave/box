import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from '../components/Button.tsx'
import { Field, FieldGrid } from '../components/Field.tsx'
import { Input } from '../components/Input.tsx'
import { SettingsDeleteButton, SettingsSaveBar, useSettingsForm } from './form.tsx'
import { SettingsPage } from './SettingsPage.tsx'
import { SettingsGroup } from './SettingsGroup.tsx'
import { SettingsReadOnly } from './states.tsx'
import { PaneFrame, later, refused } from './storyFrame.tsx'

const meta = {
  title: 'Settings/SettingsSaveBar',
  component: SettingsSaveBar,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsSaveBar>

export default meta
type Story = StoryObj

type Hours = { opens: string; closes: string; zone: string }
const HOURS: Hours = { opens: '09:00', closes: '17:00', zone: 'Europe/Vienna' }
const timeOk = (t: string) => /^\d{2}:\d{2}$/.test(t)

function HoursForm({ stored = HOURS, fail = false, start }: { stored?: Hours; fail?: boolean; start?: React.ReactNode }) {
  const form = useSettingsForm({
    stored,
    onSave: () => (fail ? refused('The help center is publishing. Try again in a minute.') : later()),
    validate: (v) => (timeOk(v.opens) && timeOk(v.closes) ? null : 'Times are HH:MM, like 09:00.'),
  })
  return (
    <form {...form.formProps} className='contents'>
      <SettingsGroup title='Working hours'>
        <FieldGrid columns={3}>
          <Field label='Opens'><Input value={form.values.opens} onChange={(e) => form.set('opens', e.target.value)} /></Field>
          <Field label='Closes'><Input value={form.values.closes} onChange={(e) => form.set('closes', e.target.value)} /></Field>
          <Field label='Time zone'><Input value={form.values.zone} onChange={(e) => form.set('zone', e.target.value)} /></Field>
        </FieldGrid>
      </SettingsGroup>
      <SettingsSaveBar form={form} start={start} />
    </form>
  )
}

/** A Form: the bar is always there, Reset and Save disabled until something changed; "Saved" after. */
export const Default: Story = { render: () => <PaneFrame title='Support'><HoursForm /></PaneFrame> }

function NewRole() {
  const form = useSettingsForm({ stored: { name: '' }, create: true, onSave: () => later(), validate: (v) => (v.name.trim() ? null : 'A role needs a name.') })
  return (
    <SettingsPage title='New role' onClose={() => undefined}>
      <form {...form.formProps} className='contents'>
        <SettingsGroup title='Role'>
          <FieldGrid columns={2}><Field label='Name'><Input value={form.values.name} onChange={(e) => form.set('name', e.target.value)} /></Field></FieldGrid>
        </SettingsGroup>
      </form>
      <SettingsSaveBar form={form} create='Create role' onCancel={() => undefined} />
    </SettingsPage>
  )
}

/** A create page: Cancel and "Create role", disabled until valid, the reason in the note. */
export const Create: Story = { render: () => <PaneFrame title='Roles'><NewRole /></PaneFrame> }

const deleteSales = (fail: boolean, holders = 0) => (
  <SettingsDeleteButton
    label='Delete role'
    confirm={{ title: 'Delete role "Sales"?', message: 'Its holders keep their other roles.' }}
    onDelete={() => (fail ? refused('Sales is the default role for new users.') : later())}
    disabledReason={holders > 0 ? 'Move its holders first.' : undefined}
  />
)

/** A detail page: Delete at the far left; a refused delete reports in the note. */
export const WithDelete: Story = { render: () => <PaneFrame title='Roles › Sales'><><HoursForm start={deleteSales(true)} /></></PaneFrame> }

function Stale() {
  const [stored, setStored] = useState(HOURS)
  return (
    <>
      <HoursForm stored={stored} fail />
      <div className='mx-4 mt-6 md:mx-6'>
        <Button size='xs' variant='outline' onClick={() => setStored({ ...stored, opens: stored.opens === '09:00' ? '08:00' : '09:00' })}>Someone else saves</Button>
      </div>
    </>
  )
}

/**
 * States: change a field and Save to see a save error; type "9" in Opens to see the invalid
 * sentence; change a field and press "Someone else saves" to see the stale note. Delete is
 * disabled with its reason as the title.
 */
export const States: Story = {
  render: () => (
    <PaneFrame title='Support'>
      <Stale />
    </PaneFrame>
  ),
}

/** Read-only: the bar and Delete render nothing in the member view. */
export const ReadOnly: Story = {
  render: () => (
    <PaneFrame title='Roles › Sales'>
      <>
        <SettingsReadOnly active note='Only administrators can change roles.'>
          <HoursForm start={deleteSales(false, 2)} />
        </SettingsReadOnly>
      </>
    </PaneFrame>
  ),
}

/** InContext: a detail page with Delete disabled because the role has holders. */
export const InContext: Story = { render: () => <PaneFrame title='Roles › Sales'><><HoursForm start={deleteSales(false, 3)} /></></PaneFrame> }
