// Archetype: CREATE (docs/DESIGN.md 2.2 and 2.3). Use it for adding one thing: a routed
// `SettingsPage` of fields only, on the same `FieldGrid` as the detail page, with Create and Cancel
// in the footer.
// Copy this file's structure: the `route` string ('new') and `open(path)`, `SettingsPage` titled
// "New thing" (or "Add thing" for something that exists elsewhere), `useSettingsForm` with
// `create: true` and `validate`, `SettingsSaveBar create='Create role' onCancel`. The primary stays
// disabled until the form is valid. Required fields are the ones `validate` insists on, never "Optional".

import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Plus } from 'lucide-react'
import { Button } from '../../components/Button.tsx'
import { Field, FieldGrid } from '../../components/Field.tsx'
import { Input } from '../../components/Input.tsx'
import { SelectField } from '../../components/SelectField.tsx'
import { Textarea } from '../../components/Textarea.tsx'
import {
  SettingsEmpty,
  SettingsError,
  SettingsGroup,
  SettingsHeaderActions,
  SettingsIntro,
  SettingsLoading,
  SettingsPage,
  SettingsReadOnly,
  SettingsSaveBar,
  useSettingsForm,
} from '../../settings/index.ts'
import { PaneFrame, ROLES, later } from '../../settings/storyFrame.tsx'

type State = 'ready' | 'loading' | 'error' | 'empty'
type Args = { member: boolean; state: State }

const meta: Meta<Args> = {
  title: 'Patterns/Settings create',
  parameters: { layout: 'fullscreen' },
  args: { member: false, state: 'ready' },
  argTypes: {
    member: { control: 'boolean', description: 'The member view: the page without a Create button.' },
    state: { control: 'inline-radio', options: ['ready', 'loading', 'error', 'empty'] },
  },
}
export default meta

function NewRolePage({ state, onClose }: { state: State; onClose: () => void }) {
  const form = useSettingsForm({
    stored: { name: '', description: '', copyFrom: '' },
    create: true,
    validate: (v) => (v.name.trim() ? null : 'Give the role a name.'),
    onSave: async () => {
      await later()
      onClose()
    },
  })
  // `empty`: nothing to copy from yet, so the select offers only "Nothing".
  const templates = state === 'empty' ? [] : ROLES.map((r) => ({ value: r.id, label: r.name }))
  return (
    <SettingsPage title='New role' info='A role is a set of access levels, one per area. Set the levels once it exists.' onClose={onClose}>
      {state === 'loading' ? (
        <SettingsLoading label='Loading roles' />
      ) : state === 'error' ? (
        <SettingsError error={new Error('The server did not answer.')} onRetry={() => undefined} />
      ) : (
        <form {...form.formProps} className='contents'>
          <SettingsGroup title='Role'>
            <FieldGrid columns={2}>
              <Field label='Name' hint='Shown in Users and in the role picker.'>
                <Input autoFocus value={form.values.name} onChange={(e) => form.set('name', e.target.value)} />
              </Field>
              <Field label='Start from' hint='Copies the access levels of that role.'>
                <SelectField
                  value={form.values.copyFrom}
                  onValueChange={(v) => form.set('copyFrom', v)}
                  options={[{ value: '', label: 'Nothing' }, ...templates]}
                />
              </Field>
              <Field label='Description' span='full' hint='One line on who gets this role.'>
                <Textarea value={form.values.description} onChange={(e) => form.set('description', e.target.value)} />
              </Field>
            </FieldGrid>
          </SettingsGroup>
        </form>
      )}
      <SettingsSaveBar form={form} create='Create role' onCancel={onClose} />
    </SettingsPage>
  )
}

function Roles({ member, state }: Args) {
  // In the app: `params` of the section's `render(params)`; `open` is `useSettingsDialog().open`
  // with `#settings/roles/<path>` ('' the list, 'new' this page).
  const [route, setRoute] = useState('new')
  const open = (path = '') => setRoute(path)
  if (route === 'new' && !member) return <NewRolePage state={state} onClose={() => open()} />
  return (
    <>
      <SettingsIntro>Roles decide what each person may see and change.</SettingsIntro>
      <SettingsReadOnly active={member} note='Only administrators can change roles.'>
        <SettingsHeaderActions>
          <Button size='sm' onClick={() => open('new')}><Plus /> New role</Button>
        </SettingsHeaderActions>
        <SettingsEmpty>The list is another pattern. Open New role to see the create page again.</SettingsEmpty>
      </SettingsReadOnly>
    </>
  )
}

/** Adding one thing: fields only, Create disabled until valid, Cancel returns to the list. */
export const Create: StoryObj<Args> = {
  render: (args) => (
    <PaneFrame title='Roles'>
      <Roles key={`${args.state}${args.member}`} {...args} />
    </PaneFrame>
  ),
}
