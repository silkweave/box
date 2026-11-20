import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { withStage } from '../stories/Stage.tsx'
import { Field, FieldGrid } from './Field.tsx'
import { Input } from './Input.tsx'
import { Switch } from './Switch.tsx'

const meta = {
  title: 'Base/Switch',
  decorators: [withStage],
  component: Switch,
} satisfies Meta<typeof Switch>

export default meta
type Story = StoryObj<typeof meta>

function Labelled({ label, size, initial = true }: { label: string; size?: 'sm' | 'md'; initial?: boolean }) {
  const [on, setOn] = useState(initial)
  return (
    <label className='inline-flex items-center gap-2 text-body-sm text-text'>
      <Switch size={size} checked={on} onCheckedChange={setOn} />
      {label}
    </label>
  )
}

export const Default: Story = {
  args: { checked: true, onCheckedChange: () => undefined },
  render: () => <Labelled label='Trigger enabled' />,
}

export const Sizes: Story = {
  args: { checked: true, onCheckedChange: () => undefined },
  render: () => (
    <div className='flex flex-col gap-3'>
      <Labelled label='md (default)' />
      <Labelled label='sm, for dense rows' size='sm' />
    </div>
  ),
}

/** The last one is disabled by its `<fieldset disabled>`, with no prop: how read-only views work. */
export const States: Story = {
  args: { checked: true, onCheckedChange: () => undefined },
  render: () => (
    <div className='flex flex-col gap-3 text-body-sm text-text'>
      <Labelled label='Off' initial={false} />
      <Labelled label='On' />
      <label className='inline-flex items-center gap-2'>
        <Switch checked disabled onCheckedChange={() => undefined} /> Disabled on
      </label>
      <label className='inline-flex items-center gap-2'>
        <Switch checked={false} disabled onCheckedChange={() => undefined} /> Disabled off
      </label>
      <fieldset disabled className='m-0 border-0 p-0'>
        <label className='inline-flex items-center gap-2'>
          <Switch checked onCheckedChange={() => undefined} /> Inside a disabled fieldset
        </label>
      </fieldset>
      <Switch aria-label='Alerts armed' checked onCheckedChange={() => undefined} />
    </div>
  ),
}

export const InContext: Story = {
  args: { checked: true, onCheckedChange: () => undefined },
  render: function InContext() {
    const [enabled, setEnabled] = useState(true)
    const [armed, setArmed] = useState(false)
    return (
      <div className='max-w-2xl'>
        <FieldGrid columns={3}>
          <Field label='Source'><Input defaultValue='GitHub stars' /></Field>
          <Field label='Enabled' hint='Pulls every hour while on.'>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </Field>
          <Field label='Alerts armed'>
            <Switch checked={armed} onCheckedChange={setArmed} />
          </Field>
        </FieldGrid>
      </div>
    )
  },
}
