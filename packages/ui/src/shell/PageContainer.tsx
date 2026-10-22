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
  reading: 'max-w-3xl px-4 py-8 md:px-8',
  wide: 'max-w-6xl px-4 py-8 md:px-8',
  full: 'max-w-none px-4 py-8 md:px-8',
  flush: 'max-w-none',
} as const

export type PageWidth = keyof typeof PAGE_WIDTH

export function PageContainer({
  width = 'wide',
  className,
  children,
}: {
  width?: PageWidth
  /** Extra layout classes (e.g. `flex h-full flex-col` for console-style sections). */
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('mx-auto w-full', PAGE_WIDTH[width], className)}>
      {children}
    </div>
  )
}
