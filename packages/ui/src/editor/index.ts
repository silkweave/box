/**
 * `@silkweave/box-ui/editor` - the markdown editor, and its `DocHandle` seam.
 *
 * A SEPARATE entry point because it is the only thing in the library that needs TipTap: eight
 * packages, declared as OPTIONAL peer dependencies. This package has no build step - both consumers
 * resolve the `@silkweave/box-source` condition straight to `src/` - so anything the root barrel
 * re-exports is walked by the type-checker and by Vite's scanner on EVERY import of it. Re-exported
 * from `.`, a Box that never opens an editor would still fail to resolve TipTap. Tree-shaking never
 * gets a say; resolution fails first.
 *
 * Only the lazy boundary is exported, so TipTap stays in its own chunk at runtime too.
 */
export * from './types.ts'
export * from './DocEditor.tsx'
