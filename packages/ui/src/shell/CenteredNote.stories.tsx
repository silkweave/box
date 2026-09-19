import type { Meta, StoryObj } from '@storybook/react-vite'
import { CenteredNote } from './CenteredNote.tsx'

const meta = {
  title: 'Layout/CenteredNote',
  component: CenteredNote,
} satisfies Meta<typeof CenteredNote>

export default meta
type Story = StoryObj<typeof meta>

/** The empty, loading or error state of a WHOLE view - it claims the full height on purpose. */
export const Default: Story = { args: { children: 'No signals yet. Add a data source in Settings.' } }

export const Error: Story = {
  args: { children: 'Could not reach the warehouse. Check that the server is running.' },
}
