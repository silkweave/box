import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ComponentProps } from 'react'
import { TrendingDown } from 'lucide-react'
import { withStage } from '../stories/Stage.tsx'
import { Button } from '../components/Button.tsx'
import { CollapsibleSection } from './CollapsibleSection.tsx'

const meta = {
  title: 'Layout/CollapsibleSection',
  decorators: [withStage],
  component: CollapsibleSection,
} satisfies Meta<typeof CollapsibleSection>

export default meta
type Story = StoryObj<typeof meta>

const Body = () => (
  <div className='space-y-2 text-body-sm text-muted-foreground'>
    {Array.from({ length: 4 }, (_, i) => (
      <p key={i}>The body is unmounted when the section is shut, not hidden - line {i + 1}.</p>
    ))}
  </div>
)

function Demo(props: Omit<ComponentProps<typeof CollapsibleSection>, 'open' | 'onOpenChange'>) {
  const [open, setOpen] = useState(true)
  return <CollapsibleSection {...props} open={open} onOpenChange={setOpen} />
}

/**
 * Controlled, always. Whether the fold survives a reload and under what key is the app's business -
 * pair it with `usePersistedState` from `@silkweave/box-ui/lib`.
 *
 * The whole heading is the hit target, not the caret.
 */
export const Default: Story = {
  args: { open: true, onOpenChange: () => {}, title: 'Details', children: <Body /> },
  render: (args) => <Demo {...args} />,
}

/**
 * The right-hand slot stays through the fold. On a collapsed hero the FIGURE is the section, so
 * hiding it would fold away the only thing worth seeing.
 */
export const AsideThatStays: Story = {
  args: {
    open: true,
    onOpenChange: () => {},
    title: 'Burndown',
    icon: <TrendingDown className='size-3.5 shrink-0 text-muted-foreground' />,
    className: 'rounded-lg border border-border bg-surface',
    headerClassName: 'px-3 py-2',
    bodyClassName: 'px-3 pb-3',
    aside: (
      <span className='flex items-baseline gap-2 text-label'>
        <span className='font-mono tabular-nums text-text'>36h</span>
        <span className='text-muted-foreground'>left of 120h</span>
      </span>
    ),
    children: <Body />,
  },
  render: (args) => <Demo {...args} />,
}

/**
 * The right-hand slot goes away with the body, because an action that operates on rows you cannot
 * see is a trap. The component renders `aside` in both states - passing `null` when shut is the
 * caller's judgement, which is the point: only the caller knows what the action does.
 */
export const AsideThatGoes: Story = {
  args: { open: true, onOpenChange: () => {}, title: 'Contacts', children: <Body /> },
  render: (args) => {
    const [open, setOpen] = useState(true)
    return (
      <CollapsibleSection
        {...args}
        open={open}
        onOpenChange={setOpen}
        heading={2}
        className='rounded-lg border border-border bg-surface p-4'
        headerClassName={open ? 'mb-3' : undefined}
        title={
          <>
            Contacts<span className='tabular-nums'> (4)</span>
          </>
        }
        aside={
          open ? (
            <Button variant='ghost' size='sm'>
              Add
            </Button>
          ) : null
        }
      />
    )
  },
}
