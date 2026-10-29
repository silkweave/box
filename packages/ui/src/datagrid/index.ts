/**
 * `@silkweave/box-ui/datagrid` - the one list component: a full page or a card on a detail page,
 * with the board view bar on top, the house grid (or cards) below, nesting and drag.
 *
 * A separate entry point for the same reason as `./board`: it needs dnd-kit (optional peers).
 */
export * from './DataGrid.tsx'
export * from './tree.ts'
export { MoveConflict, type Move, type MoveIntent } from './moves.ts'
