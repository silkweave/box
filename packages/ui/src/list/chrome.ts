// The list's chrome, internal to `list/`: `GridHeader`, `Row`, `GroupRow` and `GridFooter` draw
// from these classes. Sizes: header 33px, rows 48px, group rows
// 33px, 8px side padding (`--grid-pad`, widened by a bleeding section), 8px column gap.

/** The side padding of a header, row or group row. */
export const GRID_PAD = 'px-[var(--grid-pad,0.5rem)]'

/** A column-header row (pair with a `grid-template-columns`). */
export const GRID_HEADER = 'grid items-center gap-2 border-b border-border px-[var(--grid-pad,0.5rem)] py-2 text-label font-medium text-muted-foreground'

/** A data row (pair with a template and a 48px height, `ROW_HEIGHT` or `min-h-12`). */
export const GRID_ROW = 'grid items-center gap-2 border-b border-border px-[var(--grid-pad,0.5rem)] text-body-sm text-text'

/** The hover tint of a row that opens something. */
export const GRID_ROW_HOVER = 'hover:bg-[color-mix(in_oklab,var(--accent-tint)_30%,transparent)]'

/** A group (folder) row: a full-width bar with the group's name. */
export const GRID_GROUP_ROW = 'flex items-center gap-2 border-b border-border bg-surface-2/60 px-[var(--grid-pad,0.5rem)] py-1.5 text-body-sm font-medium text-text hover:bg-surface-2'
