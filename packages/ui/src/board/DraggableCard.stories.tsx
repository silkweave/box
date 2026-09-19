import type { Meta, StoryObj } from '@storybook/react-vite'
import { DndContext } from '@dnd-kit/core'
import { Stage } from '../stories/Stage.tsx'
import { DraggableCard } from './DraggableCard.tsx'

const meta = {
  title: 'Board/DraggableCard',
  component: DraggableCard,
  decorators: [
    (Story) => (
      // Every draggable needs a context to register into; a board supplies its own.
      <DndContext>
        <Stage>
          <div className='flex max-w-sm flex-col gap-3'>
            <Story />
          </div>
        </Stage>
      </DndContext>
    ),
  ],
} satisfies Meta<typeof DraggableCard>

export default meta
type Story = StoryObj<typeof meta>

const Body = (
  <>
    <span className='block truncate font-medium text-text'>Northwind Traders</span>
    <p className='mt-0.5 text-label text-muted-foreground'>Renewal call, Thursday</p>
  </>
)

/**
 * `handle='grip'` (the default) puts the drag on a handle that fades in on hover, so the body stays
 * clickable and its text stays selectable. That is what a wide card wants: it carries links, an
 * owner avatar and a button or two, and every one of them would otherwise have to swallow its own
 * pointer to survive.
 *
 * Hover the card to see the grip.
 */
export const Grip: Story = {
  args: { id: '1', label: 'Northwind Traders', children: Body },
}

/**
 * `handle='surface'` makes the whole card the drag target - right for a dense card in a grid of
 * cells, where a grip would eat a fifth of the width. The press that was NOT a drag comes back as
 * `onClick`, measured by distance (`CLICK_SLOP`) rather than taken from dnd-kit: a drag that ends on
 * the card it started on still fires a click, and a card whose only affordance is "open me" has to
 * tell the two apart itself.
 */
export const Surface: Story = {
  args: {
    id: '2',
    label: 'Contoso',
    handle: 'surface',
    title: 'Contoso\n\nClick to open',
    onClick: () => alert('opened'),
    children: Body,
  },
}

/**
 * `draggable={false}` is the honest rendering of a board whose columns are DERIVED - nothing is
 * droppable, so nothing offers a grip. The card keeps its frame and its click.
 */
export const NotDraggable: Story = {
  args: { id: '3', label: 'Fabrikam', draggable: false, children: Body },
}

/**
 * The copy inside a `<DragOverlay>`: same frame, same geometry, no listeners of its own. It takes
 * `overlay:<id>` internally, because two live draggables sharing one id makes dnd-kit resolve the
 * wrong node mid-drag - a lesson both of the frames this component replaced had learned separately.
 *
 * The grip is still drawn (inert): without it the card in the air would be 18px narrower than the
 * hole it came out of.
 */
export const Overlay: Story = {
  args: { id: '4', label: 'Tailspin Toys', overlay: true, children: Body },
}
