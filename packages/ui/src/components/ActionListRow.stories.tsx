import type { Meta, StoryObj } from '@storybook/react-vite'
import { Check, ExternalLink, MessageSquare, RotateCcw } from 'lucide-react'
import { withStage } from '../stories/Stage.tsx'
import { Button } from './Button.tsx'
import { ActionListRow } from './ActionListRow.tsx'

const meta = {
  title: 'Base/ActionListRow',
  decorators: [withStage],
  component: ActionListRow,
} satisfies Meta<typeof ActionListRow>

export default meta
type Story = StoryObj<typeof meta>

const KindMeta = () => (
  <>
    <span className='rounded bg-muted px-1.5 py-0.5 normal-case tracking-normal'>Comment</span>
    <span className='truncate'>r/selfhosted</span>
  </>
)

const Actions = ({ done }: { done?: boolean }) => (
  <>
    <a
      href='#'
      className='inline-flex items-center gap-1.5 text-label font-medium text-muted-foreground transition-colors hover:text-text'>
      <ExternalLink className='size-3.5' />
      Open thread
    </a>
    <span className='flex-1' />
    {done ? (
      <Button variant='ghost' size='sm'>
        <RotateCcw />
        Undo
      </Button>
    ) : (
      <Button variant='secondary' size='sm'>
        <Check />
        Mark done
      </Button>
    )}
  </>
)

/**
 * Every part is a slot. The row does not know what kind of thing it is showing, what the meta line
 * says, or what the buttons do - only where each piece goes and that a handled row is dimmed.
 */
export const Default: Story = {
  args: {
    icon: <MessageSquare className='size-4' />,
    meta: <KindMeta />,
    aside: 'Jun 21',
    title: (
      <>
        <span className='text-accent'>@ada</span>
        <span className='text-muted-foreground'> · Does this run behind tailscale?</span>
      </>
    ),
    body: <p className='line-clamp-3'>Been looking for exactly this. Does the whole stack sit behind the tailnet, or is there a public front door?</p>,
    actions: <Actions />,
    onTitleClick: () => {},
  },
}

/** Handled: dimmed, with whatever the app calls undoing it. */
export const Muted: Story = {
  args: { ...Default.args, muted: true, actions: <Actions done /> },
}

/** The floor - a headline and nothing else. */
export const TitleOnly: Story = {
  args: { title: 'A row with nothing else on it' },
}
