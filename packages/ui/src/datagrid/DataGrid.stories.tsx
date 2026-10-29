import { useState, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Bookmark, ChevronDown, MoreHorizontal, Plus } from 'lucide-react'
import { Button } from '../components/Button.tsx'
import type { BoardBarControl, BoardBarValue } from '../board/BoardViewBar.tsx'
import { DataGrid, type DataGridProps, type DataGridVariant } from './DataGrid.tsx'
import { applyMove, INITIATIVE_VIEW, INITIATIVES, initiativeGrid, ITEM_VIEW, ITEMS, itemGrid, PLAN_ROWS, type Initiative, type Item, type PlanRow } from './fixtures.tsx'

const meta = {
  title: 'Grid/DataGrid',
  component: DataGrid,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DataGrid>

export default meta
type Story = StoryObj<typeof meta>

// Storybook's args type wants the component's own props; every story renders its own frame.
const NO_ARGS = {} as never

/** Stand-in for the app's preset control (a server record, so the app draws it). */
function FakePresets() {
  return (
    <button
      type='button'
      className='inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-bg px-2 text-body-sm text-text hover:border-accent/40'>
      <Bookmark className='size-3.5 text-muted-foreground' />
      All initiatives
      <ChevronDown className='size-3.5 text-muted-foreground' />
    </button>
  )
}

const RowMenu = () => (
  <button type='button' aria-label='Row actions' className='rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent-tint hover:text-text'>
    <MoreHorizontal className='size-3.5' />
  </button>
)

/** A page frame: title row, then the grid claiming the rest of the height. */
function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className='flex h-screen flex-col'>
      <div className='flex items-center justify-between border-b border-border px-4 py-3'>
        <h1 className='text-heading-2 font-semibold text-text'>{title}</h1>
        <Button size='sm'>
          <Plus className='size-3.5' /> New
        </Button>
      </div>
      <div className='min-h-0 flex-1'>{children}</div>
    </div>
  )
}

function Initiatives({
  variant = 'full',
  start = INITIATIVE_VIEW,
  rows: initial = INITIATIVES,
  presets = true,
  controls,
}: {
  variant?: DataGridVariant
  start?: Partial<BoardBarValue>
  rows?: Initiative[]
  presets?: boolean
  controls?: Partial<Record<BoardBarControl, boolean>>
}) {
  const [view, setView] = useState<BoardBarValue>({ ...INITIATIVE_VIEW, ...start })
  const [rows, setRows] = useState(initial)
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <DataGrid<Initiative>
      {...initiativeGrid}
      variant={variant}
      rows={rows}
      view={view}
      onViewChange={(patch) => setView((v) => ({ ...v, ...patch }))}
      presets={presets ? <FakePresets /> : undefined}
      controls={controls}
      onMove={(m) => setRows((r) => applyMove(r, m, (row) => row))}
      selectedId={selected}
      onRowClick={(r) => setSelected(r.id)}
      rowActions={() => <RowMenu />}
    />
  )
}

function Items({
  start,
  extra,
  rows: initial = ITEMS,
  slow = false,
}: {
  start?: Partial<BoardBarValue>
  extra?: Partial<DataGridProps<Item>>
  rows?: Item[]
  /** Write moves like a server would: resolve after a delay, then update the rows. */
  slow?: boolean
}) {
  const [view, setView] = useState<BoardBarValue>({ ...ITEM_VIEW, ...start })
  const [rows, setRows] = useState(initial)
  const [selected, setSelected] = useState<string | null>(null)
  return (
    <DataGrid<Item>
      {...itemGrid}
      variant='card'
      title='Tasks'
      rows={rows}
      view={view}
      onViewChange={(patch) => setView((v) => ({ ...v, ...patch }))}
      onMove={(m) => {
        const apply = () => setRows((r) => applyMove(r, m, (row, parent) => ({ ...row, parent })))
        if (!slow) return apply()
        return new Promise<void>((resolve) => setTimeout(resolve, 900)).then(apply)
      }}
      selectedId={selected}
      onRowClick={(r) => setSelected(r.id)}
      rowActions={() => <RowMenu />}
      actions={
        <Button size='sm' variant='secondary'>
          <Plus className='size-3.5' /> Add
        </Button>
      }
      {...extra}
    />
  )
}

