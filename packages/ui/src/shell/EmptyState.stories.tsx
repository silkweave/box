import type { Meta, StoryObj } from '@storybook/react-vite'
import { CheckCheck, Inbox, Plus } from 'lucide-react'
import { Button } from '../components/Button.tsx'
import { EmptyState } from './EmptyState.tsx'

const meta = {
  title: 'Layout/EmptyState',
  component: EmptyState,
} satisfies Meta<typeof EmptyState>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The layout is the library's; the sentences are the app's. Which of several sentences a screen
 * shows - "you cleared it" vs "nothing has arrived yet" - is a rule about that app's data, so it is
 * decided by the caller and handed over as a finished string.
 */
export const Default: Story = {
  args: {
    icon: <CheckCheck className='size-7' />,
    title: 'Inbox Zero',
    description: "You've handled 12 replies. Nothing left to follow up on - nicely done.",
  },
}

/** With the one thing to do about it. */
export const WithAction: Story = {
  args: {
    icon: <Inbox className='size-7' />,
    title: 'No sources yet',
    description: 'Connect a source and its rows will start showing up here.',
    action: (
      <Button>
        <Plus />
        Add a source
      </Button>
    ),
  },
}

/** Without a glyph - the headline moves up to the top of the box. */
export const TitleOnly: Story = {
  args: { title: 'Nothing here' },
}
