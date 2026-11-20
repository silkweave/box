import type { Meta, StoryObj } from '@storybook/react-vite'
import { Hash } from 'lucide-react'
import { Avatar } from '../components/Avatar.tsx'
import { DataGrid } from './DataGrid.tsx'
import { NameCell, type NameCellBadge } from './NameCell.tsx'

/**
 * `NameCell` is the anatomy of a row's name: mark, name, compact badge, second line. The story puts
 * every combination in one grid, so their line boxes can be compared at the same width and scale:
 * each primary line is 20px, each second line 16px, and every row 48px.
 */
const meta = {
  title: 'Grid/Name cell',
  component: NameCell,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof NameCell>
export default meta
type Story = StoryObj<typeof meta>

type Kind = 'person' | 'service' | 'channel' | 'plain'
type Rec = { id: string; kind: Kind; name: string; note?: string; badge?: NameCellBadge; mono?: boolean }
const ROWS: Rec[] = [
  { id: 'u1', kind: 'person', name: 'Toby Strebitzer', note: 'toby@example.com', badge: { label: 'You', variant: 'accent' } },
  { id: 'u2', kind: 'person', name: 'Mira Okafor', note: 'mira@example.com' },
  { id: 'u3', kind: 'person', name: 'Dan Ruli', note: 'Invited 2 days ago', badge: { label: 'Invited', variant: 'warning' } },
  { id: 's1', kind: 'service', name: 'Stripe', note: 'https://mcp.stripe.com', badge: { label: 'Failing', variant: 'danger' } },
  { id: 's2', kind: 'service', name: 'Linear', note: 'https://mcp.linear.app/sse' },
  { id: 'c1', kind: 'channel', name: 'revenue', mono: true, note: '12 signals' },
  { id: 'p1', kind: 'plain', name: 'A name long enough to truncate inside a narrow column without growing the row', badge: { label: 'Archived' } },
  { id: 'p2', kind: 'plain', name: 'Name only' },
]

const person = (id: string, name: string) => {
  const [first_name = '', last_name = ''] = name.split(' ')
  return { id, first_name, last_name, nickname: first_name.toLowerCase(), image: null }
}
const mark = (r: Rec) =>
  r.kind === 'person' ? <Avatar user={person(r.id, r.name)} size='sm' />
  : r.kind === 'service' ? <Avatar label={r.name} size='sm' />
  : r.kind === 'channel' ? <Hash className='size-4 text-muted-foreground' aria-hidden />
  : undefined

/** Siblings of every kind in one grid: same line boxes, same insets, badge or not. */
export const Siblings: Story = {
  args: { primary: '' },
  render: () => (
    <div className='h-[480px] max-w-3xl rounded-lg border border-border'>
      <DataGrid<Rec>
        rows={ROWS}
        getId={(r) => r.id}
        bar={{ noun: 'records' }}
        searchText={(r) => `${r.name} ${r.note ?? ''}`}
        rowLabel={(r) => r.name}
        onOpen={() => undefined}
        name={{ label: 'Name', render: (r) => <NameCell primary={r.name} secondary={r.note} mark={mark(r)} badge={r.badge} mono={r.mono} /> }}
        columns={[{ key: 'kind', label: 'Kind', width: 96, render: (r) => <span className='text-body-sm text-muted-foreground'>{r.kind}</span> }]}
      />
    </div>
  ),
}

/** One cell on its own, for the controls. */
export const Single: Story = {
  args: { primary: 'Mira Okafor', secondary: 'mira@example.com', badge: { label: 'You', variant: 'accent' } },
  render: (args) => (
    <div className='w-72'>
      <NameCell {...args} mark={<Avatar user={person('u2', 'Mira Okafor')} size='sm' />} />
    </div>
  ),
}
