// The folder row of a grouped list: chevron, title, count, and the group's own controls.

import type { MouseEvent, ReactNode, Ref, SyntheticEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { GAP, MARK } from './geometry.ts'
import { GRID_GROUP_ROW } from './chrome.ts'
import { ownClick } from './Row.tsx'

const stop = (e: SyntheticEvent) => e.stopPropagation()

/**
 * The folder row of a grouped `DataGrid`: the chevron in the mark slot (so the title lines up with
 * the names under it), the title, the count, and at the end the group's own controls.
 * Internal to `DataGrid`, which draws it for every grouping (flat, nested, cards): a host passes
 * `groupOf` and, for folders that may be empty, `groupCatalog`, never its own group row.
 * Rules: the chevron is the fold button (`aria-expanded`, named "Collapse <name>"); a click anywhere
 * else on the row folds too, unless it lands on a control. The title is plain content, so it may
 * hold an inline rename; `aside` controls (a "..." menu) never fold; `ref` lets a drop target wrap
 * the row. One cell spans the row's `columns`.
 */
export function GroupRow({ open, onToggle, name, title, count, aside, columns, ref }: {
  open: boolean
  onToggle: () => void
  /** The group's plain name, for the button's label ("Expand Backups"). */
  name: string
  title: ReactNode
  count: number
  aside?: ReactNode
  /** How many columns the row spans (its one cell's `aria-colspan`). */
  columns: number
  ref?: Ref<HTMLDivElement>
}) {
  return (
    <div ref={ref} role='row' onClick={(e: MouseEvent<HTMLDivElement>) => ownClick(e) && onToggle()} className={cn(GRID_GROUP_ROW, 'relative cursor-pointer gap-0')}>
      <div role='cell' aria-colspan={columns} className='flex min-w-0 flex-1 items-center' style={{ gap: GAP }}>
        <button
          type='button'
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          className='flex shrink-0 justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50'
          style={{ width: MARK }}>
          <ChevronRight aria-hidden='true' className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        </button>
        <span className='flex min-w-0 items-center gap-2 truncate'>{title}</span>
        <span className='ml-1 text-label font-normal tabular-nums text-muted-foreground'>{count}</span>
        {aside && (
          <span className='ml-auto flex shrink-0 items-center gap-0.5 font-normal' onClick={stop} onKeyDown={stop}>
            {aside}
          </span>
        )}
      </div>
    </div>
  )
}
