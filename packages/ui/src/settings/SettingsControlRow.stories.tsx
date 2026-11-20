import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Badge } from '../components/Badge.tsx'
import { Button } from '../components/Button.tsx'
import { SelectField } from '../components/SelectField.tsx'
import { Switch } from '../components/Switch.tsx'
import { SettingsControlRow } from './SettingsControlRow.tsx'
import { SettingsGroup } from './SettingsGroup.tsx'
import { SettingsControlList } from './SettingsControlRow.tsx'
import { SettingsReadOnly } from './states.tsx'
import { ControlRowList, PaneFrame } from './storyFrame.tsx'

const meta = {
  title: 'Settings/SettingsControlRow',
  component: SettingsControlRow,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof SettingsControlRow>

export default meta
type Story = StoryObj

/** Access per area: a level control on the right, a reset in the "..." menu. */
export const Default: Story = { render: () => <PaneFrame title='Roles › Sales' className='h-auto'><ControlRowList /></PaneFrame> }

function Controls() {
  const [on, setOn] = useState(true)
  const [level, setLevel] = useState('read')
  return (
    <SettingsControlList label='Tools'>
      <SettingsControlRow title='Daily digest' description='Posts a summary to the team room at 08:00.'>
        <Switch checked={on} onCheckedChange={setOn} aria-label='Daily digest' />
      </SettingsControlRow>
      <SettingsControlRow title='stripe_api_read' description='Reads objects from the Stripe API.' meta={<Badge size='sm'>Inherited</Badge>}>
        <SelectField value={level} onValueChange={setLevel} aria-label='Level' options={[{ value: 'off', label: 'Off' }, { value: 'read', label: 'Ask first' }, { value: 'on', label: 'Allowed' }]} />
      </SettingsControlRow>
      <SettingsControlRow
        title='A tool with a long name that keeps going past the end of the row'
        description='And a description that is long enough to wrap onto a second line in a narrow pane.'
        actions={[
          { label: 'Copy tool name', reader: true, onSelect: () => void navigator.clipboard?.writeText('long_tool') },
          { label: 'Reset to default', onSelect: () => undefined },
          { label: 'Remove', danger: true, onSelect: () => undefined },
        ]}>
        <Switch checked={false} onCheckedChange={() => undefined} aria-label='Long tool' />
      </SettingsControlRow>
    </SettingsControlList>
  )
}

/** Variants: a switch, a select with an "inherited" meta, a long title with a menu. */
export const Variants: Story = { render: () => <PaneFrame title='Variants' className='h-auto'><Controls /></PaneFrame> }

/** States: the member view disables the controls; menus keep only items marked `reader` (Copy tool name). */
export const States: Story = {
  render: () => <PaneFrame title='States' className='h-auto'><><SettingsReadOnly active note='Only administrators can change tools.'><Controls /></SettingsReadOnly></></PaneFrame>,
}

/** InContext: control rows inside a group of a detail page. */
export const InContext: Story = {
  render: () => <PaneFrame title='Roles › Sales'><><SettingsGroup title='Access' description='Each area is on its own level.'><ControlRowList /></SettingsGroup></></PaneFrame>,
}

/** Member view: a write control is disabled, a `reader` control (it opens a page) stays live. */
export const ReaderControl: Story = {
  render: () => (
    <PaneFrame title='Help Center' className='h-auto'>
      <SettingsReadOnly active note='Only administrators can change the Help Center.'>
        <SettingsControlList label='Help Center pages'>
          <SettingsControlRow title='Publish on save' description='Publish the site after every saved change.'>
            <Switch checked={false} onCheckedChange={() => undefined} aria-label='Publish on save' />
          </SettingsControlRow>
          <SettingsControlRow title='Publish history' description='Last: Published, 2026-11-18 03:52' reader>
            <Button size='sm' variant='outline'>Open publish history</Button>
          </SettingsControlRow>
        </SettingsControlList>
      </SettingsReadOnly>
    </PaneFrame>
  ),
}
