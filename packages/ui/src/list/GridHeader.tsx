// The header row of a data grid. Near-identical header markups in three views became one the moment
// two rules had to hold everywhere at once:
//
//   • LABELS ARE ALWAYS LEFT-ALIGNED. Money columns used to right-align their header over
//     right-aligned figures, which reads fine in isolation and ragged in a row of ten columns - the
//     eye scans a header row horizontally, and a label that starts somewhere else each time makes it
//     work for it. The figures line up on their own now that currency is always two decimals.
//   • EVERY COLUMN CAN BE RESIZED, by dragging the divider on its right edge. Double-click puts one
//     back. Widths are a per-browser user setting (`./columns.ts`), never part of a preset.
//
// It is STICKY to the top of the grid's scrollport, the mirror of `GridFooter` at the bottom. Both
// assume the same frame, which a consumer owes them: a `min-h-0 flex-1 overflow-auto` box (the
// scrollport) wrapping a `min-width` box (the columns). Reading row 80 with no idea which column is
// which is the same failure as scrolling to the bottom to find a total.

import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '../lib/utils.ts'
import { frozenColumnStyle, type ColumnWidthStore, type GridColumn } from './columns.ts'
import { GRID_HEADER } from './chrome.ts'

/**
 * The sticky column-header row of a data grid, with a drag handle on each column's right edge
 * (double-click resets). Labels are always left-aligned.
 * Use it for a grid on the house column model (`buildGrid`, `GridColumn`), usually through `DataGrid`.
 * Internal to `list/`: `DataGrid` draws it.
 * `onResize` omitted makes it fixed-width. `freeze` keeps leading columns in view; the rows and
 * `GridFooter` must take the same count.
 * Rule: it needs the grid frame, a `min-h-0 flex-1 overflow-auto` scrollport around a `min-width` box;
 * a scrollport with no focusable content gets `tabIndex={0}`, `role='region'` and a name.
 */
export function GridHeader({
  columns,
  template,
  onResize,
  className,
  freeze = 0,
}: {
  columns: GridColumn[]
  template: string
  /** Omit to make the header fixed-width (no handles). */
  onResize?: ColumnWidthStore['setWidth']
  className?: string
  /** How many leading columns stay in view while the grid scrolls sideways (`frozenColumnStyle`);
   *  the consumer's row cells and `GridFooter` take the same count. */
  freeze?: number
}) {
  return (
    <div
      role='row'
      className={cn(
        GRID_HEADER, 'group/gridhead sticky top-0 z-10 bg-bg',
        className,
      )}
      style={{ gridTemplateColumns: template }}>
      {columns.map((c, i) => (
        <div key={c.key} role='columnheader' className={cn('relative min-w-0', (c.lead != null || c.trail != null) && 'flex items-center gap-1')} style={i < freeze ? { ...frozenColumnStyle(columns, i, freeze), zIndex: 2 } : undefined}>
          {c.lead}
          {c.bare ? (
            <span className='sr-only'>{c.label}</span>
          ) : c.icon != null ? (
            <span title={c.hint ?? c.label} className='flex items-center justify-center'>
              {c.icon}
              <span className='sr-only'>{c.label}</span>
            </span>
          ) : (
            <span
              title={c.hint}
              className={cn(
                'block truncate text-left',
                c.hint && 'cursor-help decoration-dotted underline-offset-4 hover:underline',
                c.labelClass,
              )}>
              {c.label}
            </span>
          )}
          {/* The slot is one label line tall: a larger control (the 28px expand-all over the rows'
              chevrons) overflows it rather than growing the 33px header. */}
          {c.trail != null && <span className='ml-auto flex h-4 shrink-0 items-center'>{c.trail}</span>}
          {onResize && !c.bare && <ResizeHandle column={c} onResize={onResize} />}
        </div>
      ))}
      {/* The action cluster's slot - no visible label and no handle. */}
      <span role='columnheader'><span className='sr-only'>Actions</span></span>
    </div>
  )
}

/**
 * The divider between two columns, as a drag target. It measures the cell it lives in at pointerdown
 * rather than trusting the column's stored width, because the identity column FLEXES - its stored
 * number is a floor, and starting the drag from the floor rather than from what is on screen would
 * make the column jump the moment you grabbed it.
 */
function ResizeHandle({ column, onResize }: { column: GridColumn; onResize: ColumnWidthStore['setWidth'] }) {
  const drag = useRef<{ x: number; width: number } | null>(null)

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const cell = e.currentTarget.parentElement
    if (!cell) return
    drag.current = { x: e.clientX, width: cell.getBoundingClientRect().width }
    const start = drag.current

    const move = (ev: globalThis.PointerEvent): void => onResize(column.key, start.width + ev.clientX - start.x, false)
    const end = (ev: globalThis.PointerEvent): void => {
      onResize(column.key, start.width + ev.clientX - start.x, true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      document.body.classList.remove('select-none')
      drag.current = null
    }
    // Listeners on the window, not the handle: the pointer leaves a 12px target immediately, and a
    // drag that stops tracking the moment you move fast is worse than no drag at all.
    document.body.classList.add('select-none')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }

  return (
    <button
      type='button'
      aria-label={`Resize the ${column.label} column`}
      title='Drag to resize · double-click to reset'
      onPointerDown={onPointerDown}
      onDoubleClick={() => onResize(column.key, null)}
      className='absolute top-1/2 -right-2 z-10 h-5 w-3 -translate-y-1/2 cursor-col-resize opacity-0 transition-opacity before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-border-light hover:opacity-100 hover:before:bg-accent focus-visible:opacity-100 group-hover/gridhead:opacity-100'
    />
  )
}
