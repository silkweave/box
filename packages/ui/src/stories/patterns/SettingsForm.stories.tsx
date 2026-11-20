// Archetype: FORM (docs/DESIGN.md 2.2 and 2.3). Use it for settings that exist once: groups of
// fields on a `FieldGrid`, one Save for the whole page, always visible in the footer.
// Copy this file's structure: `useSettingsForm` for stored and draft values, `<form {...form.formProps}
// className='contents'>` around the groups, 3 columns for short values, 2 for medium, 1 for long
// text and code, and `SettingsSaveBar` (Reset and Save stay disabled until something changed).
// Under `SettingsReadOnly` the bar disappears and the controls are disabled.

import type { Meta, StoryObj } from '@storybook/react-vite'
import { Field, FieldGrid } from '../../components/Field.tsx'
import { Input } from '../../components/Input.tsx'
import { SelectField } from '../../components/SelectField.tsx'
import { Switch } from '../../components/Switch.tsx'
import { Textarea } from '../../components/Textarea.tsx'
import {
  SettingsControlRow,
  SettingsError,
  SettingsGroup,
  SettingsIntro,
  SettingsControlList,
  SettingsLoading,
  SettingsReadOnly,
  SettingsSaveBar,
  useSettingsForm,
} from '../../settings/index.ts'
import { PaneFrame, later } from '../../settings/storyFrame.tsx'

type State = 'ready' | 'loading' | 'error' | 'empty'
type Args = { member: boolean; state: State }

const meta: Meta<Args> = {
  title: 'Patterns/Settings form',
  parameters: { layout: 'fullscreen' },
  args: { member: false, state: 'ready' },
  argTypes: {
    member: { control: 'boolean', description: 'The member view: same page, controls disabled, no footer.' },
    state: { control: 'inline-radio', options: ['ready', 'loading', 'error', 'empty'] },
  },
}
export default meta

const STORED = {
  name: 'Atomic Team',
  locale: 'en-GB',
  timezone: 'Europe/Berlin',
  weekStart: 'monday',
  signature: 'Sent from the Atomic Team box.',
  digest: true,
  invites: false,
}

const TIMEZONES = ['Europe/Berlin', 'Europe/London', 'America/New_York', 'Asia/Jakarta'].map((value) => ({ value, label: value }))

function Workspace({ member, state }: Args) {
  const form = useSettingsForm({
    stored: STORED,
    onSave: () => later(),
    validate: (v) => (v.name.trim() ? null : 'The workspace needs a name.'),
  })
  const ready = state === 'ready' || state === 'empty'
  return (
    <>
      <SettingsIntro info='These settings apply to everyone on the box.'>How the workspace looks and when it sends mail.</SettingsIntro>
      <SettingsReadOnly active={member} note='Only administrators can change the workspace.'>
        {state === 'loading' && <SettingsLoading label='Loading workspace settings' />}
        {state === 'error' && <SettingsError error={new Error('The server did not answer.')} onRetry={() => undefined} />}
        {ready && (
          <form {...form.formProps} className='contents'>
            <SettingsGroup title='Identity'>
              <FieldGrid columns={2}>
                <Field label='Name' hint='Shown in the sidebar and in mail.'>
                  <Input value={form.values.name} onChange={(e) => form.set('name', e.target.value)} />
                </Field>
              </FieldGrid>
            </SettingsGroup>
            <SettingsGroup title='Regional'>
              <FieldGrid columns={3}>
                <Field label='Language'>
                  <SelectField value={form.values.locale} onValueChange={(v) => form.set('locale', v)} options={[{ value: 'en-GB', label: 'English (UK)' }, { value: 'en-US', label: 'English (US)' }]} />
                </Field>
                <Field label='Time zone'>
                  <SelectField value={form.values.timezone} onValueChange={(v) => form.set('timezone', v)} options={TIMEZONES} />
                </Field>
                <Field label='Week starts on'>
                  <SelectField value={form.values.weekStart} onValueChange={(v) => form.set('weekStart', v)} options={[{ value: 'monday', label: 'Monday' }, { value: 'sunday', label: 'Sunday' }]} />
                </Field>
              </FieldGrid>
            </SettingsGroup>
            <SettingsGroup title='Mail'>
              <FieldGrid columns={1}>
                <Field label='Signature' hint='Added to every mail the box sends for you.'>
                  <Textarea value={form.values.signature} onChange={(e) => form.set('signature', e.target.value)} />
                </Field>
              </FieldGrid>
              <SettingsControlList label='Mail options'>
                <SettingsControlRow title='Daily digest' description='One mail each morning with what changed.'>
                  <Switch aria-label='Daily digest' checked={form.values.digest} onCheckedChange={(v) => form.set('digest', v)} />
                </SettingsControlRow>
                <SettingsControlRow title='Invitations' description='Let any member invite people.'>
                  <Switch aria-label='Invitations' checked={form.values.invites} onCheckedChange={(v) => form.set('invites', v)} />
                </SettingsControlRow>
              </SettingsControlList>
            </SettingsGroup>
          </form>
        )}
      </SettingsReadOnly>
      {ready && <SettingsSaveBar form={form} />}
    </>
  )
}

/** Settings that exist once: groups of fields, one Save in an always-visible footer. */
export const Form: StoryObj<Args> = {
  render: (args) => (
    <PaneFrame title='Workspace'>
      <Workspace key={args.state} {...args} />
    </PaneFrame>
  ),
}
