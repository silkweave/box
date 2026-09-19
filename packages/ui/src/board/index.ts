/**
 * `@silkweave/box-ui/board` - the kanban board, the card frame it drags, and the control strip above
 * either half of a board view.
 *
 * A SEPARATE entry point because it is the only thing in the library that needs dnd-kit: three
 * packages, declared as OPTIONAL peer dependencies. This package has no build step - both consumers
 * resolve the `@silkweave/box-source` condition straight to `src/` - so anything the root barrel
 * re-exports is walked by the type-checker and by Vite's scanner on EVERY import of it. Re-exported
 * from `.`, a Box with no board at all would still have to resolve dnd-kit. Tree-shaking never gets
 * a say; resolution fails first.
 *
 * Everything here is vocabulary-free and storage-free, which is what kept it liftable: the board
 * takes rows plus two functions that say which column a row is in and what a drop means, and the bar
 * is controlled - `value` in, a patch out, with the preset control passed in as a slot because
 * presets are persisted somewhere only the app knows about.
 */
export * from './BoardKanban.tsx'
export * from './BoardViewBar.tsx'
export * from './DraggableCard.tsx'
