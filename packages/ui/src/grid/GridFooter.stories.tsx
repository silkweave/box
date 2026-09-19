import type { Meta, StoryObj } from '@storybook/react-vite'
import { aggregateSources, buildGrid, orderColumns, useColumnAggregates, useColumnWidths } from './columns.ts'
import { CATALOG, ROWS, SELECTED, SPEC } from './fixtures.ts'
import { GridFooter } from './GridFooter.tsx'
import { GridHeader } from './GridHeader.tsx'

const meta = {
  title: 'Grid/GridFooter',
  component: GridFooter,
} satisfies Meta<typeof GridFooter>

export default meta
type Story = StoryObj<typeof meta>

function Frame({ label }: { label?: string }) {
  const { widths, setWidth } = useColumnWidths('storybook.grid')
  const aggregates = useColumnAggregates('storybook.grid', 'Pipeline')
  const columns = orderColumns(CATALOG, SELECTED)
  const grid = buildGrid(SPEC, columns, widths)
  const sources = aggregateSources(ROWS, SELECTED, CATALOG)

  return (
    <div className='flex h-[24rem] flex-col'>
      <div className='min-h-0 flex-1 overflow-auto'>
        <div style={{ minWidth: grid.minWidth }} className='flex min-h-full flex-col'>
          <GridHeader columns={grid.columns} template={grid.template} onResize={setWidth} />
          {ROWS.concat(ROWS, ROWS, ROWS).map((r, i) => (
            <div
              key={i}
              className='grid items-center gap-2 border-b border-border px-2 py-2 text-body-sm text-text'
              style={{ gridTemplateColumns: grid.template }}>
              <span className='truncate'>{r.name}</span>
              <span className='truncate text-muted-foreground'>{r.owner}</span>
              <span className='text-right tabular-nums'>{r.revenue ?? '·'}</span>
              <span className='text-right tabular-nums'>{r.probability == null ? '·' : `${r.probability * 100}%`}</span>
              <span />
            </div>
          ))}
          <GridFooter columns={grid.columns} template={grid.template} label={label} sources={sources} store={aggregates} />
        </div>
      </div>
    </div>
  )
}

/**
 * NOTHING IS AGGREGATED BY DEFAULT. Every column starts at `none` and the strip is empty apart from
 * the label - a footer full of numbers nobody asked for is this feature's failure mode. Hover an
 * aggregatable column's cell and a Σ appears; click it and pick a method.
 *
 * The choice is remembered per (preset × column) in the caller's storage key, so the same column can
 * be summed under one lens and averaged under another.
 *
 * Blanks are SKIPPED, not counted as zero - "Fabrikam" has no revenue, so the average of Revenue is
 * over three rows, not four.
 */
export const Default: Story = {
  args: { columns: [], template: '', sources: {}, store: { methods: {}, setMethod: () => {} } },
  render: () => <Frame label='4 / 12 accounts' />,
}

/**
 * `label` is a NODE the app hands over, not a count and a noun this component turns into English.
 * Which rows the number describes, what they are called and how they pluralise are the app's
 * vocabulary; see `apps/web/src/lib/rowCount.ts` for this Box's version. Omit it and the identity
 * cell is blank.
 */
export const NoLabel: Story = {
  args: { columns: [], template: '', sources: {}, store: { methods: {}, setMethod: () => {} } },
  render: () => <Frame />,
}
