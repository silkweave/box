import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from '../components/Button.tsx'
import { TopBar } from './TopBar.tsx'
import { TopBarActions, TopBarCenter, TopBarSlotProvider, useTopBarSlot } from './TopBarActions.tsx'

const meta = {
  title: 'Layout/TopBarActions',
  component: TopBarActions,
} satisfies Meta<typeof TopBarActions>

export default meta
type Story = StoryObj<typeof meta>

/**
 * A view's own primary actions live in the view's code but RENDER in the top bar: `TopBarActions`
 * portals them up. This is the same shape as the shell seam one level down - the dependent
 * registers into the dependency - and it is why a view never has to thread a callback to the shell.
 */
export const Default: Story = {
  args: { children: null },
  render: () => {
    const slot = useTopBarSlot()
    const center = useTopBarSlot()
    const [count, setCount] = useState(0)
    return (
      <div className='flex h-64 flex-col'>
        <TopBar
          content={{ crumbs: [{ label: 'Initiatives' }] }}
          slotRef={slot.ref}
          centerSlotRef={center.ref}
        />
        <TopBarSlotProvider node={slot.node} centerNode={center.node}>
          <div className='flex-1 p-6'>
            {/* Declared here, in the "view", but drawn up in the bar. */}
            <TopBarActions>
              <Button size='sm' onClick={() => setCount((c) => c + 1)}>
                New initiative
              </Button>
            </TopBarActions>
            <TopBarCenter>
              <span className='text-body-sm text-muted-foreground'>3 active</span>
            </TopBarCenter>
            <p className='text-body-sm text-muted-foreground'>
              The button above is declared in this pane and rendered in the bar. Clicks: {count}
            </p>
          </div>
        </TopBarSlotProvider>
      </div>
    )
  },
}
