// Type guards small enough that every board, every stored view and every localStorage read needs
// them, and general enough that none of them belongs to a feature.
//
// `isStringArray` lived in `features/data/lib/boardView.ts` until 2026-09-13, which made core's
// `useRecentIds` import a feature - invisible to `bun run lint:deps` (it only walks feature
// directories) and a compile error on a Box with no `data` feature installed.

/** A `string[]`, as read back from JSON or localStorage where the shape is not guaranteed. */
export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
