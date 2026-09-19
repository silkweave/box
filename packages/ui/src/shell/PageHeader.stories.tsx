import type { Meta, StoryObj } from '@storybook/react-vite'
import { withStage } from '../stories/Stage.tsx'
import { Button } from '../components/Button.tsx'
import { PageHeader } from './PageHeader.tsx'

const meta = {
  title: 'Layout/PageHeader',
  decorators: [withStage],
  component: PageHeader,
} satisfies Meta<typeof PageHeader>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { title: 'Signals' } }

export const WithDescription: Story = {
  args: { title: 'Signals', description: '90 signals across all channels.' },
}

export const WithActions: Story = {
  args: {
    title: 'Initiatives',
    description: 'Everything the team has agreed to do, and why.',
    actions: (
      <>
        <Button variant='ghost' size='sm'>Import</Button>
        <Button size='sm'>New initiative</Button>
      </>
    ),
  },
}