/** A detail page: header, a summary card, then the grid as one card among others. */
function DetailPage({ children }: { children: ReactNode }) {
  return (
    <div className='mx-auto flex max-w-5xl flex-col gap-4 p-6'>
      <div>
        <p className='text-label text-muted-foreground'>Initiatives / Literaton 2026/27</p>
        <h1 className='text-heading-1 font-semibold text-text'>Literaton 2026/27</h1>
      </div>
      <div className='grid grid-cols-3 gap-3'>
        {['Schools reached 24 / 20', 'Students activated 1,050 / 1,000', 'Teachers trained - / 40'].map((t) => (
          <div key={t} className='rounded-lg border border-border bg-surface p-3 text-body-sm text-text shadow-(--shadow-sm)'>
            {t}
          </div>
        ))}
      </div>
      {children}
    </div>
  )
}

// ---- Full ------------------------------------------------------------------------------------

/**
 * A whole page (Initiatives, All tasks, Deals). The bar is a strip across the top with the preset
 * control first; the grid scrolls under a sticky header; the footer carries the count and totals
 * (hover a numeric column's footer cell for Σ).
 *
 * Under the Manual sort, drag a row by its grip to reorder. Any other sort, a filter or a search
 * turns drag off, since the order on screen is no longer the stored one.
 */
export const Full: Story = {
  args: NO_ARGS,
  render: () => (
    <Page title='Initiatives'>
      <Initiatives />
    </Page>
  ),
}

/** Grouped by status: collapsible group headers with counts. Grouping turns drag off. */
export const FullGrouped: Story = {
  name: 'Full / grouped',
  args: NO_ARGS,
  render: () => (
    <Page title='Initiatives'>
      <Initiatives start={{ groupBy: 'status' }} />
    </Page>
  ),
}

/** The cards layout of the same page: the toggle in the bar switches it. */
export const FullCards: Story = {
  name: 'Full / cards layout',
  args: NO_ARGS,
  render: () => (
    <Page title='Initiatives'>
      <Initiatives start={{ layout: 'cards' }} />
    </Page>
  ),
}

/** Cards honour grouping like the list does. */
export const FullCardsGrouped: Story = {
  name: 'Full / cards, grouped',
  args: NO_ARGS,
  render: () => (
    <Page title='Initiatives'>
      <Initiatives start={{ layout: 'cards', groupBy: 'status' }} />
    </Page>
  ),
}

/** Nothing yet, and nothing matching once filtered. */
export const FullEmpty: Story = {
  name: 'Full / empty',
  args: NO_ARGS,
  render: () => (
    <Page title='Initiatives'>
      <Initiatives rows={[]} />
    </Page>
  ),
}

// ---- Card ------------------------------------------------------------------------------------

/**
 * A section of a detail page (an initiative's milestones and tasks). Same bar, drawn dense beside
 * the title; no presets or grouping by default; capped height; no totals footer.
 *
 * Rows nest. While dragging, the list already shows the result: the row itself sits in its new
 * slot at its new depth, and releasing changes nothing further. Up and down picks the slot; a push
 * right or left (about 28px per level) nests it under the row above or lifts it out. Ticks under
 * the row mark the depths its slot allows, and the row it would nest under is highlighted. Its
 * subtree moves with it. The chevron folds a parent.
 */
export const Card: Story = {
  args: NO_ARGS,
  render: () => (
    <DetailPage>
      <Items />
    </DetailPage>
  ),
}

/**
 * Nesting rules and a slow host. Milestones stay at the top level (`canNest`), nothing goes deeper
 * than two levels (`maxDepth`, counting what a dragged row carries), and moves are written with a
 * 900ms delay: the grid keeps the moved order on screen until the rows come back.
 */
export const CardRules: Story = {
  name: 'Card / rules and slow writes',
  args: NO_ARGS,
  render: () => (
    <DetailPage>
      <Items slow extra={{ maxDepth: 2, canNest: (row, parent) => row.kind !== 'milestone' || parent === null }} />
    </DetailPage>
  ),
}

/** A card with only search and columns: a host turns off what does not fit its section. */
export const CardMinimal: Story = {
  name: 'Card / minimal bar',
  args: NO_ARGS,
  render: () => (
    <DetailPage>
      <Items extra={{ controls: { layout: false, sort: false, filters: false } }} />
    </DetailPage>
  ),
}

/** A card with grouping and totals switched on, which `full` has by default. */
export const CardEverything: Story = {
  name: 'Card / all controls',
  args: NO_ARGS,
  render: () => (
    <DetailPage>
      <Items start={{ groupBy: 'status' }} extra={{ controls: { group: true }, totals: true }} />
    </DetailPage>
  ),
}

/** The cards layout inside a card. */
export const CardCards: Story = {
  name: 'Card / cards layout',
  args: NO_ARGS,
  render: () => (
    <DetailPage>
      <Items start={{ layout: 'cards' }} />
    </DetailPage>
  ),
}

