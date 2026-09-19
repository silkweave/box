import type { Meta, StoryObj } from '@storybook/react-vite'
import { SplitPane, SplitPaneToggle } from './SplitPane.tsx'

const meta = {
  title: 'Layout/SplitPane',
  component: SplitPane,
} satisfies Meta<typeof SplitPane>

export default meta
type Story = StoryObj<typeof meta>

const Filler = ({ label }: { label: string }) => (
  <div className='h-full space-y-2 overflow-y-auto p-4'>
    <h3 className='text-heading-3 text-text'>{label}</h3>
    {Array.from({ length: 24 }, (_, i) => (
      <p key={i} className='text-body-sm text-muted-foreground'>
        {label} line {i + 1}
      </p>
    ))}
  </div>
)

/**
 * The right width persists per `storageKey`, so dragging the handle and reloading keeps it. The
 * handle IS the separator line - the right panel needs no border of its own.
 */
export const Default: Story = {
  args: {
    storageKey: 'storybook.splitPane.default',
    collapseLabel: 'notes',
    left: <Filler label='Document' />,
    right: (
      <div className='h-full p-4'>
        <div className='flex items-center justify-between'>
          <h3 className='text-heading-3 text-text'>Notes</h3>
          <SplitPaneToggle />
        </div>
        <p className='mt-2 text-body-sm text-muted-foreground'>
          The toggle collapses this pane; it reads its label from the pane's context.
        </p>
      </div>
    ),
  },
  render: (args) => (
    <div className='h-[32rem]'>
      <SplitPane {...args} />
    </div>
  ),
}
