import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '../components/Button.tsx'
import { Field, FieldGrid } from '../components/Field.tsx'
import { Input } from '../components/Input.tsx'
import { Textarea } from '../components/Textarea.tsx'
import { SettingsGroup } from './SettingsGroup.tsx'
import { DataGrid } from '../list/DataGrid.tsx'
import { SettingsReadOnly } from './states.tsx'
import { PaneFrame } from './storyFrame.tsx'

const meta = {
  title: 'Settings/SettingsGroup',
  component: SettingsGroup,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsGroup>

export default meta
type Story = StoryObj

function Profile() {
  return (
    <>
      <SettingsGroup title='Profile'>
        <FieldGrid columns={3}>
          <Field label='First name'><Input defaultValue='Ada' /></Field>
          <Field label='Last name'><Input defaultValue='Lovelace' /></Field>
          <Field label='Nickname' hint='Shown in chat.'><Input defaultValue='Ada' /></Field>
        </FieldGrid>
      </SettingsGroup>
      <SettingsGroup title='About' description='A few lines the agents read before they write for you.'>
        <FieldGrid><Field label='Bio'><Textarea defaultValue='Writes the analytical engine notes.' /></Field></FieldGrid>
      </SettingsGroup>
    </>
  )
}

/** On a canvas: the group brings the gutter; the first drops its rule and sits 16px under the title bar. */
export const Default: Story = { render: () => <PaneFrame title='Profile'><Profile /></PaneFrame> }

/** Variants: an aside, a full-bleed rule, a list inside that reaches the pane edge by itself. */
export const Variants: Story = {
  render: () => (
    <PaneFrame title='Support'>
      <>
        <SettingsGroup title='Phone numbers' aside={<Button size='xs' variant='ghost'>Add number</Button>}>
          <DataGrid<{ number: string }>
            variant='section'
            rows={[{ number: '+43 1 234 5678' }, { number: '+49 30 987 6543' }]}
            getId={(p) => p.number}
            bar={{ noun: 'numbers' }}
            name={{ label: 'Number', render: (p) => <span className='font-mono text-label'>{p.number}</span> }}
            columns={[]}
          />
        </SettingsGroup>
        <SettingsGroup bleed title='Working days' description='Late tickets are counted on these days only.'>
          <FieldGrid columns={2}><Field label='From'><Input defaultValue='09:00' /></Field><Field label='To'><Input defaultValue='17:00' /></Field></FieldGrid>
        </SettingsGroup>
      </>
    </PaneFrame>
  ),
}

/** States: the member view. */
export const States: Story = {
  render: () => <PaneFrame title='Profile'><SettingsReadOnly active note='Only administrators can change this.'><Profile /></SettingsReadOnly></PaneFrame>,
}

/** InContext: a Form section with its groups. */
export const InContext: Story = Default
