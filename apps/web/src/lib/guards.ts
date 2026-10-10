// Type guards small enough that every board, every stored view and every localStorage read needs
// them, and general enough that none of them belongs to a feature.

/** A `string[]`, as read back from JSON or localStorage where the shape is not guaranteed. */
export const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
