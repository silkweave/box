import { cn } from '../lib/utils.ts'

/**
 * The app's page widths - the whole scale, and nothing outside it. `reading` is for detail/reading
 * pages (a ticket, a task, settings, a message list); `wide` is for grids/tables/boards (signals,
 * schedules, users); `full` is for boards whose column count is open-ended, where a cap would force
 * a horizontal scrollbar on a screen that had the room.
 *
 * `flush` is the last step and the only one that drops the padding: EDGE TO EDGE, for a surface that
 * IS the page (2026-08-12). A data grid is one - its header row, its separators and its horizontal
 * scroll all want the full width of the frame, and page padding around it produces a floating card
 * with a gutter of dead space on both sides of a table that wanted to be wider. Everything that is
 * a document rather than a surface keeps its padding.
 */
const PAGE_WIDTH = {
  reading: 'max-w-3xl',
  wide: 'max-w-6xl',
  full: 'max-w-none',
  flush: 'max-w-none',
} as const

export type PageWidth = keyof typeof PAGE_WIDTH

/**
 * The padding inside the width. `page` is a section canvas's. `detail` is a record's page beside its
 * side panel (an initiative, an account, a ticket): 16px 20px, the Box's standard record padding,
 * shared by the side panels and the doc editor that fills one, so the two panes of a split read as
 * one surface rather than a page with a wide margin next to a panel.
 */
/** The `detail` padding's horizontal side in px, for a section that reaches past it to the pane's
 *  edges (a data grid's `bleed`). */
export const DETAIL_PAD_X = 20

const PAGE_PAD = {
  page: 'px-4 py-8 md:px-8',
  detail: 'px-5 py-4',
} as const

export type PagePad = keyof typeof PAGE_PAD

export function PageContainer({
  width = 'wide',
  pad = 'page',
  className,
  children,
}: {
  width?: PageWidth
  /** Ignored on `flush`, which has none. */
  pad?: PagePad
  /** Extra layout classes (e.g. `flex h-full flex-col` for console-style sections). */
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('mx-auto w-full', PAGE_WIDTH[width], width !== 'flush' && PAGE_PAD[pad], className)}>
      {children}
    </div>
  )
}
