import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { withStage } from '../stories/Stage.tsx'
import { Checkbox } from './Checkbox.tsx'
import { Field, FieldGrid, FieldSection } from './Field.tsx'
import { Input } from './Input.tsx'
import { SelectField } from './SelectField.tsx'
import { Switch } from './Switch.tsx'
import { Textarea } from './Textarea.tsx'

const meta = {
  title: 'Base/Field',
  decorators: [withStage],
  component: Field,
} satisfies Meta<typeof Field>

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => (
    <div className='max-w-sm'>
      <Field label='Display name' hint='Shown on messages and in the members list.'>
        <Input defaultValue='Ada Lovelace' />
      </Field>
    </div>
  ),
}

/** `aside` sits right of the label; `error` replaces the hint and marks the control invalid. */
export const Variants: Story = {
  render: () => (
    <div className='grid max-w-sm gap-4'>
      <Field label='Slug' aside={<a className='text-accent hover:underline' href='#slug'>What is this?</a>}>
        <Input mono defaultValue='weekly-digest' />
      </Field>
      <Field label='Description' aside='112 / 280'>
        <Textarea defaultValue='A short summary of what moved this week: signals, goals and the tasks that closed.' />
      </Field>
      <Field label='Webhook URL' error='Enter a URL that starts with https://.'>
        <Input mono defaultValue='http://hooks.example.com/box' />
      </Field>
    </div>
  ),
}

/** Every kit control reads the field: the label opens or focuses it, the hint describes it. */
export const States: Story = {
  render: function States() {
    const [kind, setKind] = useState('')
    const [on, setOn] = useState(true)
    return (
      <div className='grid max-w-sm gap-4'>
        <Field label='Kind' error='Pick a kind.'>
          <SelectField value={kind} onValueChange={setKind} placeholder='Pick a kind…' options={[{ value: 'goal', label: 'Goal' }, { value: 'bet', label: 'Bet' }]} />
        </Field>
        <Field label='Enabled' hint='Runs on its schedule while enabled.'>
          <Switch checked={on} onCheckedChange={setOn} />
        </Field>
        <Field label='Archived'>
          <Checkbox />
        </Field>
        <Field label='Client id' hint='Read-only: issued by the provider.'>
          <Input mono readOnly value='box_7f3a9c21e4b84d0f' />
        </Field>
        <Field label='Name' hint='Disabled while the import runs.'>
          <Input disabled defaultValue='Sales pipeline' />
        </Field>
      </div>
    )
  },
}

/** Columns answer the grid's own width: drag the canvas narrower and they collapse to one. */
export const Grid: Story = {
  render: () => (
    <div className='grid max-w-3xl gap-8'>
      <FieldGrid columns={3}>
        <Field label='First name'><Input defaultValue='Grace' /></Field>
        <Field label='Last name'><Input defaultValue='Hopper' /></Field>
        <Field label='Nickname'><Input defaultValue='Grace' /></Field>
        <Field label='Email' span={2}><Input type='email' defaultValue='grace@example.com' /></Field>
        <Field label='Timezone'><Input defaultValue='Europe/Vienna' /></Field>
        <Field label='About' span='full'><Textarea autoGrow defaultValue='Leads the compiler work.' /></Field>
      </FieldGrid>
      <FieldGrid columns={2}>
        <Field label='Server name'><Input defaultValue='Linear' /></Field>
        <Field label='Address'><Input mono defaultValue='https://mcp.linear.app/sse' /></Field>
      </FieldGrid>
    </div>
  ),
}

/** Inside a narrow pane the three-column grid is one column. */
export const InContext: Story = {
  render: () => (
    <div className='flex gap-6'>
      <div className='w-[22rem] rounded-xl border border-border p-4'>
        <FieldGrid columns={3}>
          <Field label='Role name'><Input defaultValue='Sales' /></Field>
          <Field label='Slug'><Input mono defaultValue='sales' /></Field>
          <Field label='Seats' hint='0 means unlimited.'><Input type='number' defaultValue={5} /></Field>
        </FieldGrid>
      </div>
      <div className='w-[44rem] rounded-xl border border-border p-4'>
        <FieldGrid columns={3}>
          <Field label='Role name'><Input defaultValue='Sales' /></Field>
          <Field label='Slug'><Input mono defaultValue='sales' /></Field>
          <Field label='Seats' hint='0 means unlimited.'><Input type='number' defaultValue={5} /></Field>
        </FieldGrid>
      </div>
    </div>
  ),
}

/** `FieldSection` splits a dialog form into named parts; the first section drops its rule. */
export const Sections: Story = {
  render: () => (
    <div className='flex w-[32rem] flex-col gap-5 rounded-xl border border-border p-4'>
      <FieldSection title='Data'>
        <FieldGrid columns={2}>
          <Field label='Where the numbers come from' span='full'>
            <SelectField
              value='manual'
              onValueChange={() => {}}
              options={[
                { value: 'manual', label: 'Typed by hand' },
                { value: 'box', label: 'Tracked automatically by the Box' },
              ]}
            />
          </Field>
        </FieldGrid>
      </FieldSection>
      <FieldSection title='Details' aside='3 fields'>
        <FieldGrid columns={2}>
          <Field label='Label' span='full'><Input defaultValue='Monthly recurring revenue' /></Field>
          <Field label='Group'><Input defaultValue='Finance' /></Field>
          <Field label='Unit'><Input defaultValue='$' /></Field>
        </FieldGrid>
      </FieldSection>
    </div>
  ),
}
