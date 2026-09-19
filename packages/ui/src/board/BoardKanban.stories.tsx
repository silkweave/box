import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Money } from '../components/Figures.tsx'
import { UserChip } from '../users/UserChip.tsx'
import { Stage } from '../stories/Stage.tsx'
import { BoardKanban } from './BoardKanban.tsx'
import { CARDS, COLUMNS, type Card } from './fixtures.ts'

const meta = {
  title: 'Board/BoardKanban',
  component: BoardKanban,
  decorators: [
    (Story) => (
      <Stage inset='sm'>
        <Story />
      </Stage>
    ),
  ],
} satisfies Meta<typeof BoardKanban<Card>>

export default meta
type Story = StoryObj<typeof meta>

function CardBody({ card }: { card: Card }) {
  return (
    <>
      <div className='flex items-start gap-1'>
        <span className='min-w-0 flex-1 truncate font-medium text-text'>{card.title}</span>
        <UserChip userId={card.owner} />
      </div>
      <Money value={card.value} className='mt-1.5 block text-label font-medium' />
    </>
  )
}

/**
 * Drag a card to another column. The board BUCKETS and nothing else - the rows arrive already
 * filtered and sorted, and there is deliberately no manual ordering within a column, because a
 * position there would be a stored field nobody maintains.
 *
 * `onDrop` is where the app decides what a move MEANS, and whether to allow it at all: a board that
 * refuses one can show the same dialog its list shows rather than writing and apologising after.
 * Here it just moves the card.
 */
export const Default: Story = {
  args: { items: [], columns: [], columnOf: () => '', idOf: () => '', cardLabel: () => '', renderCard: () => null },
  render: () => {
    const [cards, setCards] = useState(CARDS)
    return (
      <BoardKanban
        items={cards}
        columns={COLUMNS}
        columnOf={(c) => c.column}
        idOf={(c) => c.id}
        cardLabel={(c) => c.title}
        onDrop={(card, column) => setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, column } : c)))}
        // The right-hand end of a column header. A total, a warning count - whatever the app can say
        // about a whole column in the width of a badge.
        renderColumnBadge={(_column, held) => {
          const total = held.reduce((sum, c) => sum + (c.value ?? 0), 0)
          return total > 0 ? <Money value={total} /> : null
        }}
        renderCard={(c) => <CardBody card={c} />}
      />
    )
  },
}

/**
 * OMIT `onDrop` and the board is read-only: no grips on the cards, nothing droppable, and an empty
 * column says so without inviting a drop. That is the honest rendering of a board whose column is
 * DERIVED from something else - dropping a card would have to fire a different write per row, and a
 * lifecycle like that routes through explicit named actions instead.
 */
export const Derived: Story = {
  args: { items: [], columns: [], columnOf: () => '', idOf: () => '', cardLabel: () => '', renderCard: () => null },
  render: () => (
    <BoardKanban
      items={CARDS}
      columns={COLUMNS}
      columnOf={(c) => c.column}
      idOf={(c) => c.id}
      cardLabel={(c) => c.title}
      renderCard={(c) => <CardBody card={c} />}
    />
  ),
}
