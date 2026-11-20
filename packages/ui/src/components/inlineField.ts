import { cn } from '../lib/utils.ts'

/**
 * The resting look of a Select trigger that edits a saved value in place (a record's field on its
 * detail page, a grid cell): no chrome until the pointer arrives, then a light border and tint that
 * say "this changes". The Select's own chevron (`[&>*:last-child]`) hides at rest: a column of
 * chevrons reads as a form. twMerge lets it override the trigger's default `border-border bg-bg`.
 * Grid cells use `CELL_TRIGGER` (`@silkweave/box-ui/list`), this look at row density.
 */
export const INLINE_TRIGGER = cn(
  'w-full border-transparent bg-transparent hover:border-border-light hover:bg-accent-tint/40 data-popup-open:border-accent/60',
  '[&>*:last-child]:shrink-0 [&>*:last-child]:opacity-0 hover:[&>*:last-child]:opacity-60 data-popup-open:[&>*:last-child]:opacity-60',
)