/** The initiatives list as a card (e.g. a goal's contributing initiatives). */
export const CardFlat: Story = {
  name: 'Card / flat list',
  args: NO_ARGS,
  render: () => (
    <div className='mx-auto max-w-5xl p-6'>
      <Initiatives variant='card' presets={false} />
    </div>
  ),
}

// ---- Initiatives with their items (arrangeTop) ----------------------------------------------------

/** One page of initiatives with their items folded under them: the sort, the grouping and the
 *  filters arrange the initiatives; items keep their plan order and move in every view. */
function Plan({ start, slow = false }: { start?: Partial<BoardBarValue>; slow?: boolean }) {
  const [view, setView] = useState<BoardBarValue>({ ...INITIATIVE_VIEW, sort: 'impact', sortDir: 'desc', groupBy: 'status', ...start })
  const [rows, setRows] = useState(PLAN_ROWS)
  const [expanded, setExpanded] = useState<string[]>(['literaton', 'permata'])
  const initiativeOf = (row: PlanRow): string => (row.type === 'initiative' ? row.id : row.initiative)
  const asInitiative = (r: PlanRow): Initiative | null => (r.type === 'initiative' ? r : null)
  return (
    <DataGrid<PlanRow>
      variant='full'
      rows={rows}
      getId={(r) => r.id}
      parentId={(r) => (r.type === 'initiative' ? null : (r.parent ?? r.initiative))}
      rowLabel={(r) => r.title}
      arrangeTop
      freezeName
      expanded={expanded}
      onExpandedChange={setExpanded}
      canMove={(r) => r.type === 'item'}
      canNest={(r, parent) => r.type === 'item' && parent !== null}
      name={{ label: 'Initiative', render: (r) => <span className={r.type === 'initiative' ? 'truncate font-medium' : 'truncate'}>{r.title}</span> }}
      columns={initiativeGrid.columns.map((c) => ({ ...c, render: (r: PlanRow) => (asInitiative(r) ? c.render(asInitiative(r)!) : null), agg: undefined }))}
      view={view}
      onViewChange={(patch) => setView((v) => ({ ...v, ...patch }))}
      bar={{ ...initiativeGrid.bar, layouts: [...initiativeGrid.bar.layouts, { value: 'timeline', label: 'Timeline', icon: initiativeGrid.bar.layouts[0].icon }] }}
      layouts={{ timeline: (kept) => <p className='p-6 text-body-sm text-muted-foreground'>A host-drawn layout over {kept.length} rows.</p> }}
      searchText={(r) => r.title}
      filterValue={(r, axis) => (r.type === 'initiative' ? (initiativeGrid.filterValue?.(r, axis) ?? null) : null)}
      sortValue={(r, key) => (r.type === 'initiative' ? (initiativeGrid.sortValue?.(r, key) ?? null) : null)}
      groupOf={(r, key) => (r.type === 'initiative' ? initiativeGrid.groupOf!(r, key) : { key: initiativeOf(r), label: initiativeOf(r) })}
      onMove={(m) => {
        // The item joins the initiative its new parent belongs to.
        const apply = () =>
          setRows((cur) => {
            const parent = cur.find((r) => r.id === m.parentId)
            const initiative = parent ? initiativeOf(parent) : null
            return applyMove(cur, m, (row, p) => (row.type === 'item' && initiative ? { ...row, initiative, parent: p === initiative ? null : p } : row))
          })
        if (!slow) return apply()
        return new Promise<void>((resolve) => setTimeout(resolve, 900)).then(apply)
      }}
      countLabel={(shown, total) => `${shown} / ${total} rows`}
      storageKey='storybook.datagrid.plan'
    />
  )
}

/**
 * Initiatives with their items (`arrangeTop`): sorted by impact and grouped by status, the
 * initiatives stay put (they cannot move), and their items fold under them (controlled `expanded`).
 * Drag an item within its initiative or into another one, across groups; a sort, a group and a
 * filter never turn that off. The name column stays in view when the page scrolls sideways.
 */
export const FullArrangedTop: Story = {
  name: 'Full / initiatives with items',
  args: NO_ARGS,
  render: () => (
    <Page title='Initiatives'>
      <Plan />
    </Page>
  ),
}

/** The same with slow writes (900ms), to see moves queue across initiatives. */
export const FullArrangedTopSlow: Story = {
  name: 'Full / initiatives with items, slow writes',
  args: NO_ARGS,
  render: () => (
    <Page title='Initiatives'>
      <Plan slow />
    </Page>
  ),
}
