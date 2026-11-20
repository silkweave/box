import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { DndContext } from '@dnd-kit/core'
import { CircleDot, FileText, Flag, MoreHorizontal } from 'lucide-react'
import { Badge } from '../components/Badge.tsx'
import { GridHeader } from './GridHeader.tsx'
import type { GridColumn } from './columns.ts'
import { INDENT } from './geometry.ts'
import { Row, type RowProps } from './Row.tsx'

/**
 * The row is internal to `DataGrid` (not exported from `@silkweave/box-ui/list`): these stories
 * show its states one at a time, which the grid's own stories only reach through interaction. A host
 * never renders it; it hands the grid cell renderers and `rowActions`.
 */
const meta = {
  title: 'Grid/Row',
  component: Row,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Row>

export default meta
type Story = StoryObj<typeof meta>

// Storybook's args type wants the component's own props; every story renders its own frame.
const NO_ARGS = {} as never

/** The grid's template: the flexing name column, two fixed columns, the actions column. */
const TEMPLATE = 'minmax(240px,1fr) 120px 96px 40px'
const COLUMNS: GridColumn[] = [
  { key: 'name', label: 'Name', width: 240, flex: true },
  { key: 'status', label: 'Status', width: 120 },
  { key: 'due', label: 'Due', width: 96 },
]
const indentOf = (depth: number): number => depth * INDENT

const Actions = () => (
  <button type='button' aria-label='Row actions' className='rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent-tint hover:text-text'>
    <MoreHorizontal className='size-3.5' />
  </button>
)

const cells = (status: ReactNode, due: string) => [
  <span key='status' className='min-w-0'>{status}</span>,
  <span key='due' className='min-w-0 tabular-nums text-muted-foreground'>{due}</span>,
]

/** Everything a row needs, with nothing switched on: override what a story is about. */
const base = (id: string, name: string): RowProps => ({
  id,
  label: name,
  depth: 0,
  indentOf,
  template: TEMPLATE,
  nameCell: <span className='block truncate'>{name}</span>,
  cells: cells(<Badge size='sm'>Planned</Badge>, '2026-12-01'),
  actions: <Actions />,
  nests: false,
  childCount: 0,
  open: true,
  onToggle: () => undefined,
  handle: false,
  draggable: false,
  onPress: () => undefined,
  onMoveKey: () => false,
  drop: null,
  target: false,
  selected: false,
})

/** The grid frame the row assumes: a scrollport around a min-width box, inside dnd-kit's context. */
function Frame({ header = true, children }: { header?: boolean; children: ReactNode }) {
  return (
    <DndContext>
      <div className='p-6'>
        <div className='overflow-auto rounded-lg border border-border bg-surface'>
          <div style={{ minWidth: 520 }}>
            {header && <GridHeader columns={COLUMNS} template={TEMPLATE} />}
            {children}
          </div>
        </div>
      </div>
    </DndContext>
  )
}

function Flat() {
  const [selected, setSelected] = useState<string | null>(null)
  const rows = [
    ['launch', 'Launch the Help Center'],
    ['pricing', 'Pricing page refresh'],
    ['audit', 'Audit trail for team Boxes'],
  ] as const
  return (
    <Frame>
      {rows.map(([id, name]) => (
        <Row key={id} {...base(id, name)} selected={selected === id} onOpen={() => setSelected(id)} openLabel={`Open ${name}`} />
      ))}
    </Frame>
  )
}

/** Flat rows that open on click; the opened one is `selected`. Actions fade in on hover. */
export const Default: Story = { args: NO_ARGS, render: () => <Flat /> }

function NestedRows() {
  const [open, setOpen] = useState<Record<string, boolean>>({ q4: true })
  const isOpen = (id: string) => open[id] ?? false
  const toggle = (id: string) => () => setOpen((o) => ({ ...o, [id]: !isOpen(id) }))
  const mark = (icon: ReactNode) => <span className='flex text-muted-foreground [&_svg]:size-3.5'>{icon}</span>
  return (
    <Frame>
      <Row {...base('q4', 'Q4 goals')} nests handle mark={mark(<Flag />)} childCount={2} open={isOpen('q4')} onToggle={toggle('q4')} />
      {isOpen('q4') && (
        <>
          <Row {...base('docs', 'Write the setup guide')} nests handle mark={mark(<FileText />)} depth={1} childCount={1} open={isOpen('docs')} onToggle={toggle('docs')} />
          {isOpen('docs') && <Row {...base('shots', 'Screenshots for every step')} nests handle mark={mark(<CircleDot />)} depth={2} />}
          <Row {...base('rehearse', 'Rehearse the upgrade on a restored backup')} nests handle mark={mark(<CircleDot />)} depth={1} />
        </>
      )}
      <Row {...base('backlog', 'Backlog')} nests handle mark={mark(<Flag />)} childCount={4} open={false} onToggle={() => undefined} />
    </Frame>
  )
}

/**
 * A grid that nests draws the chevron slot on every row, so names truncate at one edge; one indent is
 * a mark and its gap, so a child's mark sits under its parent's name. Shift-click folds the subtree.
 */
export const Nested: Story = { args: NO_ARGS, render: () => <NestedRows /> }

/**
 * `draggable`: the mark gives way to a grip on hover or keyboard focus. Where the view forbids drag
 * (a sort, a filter) the mark stays and `dragHint` says why.
 */
export const Handle: Story = {
  args: NO_ARGS,
  render: () => (
    <Frame>
      <Row {...base('a', 'Draggable: hover the mark')} handle draggable mark={<CircleDot className='size-3.5 text-accent' />} />
      <Row {...base('b', 'Not draggable in this view: hover the mark for why')} handle dragHint='Drag needs the manual order, no grouping and no filters' mark={<CircleDot className='size-3.5 text-muted-foreground' />} />
      <Row {...base('c', 'No mark and no handle')} />
    </Frame>
  ),
}

/** The tints a row takes: selected, the drop target of a drag (the accent bar), and a long name truncating. */
export const States: Story = {
  args: NO_ARGS,
  render: () => (
    <Frame>
      <Row {...base('sel', 'Selected: the row whose detail is open')} selected />
      <Row {...base('tgt', 'Target: a dragged row would nest under this one')} target />
      <Row
        {...base('long', 'A very long name that keeps going well past the width of its column, so it truncates at the column edge')}
        cells={cells(<Badge size='sm' variant='warning'>Needs review</Badge>, '2026-11-30')}
      />
      <Row {...base('none', 'No actions, no click')} actions={undefined} />
    </Frame>
  ),
}
