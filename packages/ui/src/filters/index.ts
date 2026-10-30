/**
 * `@silkweave/box-ui/filters` - the typed filter kit: six field types (options, person, date,
 * number, text, boolean), the pure rules that match, repair, compare and summarize their values, the
 * panel the board bar's funnel opens, one editor per type, and the chip a pinned field becomes.
 *
 * Its own entry point so a module's view model (plain `.ts`, no JSX) can import the schema types and
 * `matchAll` without walking the board, which needs dnd-kit. It needs nothing beyond what `.` needs.
 *
 * Vocabulary-free like the rest of the library: a host says "a date called Due, offering these
 * windows" and keeps what Due MEANS - which rows are open, who "me" is, what today is.
 */
export * from './types.ts'
export * from './match.ts'
export * from './editors.tsx'
export * from './FilterPanel.tsx'
export * from './PinnedFilterChip.tsx'
