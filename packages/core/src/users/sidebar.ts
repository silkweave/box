// A person's own sidebar layout: the order of its sections, the order of the entries inside each
// section, and the entries they hid. Personal, so it lives on the person's `users` row (core:010),
// not in config/: the team's sidebar organisation is the Box's (apps/web lib/nav.ts) and this only
// rearranges it for one person.
//
// Opaque ids by design: sections are named by their heading and entries by their nav id, both the
// web app's vocabulary. An id the app no longer has is kept and ignored, so a section renamed back or
// an entry re-enabled finds its place again; a new one simply takes its default position. NULL is
// the Box's default layout, which is also what "Reset" stores.

import { ensureSchema, withRead, withWrite } from '../warehouse/db.js'

export interface SidebarLayout {
  /** Section headings, in the person's order. */
  sections: string[]
  /** Entry ids, in the person's order (only the order within a section matters). */
  groups: string[]
  /** Entry ids the person hid. */
  hidden: string[]
}

/** Bounds on what one person can store: far above any real sidebar, small enough to stay a row. */
export const SIDEBAR_LIST_MAX = 200
export const SIDEBAR_ID_MAX = 120

function idList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`sidebar layout: ${field} must be an array of strings`)
  if (value.length > SIDEBAR_LIST_MAX) throw new Error(`sidebar layout: ${field} holds at most ${SIDEBAR_LIST_MAX} ids`)
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== 'string' || v.length > SIDEBAR_ID_MAX) throw new Error(`sidebar layout: ${field} holds strings of at most ${SIDEBAR_ID_MAX} characters`)
    if (!out.includes(v)) out.push(v)
  }
  return out
}

/** Validate a layout from the wire: throws on a malformed one, drops duplicate ids. */
export function parseSidebarLayout(value: unknown): SidebarLayout {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('sidebar layout: expected an object')
  const v = value as Record<string, unknown>
  return { sections: idList(v.sections ?? [], 'sections'), groups: idList(v.groups ?? [], 'groups'), hidden: idList(v.hidden ?? [], 'hidden') }
}

/** A stored value read leniently: anything unreadable is the default layout (null). */
function storedLayout(raw: unknown): SidebarLayout | null {
  if (raw == null) return null
  try {
    return parseSidebarLayout(typeof raw === 'string' ? JSON.parse(raw) : raw)
  } catch {
    return null
  }
}

/** The person's layout, or null for the Box's default. */
export async function readSidebarLayout(userId: string): Promise<SidebarLayout | null> {
  await ensureSchema()
  const [row] = await withRead<{ sidebar: unknown }>(`SELECT sidebar FROM users WHERE id = ?`, [userId])
  return row ? storedLayout(row.sidebar) : null
}

/**
 * Store the person's layout; null restores the default. Leaves `updated_at` alone and emits no
 * change: nobody else's view depends on it, and a `table:users` emit would refetch every open
 * people directory for a drag.
 */
export async function writeSidebarLayout(userId: string, layout: SidebarLayout | null): Promise<SidebarLayout | null> {
  const value = layout ? parseSidebarLayout(layout) : null
  await ensureSchema()
  await withWrite(async (conn) => {
    await conn.run(`UPDATE users SET sidebar = ? WHERE id = ?`, [value ? JSON.stringify(value) : null, userId])
  })
  return value
}
