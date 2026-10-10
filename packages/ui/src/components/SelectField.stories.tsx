import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { withStage } from '../stories/Stage.tsx'
import { SelectField } from './SelectField.tsx'

const meta = {
  title: 'Base/SelectField',
  decorators: [withStage],
  component: SelectField,
} satisfies Meta<typeof SelectField>

export default meta
type Story = StoryObj<typeof meta>

function Demo() {
  const [when, setWhen] = useState('time')
  const [action, setAction] = useState('')
  return (
    <div className='grid max-w-xl grid-cols-2 gap-4'>
      <SelectField
        aria-label='When'
        value={when}
        onValueChange={setWhen}
        options={[
          { value: 'time', label: 'At a time (cron)' },
          { value: 'event', label: 'When a Box event arrives' },
        ]}
      />
      <SelectField
        aria-label='Action'
        value={action}
        onValueChange={setAction}
        placeholder='Pick an action…'
        options={[
          { label: 'Pulls', options: [{ value: 'github-pull', label: 'GitHub' }, { value: 'x-pull', label: 'X' }] },
          { label: 'Warehouse', options: [{ value: 'backup', label: 'Warehouse backup' }, { value: 'derive', label: 'Re-derive signals', disabled: true }] },
        ]}
      />
    </div>
  )
}

export const Default: Story = {
  args: { value: 'time', onValueChange: () => undefined, options: [] },
  render: () => <Demo />,
}
