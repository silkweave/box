// The aggregate row under a data grid. A grid that shows rows and no totals makes "what is this
// worth" a question you answer by exporting.
//
// Four rules it exists to hold:
//
//   • NOTHING IS AGGREGATED BY DEFAULT. Every column starts at `none` and the footer is an empty
//     strip carrying only the row count - a footer full of numbers nobody asked for is the failure
//     mode. The choice is made from the cell itself (click it, pick a method), so it lives where the
//     number will be instead of adding a fifth popover to the board bar.
//   • IT AGGREGATES WHAT YOU ARE LOOKING AT - the rows that survived the filters and the search, not
//     the table. The footer answers "what am I looking at", and a total that ignored the filter would
//     answer a question nobody asked.
//   • ONE GRAND TOTAL, even when the list is grouped. Subtotals per group would put a line of
//     numbers on every group header, which on a board grouped by owner is twenty of them; the group
//     header already carries its count.
//   • LIST LAYOUT ONLY. A kanban has no columns to total.
//
// IT IS ALWAYS ON SCREEN, sticky to the bottom of the grid's scrollport, the mirror of `GridHeader`
// at the top. That needs the grid itself to be the thing that scrolls, not the page: the consumer
// gives it a `min-h-0 flex-1 overflow-auto` box inside a full-height column, and the `min-width` box
// holding the columns sits inside that. Get the frame wrong and the footer silently stops sticking -
// an `overflow-x` box is a scrollport on BOTH axes, so a footer inside one with no height constraint
// pins to the bottom of content it is already at the bottom of. It scrolls sideways with the
// columns, which is the reason it lives inside the scrollport rather than under it.

import { useState, type ReactNode } from 'react'
import { Sigma } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { Count, Money, Percent } from '../components/Figures.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../components/Popover.tsx'
import {
  AGGREGATE_LABEL,
  AGGREGATE_METHODS,
  aggregate,
  aggregateDecimals,
  frozenCellStyle,
  type AggregateMethod,
  type AggregateSource,
  type AggregateStore,
  type GridColumn,
} from './columns.ts'

export function GridFooter({
  columns,
  template,
  label,
  sources,
  store,
  freezeFirst = false,
}: {
  columns: GridColumn[]
  template: string
  /** Keep the label cell in view while the grid scrolls sideways, as `GridHeader` does. */
  freezeFirst?: boolean
  /**
   * What sits in the identity column's footer cell - in this Box, "17 / 53 accounts" (see
   * `apps/web/src/lib/rowCount.ts`). It is a NODE the app hands over, not a count and a noun this
   * component turns into English: which rows the number describes, what they are called and how
   * they pluralise are all the app's vocabulary.
   */
  label?: ReactNode
  /** Column key → the visible rows' numbers. A column missing from this is not aggregatable and
   *  renders empty; the identity column is never read, because the label sits there. */
  sources: Record<string, AggregateSource>
  store: AggregateStore
}) {
  return (
    <div
      // Opaque, not tinted: it sits ON TOP of rows that scroll under it, so any transparency shows
      // them through the totals.
      className='group/gridfoot sticky bottom-0 z-10 mt-auto grid items-center gap-2 border-t border-border bg-surface px-2 py-1.5 text-body-sm'
      style={{ gridTemplateColumns: template }}>
      {columns.map((c, i) => {
        const source = i === 0 ? undefined : sources[c.key]
        return (
          <div key={c.key} className='min-w-0' style={freezeFirst && i === 0 ? { ...frozenCellStyle('var(--surface)'), zIndex: 2 } : undefined}>
            {i === 0 ? (
              <span className='truncate text-label tabular-nums text-muted-foreground'>{label}</span>
            ) : source ? (
              <AggregateCell
                column={c}
                source={source}
                method={store.methods[c.key] ?? 'none'}
                onPick={(m) => store.setMethod(c.key, m)}
              />
            ) : null}
          </div>
        )
      })}
      {/* The action cluster's slot - nothing to total there. */}
      <span />
    </div>
  )
}

/**
 * One footer cell: the figure, and the picker that chose it.
 *
 * Always right-aligned, whatever the column's cells do - a footer figure is read against the column
 * of figures above it, and every unit this draws is a magnitude. When nothing is picked the cell is
 * blank apart from a Σ that surfaces on hover or focus, which is how a spreadsheet has always
 * offered this and is quiet enough to leave on every qualifying column.
 */
function AggregateCell({
  column,
  source,
  method,
  onPick,
}: {
  column: GridColumn
  source: AggregateSource
  method: AggregateMethod
  onPick: (method: AggregateMethod) => void
}) {
  const [open, setOpen] = useState(false)
  const value = aggregate(source.values, method)
  const decimals = aggregateDecimals(source.unit, method)
  const set = method !== 'none'

  return (
    // Controlled, so picking a method closes the menu: unlike the columns popover (where you set
    // several things in a row), this is one choice and staying open would hide the number it changed.
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={
          set
            ? `${AGGREGATE_LABEL[method]} of ${column.label}: change or clear`
            : `Total the ${column.label} column`
        }
        title={set ? `${AGGREGATE_LABEL[method]} of ${column.label}` : `Total the ${column.label} column`}
        className={cn(
          'flex w-full items-center justify-end gap-1 rounded px-1 py-0.5 transition-colors hover:bg-accent-tint',
          set ? 'font-medium text-text' : 'text-fg-4',
        )}>
        {set ? (
          value == null ? (
            // The method is set and the rows have nothing to say - every one of them is blank on this
            // axis, or the board is empty. The `·` is the grid's established "readable as empty".
            <span className='text-fg-4'>·</span>
          ) : source.unit === 'currency' ? (
            <Money value={value} {...source.currency} />
          ) : source.unit === 'percent' ? (
            <Percent value={value} decimals={decimals} />
          ) : (
            <Count value={value} decimals={decimals} />
          )
        ) : (
          <Sigma className='size-3.5 opacity-0 transition-opacity group-hover/gridfoot:opacity-100 group-focus-within/gridfoot:opacity-100' />
        )}
      </PopoverTrigger>
      <PopoverContent align='end' side='top' className='w-44 gap-0.5 p-1'>
        <span className='px-2 py-1 text-label text-muted-foreground'>{column.label}</span>
        {AGGREGATE_METHODS.map((m) => (
          <button
            key={m}
            type='button'
            onClick={() => {
              onPick(m)
              setOpen(false)
            }}
            aria-pressed={m === method}
            className={cn(
              'rounded px-2 py-1 text-left text-body-sm transition-colors hover:bg-accent-tint',
              m === method ? 'text-accent' : 'text-text',
            )}>
            {AGGREGATE_LABEL[m]}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
