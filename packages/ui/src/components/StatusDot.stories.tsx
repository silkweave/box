import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { Field, FieldGrid } from './Field.tsx'
import { StatusDot } from './StatusDot.tsx'

const meta = {
  title: 'Base/StatusDot',
  decorators: [withStage],
  component: StatusDot,
} satisfies Meta<typeof StatusDot>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { tone: 'success', label: 'Connected' },
}

const TONES = [
  ['success', 'Connected'],
  ['warning', 'Needs attention'],
  ['danger', 'Failing'],
  ['neutral', 'Paused'],
  ['accent', 'Active'],
] as const

export const Tones: Story = {
  args: { tone: 'success' },
  render: () => (
    <ul className='grid gap-2 text-body-sm text-text'>
      {TONES.map(([tone, text]) => (
        <li key={tone} className='flex items-center gap-2'>
          <StatusDot tone={tone} />
          {text}
        </li>
      ))}
    </ul>
  ),
}

export const States: Story = {
  args: { tone: 'accent' },
  render: () => (
    <ul className='grid gap-2 text-body-sm text-text'>
      <li className='flex items-center gap-2'><StatusDot tone='accent' pulse /> Running</li>
      <li className='flex items-center gap-2'><StatusDot tone='warning' pulse /> Connecting</li>
      <li className='flex items-center gap-2'>Label only, no visible text: <StatusDot tone='danger' label='Failing' /></li>
    </ul>
  ),
}

export const InContext: Story = {
  args: { tone: 'success' },
  render: () => (
    <div className='max-w-2xl'>
      <FieldGrid columns={3}>
        {[
          ['Linear', 'success', 'Connected'],
          ['Stripe', 'warning', 'Sign-in expired'],
          ['GitHub', 'neutral', 'Paused'],
        ].map(([name, tone, text]) => (
          <Field key={name} label={name}>
            <span className='flex items-center gap-2 text-body-sm text-text'>
              <StatusDot tone={tone as 'success'} />
              {text}
            </span>
          </Field>
        ))}
      </FieldGrid>
    </div>
  ),
}
