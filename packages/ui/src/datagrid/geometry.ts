// The name cell's geometry, px. Every row draws the same slots so text lines up at each depth:
//
//   [depth x INDENT] [mark] name ............ [toggle]
//
// The toggle (the fold chevron) sits at the name cell's right end, so nesting reads from the indent
// alone; its slot is drawn on every row of a grid that nests, so names truncate at one edge. The mark
// is the row's icon and doubles as its drag handle: on a row that can be dragged, hovering turns it
// into the grip. The mark slot is drawn on every row that has an icon or can be moved in some view,
// so turning on a sort does not shift the rows; a row with neither skips it. Every mark (and the
// grip) is centred on the slot's axis; the slot is narrower than a 14px icon, which overflows it
// evenly, so small marks stay close to their names. One INDENT is a mark
// and its gap: a child's mark sits under its parent's name.

/** The row's horizontal padding (`--grid-pad`, 0.5rem unless a bleeding section widens it). */
export const ROW_PAD = 8
export const GAP = 4
/** The gap between a row's columns (`gap-2`). */
export const COLUMN_GAP = 8
export const MARK = 12
export const INDENT = MARK + GAP
/** Every row's height. */
export const ROW_HEIGHT = 48
/** The fold chevron's slot at the name cell's right end. */
export const TOGGLE = 28

/** Horizontal pointer travel per nesting level while dragging (see `nestLevels`). */
export const NEST_STEP = 28
