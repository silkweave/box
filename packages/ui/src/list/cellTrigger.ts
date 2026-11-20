import { cn } from '../lib/utils.ts'
import { INLINE_TRIGGER } from '../components/inlineField.ts'

/**
 * The resting look of an editable grid cell: the kit's `INLINE_TRIGGER` (no chrome until the
 * pointer arrives, chevron hidden at rest) at row density. Use on the trigger of a cell that edits
 * in place.
 *
 * - `CELL_TRIGGER` for a `SelectTrigger`.
 * - `CELL_BUTTON` for a `PopoverTrigger` (a date, tags, a picker), which has no chevron.
 * - Add `CELL_ICON` to either for an icon-only cell, such as a leading kind or icon column: a 32px
 *   square, centred, no chevron. The glyph inside is 14px (`size-3.5`), muted.
 */
export const CELL_TRIGGER = cn(INLINE_TRIGGER, 'h-auto min-h-6 justify-between gap-1 rounded border px-1 py-0.5 text-left')

/** See `CELL_TRIGGER`: the same resting look for a popover-backed cell. */
export const CELL_BUTTON = cn(
  'flex min-h-6 w-full items-center gap-1 rounded border border-transparent px-1 py-0.5 text-left',
  'hover:border-border-light hover:bg-accent-tint/40 data-popup-open:border-accent/60',
)

/** See `CELL_TRIGGER`: the icon-only modifier. Only the first child shows (a Select drops its chevron). */
export const CELL_ICON = 'size-8 min-h-0 w-8 justify-center p-0 [&>*:not(:first-child)]:hidden'
