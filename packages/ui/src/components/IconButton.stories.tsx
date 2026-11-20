import type { Meta, StoryObj } from '@storybook/react-vite'
import { Eye, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { withStage } from '../stories/Stage.tsx'
import { Field, FieldGrid } from './Field.tsx'
import { IconButton } from './IconButton.tsx'
import { Input } from './Input.tsx'

const meta = {
  title: 'Base/IconButton',
  decorators: [withStage],
  component: IconButton,
} satisfies Meta<typeof IconButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { label: 'Edit kind', icon: <Pencil /> },
}

export const Sizes: Story = {
  args: { label: 'Refresh', icon: <RefreshCw /> },
  render: () => (
    <div className='flex items-center gap-3'>
      <IconButton label='Refresh (sm, rows)' icon={<RefreshCw />} />
      <IconButton size='md' label='Refresh (md)' icon={<RefreshCw />} />
    </div>
  ),
}

export const Tones: Story = {
  args: { label: 'Remove', icon: <Trash2 /> },
  render: () => (
    <div className='flex items-center gap-3'>
      <IconButton label='Edit' icon={<Pencil />} />
      <IconButton tone='danger' label='Remove member' icon={<Trash2 />} />
    </div>
  ),
}

export const States: Story = {
  args: { label: 'Show', icon: <Eye /> },
  render: () => (
    <div className='flex items-center gap-3'>
      <IconButton label='Edit' icon={<Pencil />} />
      <IconButton label='Edit (disabled)' icon={<Pencil />} disabled />
      <IconButton label='Show token' icon={<Eye />} aria-pressed />
    </div>
  ),
}

export const InContext: Story = {
  args: { label: 'Edit', icon: <Pencil /> },
  render: () => (
    <div className='max-w-lg'>
      <FieldGrid columns={1}>
        <Field label='Owner'>
          <div className='flex items-center gap-2'>
            <Input readOnly value='Katherine Johnson' />
            <IconButton size='md' label='Change owner' icon={<Pencil />} />
          </div>
        </Field>
      </FieldGrid>
      <ul className='mt-6 divide-y divide-border-light border-y border-border-light'>
        {['Goal', 'Bet', 'Experiment'].map((kind) => (
          <li key={kind} className='flex items-center justify-between py-2 text-body-sm text-text'>
            {kind}
            <IconButton label={`Rename ${kind}`} icon={<Pencil />} />
          </li>
        ))}
      </ul>
    </div>
  ),
}
