import type { Meta, StoryObj } from '@storybook/react-vite'
import { buildGrid, frozenColumnStyle, orderColumns, useColumnWidths } from './columns.ts'
import { CATALOG, ROWS, SELECTED, SPEC } from './fixtures.ts'
import { GridHeader } from './GridHeader.tsx'

const meta = {
  title: 'Grid/GridHeader',
  component: GridHeader,
} satisfies Meta<typeof GridHeader>

export default meta
type Story = StoryObj<typeof meta>

function Frame({ resizable, freeze = 0 }: { resizable: boolean; freeze?: number }) {
  // The storage key is the CALLER's, in full - the library does not own one. Storybook gets its own
  // namespace so dragging a divider here never touches an app's saved widths.
  const { widths, setWidth } = useColumnWidths('storybook.grid')
  const grid = buildGrid(SPEC, orderColumns(CATALOG, SELECTED), widths)

  return (
    // The frame both rows owe their stickiness to: a `min-h-0 flex-1 overflow-auto` scrollport
    // wrapping a `min-width` box. Get it wrong and they silently stop sticking.
    <div className='flex h-[24rem] flex-col' style={freeze ? { maxWidth: '28rem' } : undefined}>
      <div className='min-h-0 flex-1 overflow-auto'>
        <div style={{ minWidth: grid.minWidth }} className='flex min-h-full flex-col'>
          <GridHeader columns={grid.columns} template={grid.template} onResize={resizable ? setWidth : undefined} freeze={freeze} />
          {ROWS.concat(ROWS, ROWS, ROWS).map((r, i) => (
            <div
              key={i}
              className='grid items-center gap-2 border-b border-border px-2 py-2 text-body-sm text-text'
              style={{ gridTemplateColumns: grid.template }}>
              <span className='truncate' style={frozenColumnStyle(grid.columns, 0, freeze)}>{r.name}</span>
              <span className='truncate text-muted-foreground' style={frozenColumnStyle(grid.columns, 1, freeze)}>{r.owner}</span>
              <span className='text-right tabular-nums'>{r.revenue ?? '·'}</span>
              <span className='text-right tabular-nums'>{r.probability == null ? '·' : `${r.probability * 100}%`}</span>
              <span />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Labels are always LEFT-aligned, even over right-aligned figures: the eye scans a header row
 * horizontally, and a label that starts somewhere else each time makes it work for that.
 *
 * Every column resizes by dragging the divider on its right edge; double-click puts one back. The
 * handles surface on hover. Widths are a per-browser user setting, never part of a shared preset -
 * so scroll to row 40, drag a divider, and reload: the scroll is gone and the width is not.
 */
export const Default: Story = {
  args: { columns: [], template: '' },
  render: () => <Frame resizable />,
}

/** Omit `onResize` and the header is fixed-width, with no handles at all. */
export const Fixed: Story = {
  args: { columns: [], template: '' },
  render: () => <Frame resizable={false} />,
}

/**
 * `freeze` keeps the first N columns in view while the grid scrolls sideways. The header, the
 * footer and every row cell take the same count through `frozenColumnStyle`, so they stick at the
 * same offsets; only the last frozen column draws the hairline edge. Scroll right: Name and Owner
 * stay.
 */
export const Frozen: Story = {
  args: { columns: [], template: '' },
  render: () => <Frame resizable freeze={2} />,
}
