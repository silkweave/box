import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { Badge } from './Badge.tsx'

const meta = {
  title: 'Base/Badge',
  decorators: [withStage],
  component: Badge,
  argTypes: {
    variant: { control: 'select', options: ['neutral', 'accent', 'success', 'warning', 'danger', 'info', 'silk'] },
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { children: 'draft' } }

/**
 * Color is information, never decoration: pick the variant that matches the real state. `silk` is
 * the reserved brand gradient - at most once per surface.
 */
export const Variants: Story = {
  args: { children: 'badge' },
  render: () => (
    <div className='flex flex-wrap items-center gap-2'>
      <Badge variant='neutral'>neutral</Badge>
      <Badge variant='accent'>accent</Badge>
      <Badge variant='success'>published</Badge>
      <Badge variant='warning'>needs review</Badge>
      <Badge variant='danger'>failed</Badge>
      <Badge variant='info'>queued</Badge>
      <Badge variant='silk'>silk</Badge>
    </div>
  ),
}

/** The dot restates the state without relying on color alone. */
export const WithDot: Story = {
  args: { children: 'running', variant: 'info', dot: true },
}

/** Monospace for identifiers - a slug, a run id, a commit. */
export const Mono: Story = { args: { children: 'run_8f21ac', mono: true } }
