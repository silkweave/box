import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Field, FieldGrid } from '../components/Field.tsx'
import { Input } from '../components/Input.tsx'
import { Button } from '../components/Button.tsx'
import { SettingsChangedFrom, SettingsEmpty, SettingsError, SettingsLoading, SettingsNotice, SettingsReadOnly } from './states.tsx'
import { SettingsGroup } from './SettingsGroup.tsx'
import { SettingsSaveBar, useSettingsForm } from './form.tsx'
import { PaneFrame, later } from './storyFrame.tsx'

const meta = {
  title: 'Settings/States',
  component: SettingsNotice,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsNotice>

export default meta
type Story = StoryObj

/** Notices in their three tones: a plain note, a condition the owner must fix, a failure. */
export const Default: Story = {
  render: () => (
    <PaneFrame title='Notices' className='h-auto'>
      <>
        <SettingsNotice title='Replies go to the shared inbox'>Change the address in Email.</SettingsNotice>
        <SettingsNotice tone='warning' title='Not set up yet'>
          Add <code className='rounded bg-[var(--bg-code)] px-1 font-mono'>server.publicUrl</code> in box.json, then restart the Box.
        </SettingsNotice>
        <SettingsNotice tone='danger' title='The last sync failed'>Stripe refused the key. Sign in again.</SettingsNotice>
        <SettingsNotice tone='warning' title='Two things need you' items={['No sending domain is verified.', 'The inbound webhook has not been called yet.']}>
          Email cannot send until both are done.
        </SettingsNotice>
      </>
    </PaneFrame>
  ),
}

/** Changed from: an outside system rewrote a value; the old text and the act that accepts the new one. */
export const ChangedFrom: Story = {
  render: () => (
    <div className='max-w-md p-6 text-body-sm text-muted-foreground'>
      <p>Creates an issue in the tracker and returns its id.</p>
      <SettingsChangedFrom title='The description changed. It was:' previous={'Creates an issue.\nReturns nothing.'} action={<Button size='sm' variant='ghost'>Accept the new description</Button>} />
    </div>
  ),
}

/** Empty: one sentence, what goes here and how to add the first. */
export const Empty: Story = { render: () => <PaneFrame title='Pods' className='h-auto'><SettingsEmpty>No pods yet. Add the first with New pod.</SettingsEmpty></PaneFrame> }

/** Loading: nothing for 300 ms, then skeleton rows. */
export const Loading: Story = { render: () => <PaneFrame title='Roles' className='h-auto'><SettingsLoading /></PaneFrame> }

/** Error: a readable sentence from whatever was caught, and Retry. */
export const Error: Story = {
  render: function Render() {
    const [tries, setTries] = useState(1)
    const err = Object.assign(new globalThis.Error('Only administrators can list agent tools.'), { name: 'TRPCClientError' })
    return (
      <PaneFrame title='Agent tools' className='h-auto'>
        <>
          <SettingsError error={err} onRetry={() => setTries(tries + 1)} />
          <SettingsError error={null} title={`Tried ${tries} times`} />
        </>
      </PaneFrame>
    )
  },
}

function WikiForm() {
  const form = useSettingsForm({ stored: { model: 'claude-sonnet', schedule: 'Daily at 06:00' }, onSave: () => later() })
  return (
    <form {...form.formProps} className='contents'>
      <SettingsGroup title='Notes agent'>
        <FieldGrid columns={2}>
          <Field label='Model'><Input value={form.values.model} onChange={(e) => form.set('model', e.target.value)} /></Field>
          <Field label='Schedule'><Input value={form.values.schedule} onChange={(e) => form.set('schedule', e.target.value)} /></Field>
        </FieldGrid>
      </SettingsGroup>
      <SettingsSaveBar form={form} />
    </form>
  )
}

/** Read-only: the member view. One sentence, disabled fields, no footer. Toggle `active`. */
export const ReadOnly: StoryObj<{ active: boolean }> = {
  args: { active: true },
  render: ({ active }) => (
    <PaneFrame title='Notes'>
      <>
        <SettingsReadOnly active={active} note='Only administrators can change this.'>
          <WikiForm />
        </SettingsReadOnly>
      </>
    </PaneFrame>
  ),
}

/** InContext: a notice above the form it concerns. */
export const InContext: Story = {
  render: () => (
    <PaneFrame title='Notes'>
      <>
        <SettingsNotice tone='warning' title='The notes agent is off'>Turn on the notes powerup in Builder to let it run.</SettingsNotice>
        <WikiForm />
      </>
    </PaneFrame>
  ),
}
