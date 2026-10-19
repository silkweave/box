// A person's arrangement of the sidebar: the order of its sections, the order of the groups inside
// each section, and the groups they hid. Pure, so the shell, the rail and the customize mode all
// derive the same arrangement from the app's default list. The app owns where it is stored.

import type { NavGroup } from './Sidebar.tsx'

export interface SidebarLayout {
  /** Section headings, in the person's order. */
  sections: string[]
  /** Group ids, in the person's order (only the order within a section matters). */
  groups: string[]
  /** Group ids the person hid. */
  hidden: string[]
}

/** The sidebar's customization seam: the stored layout (null is the app's default) and its writer. */
export interface SidebarCustomization {
  layout: SidebarLayout | null
  /** Store a new layout; null restores the default. */
  onChange: (layout: SidebarLayout | null) => void
}

/** A group's section key: groups without a heading form one unnamed section. */
export const sectionOf = (group: NavGroup): string => group.section ?? ''

/** Sections in first-appearance order of `groups`. */
export function sectionKeys(groups: readonly NavGroup[]): string[] {
  const out: string[] = []
  for (const g of groups) if (!out.includes(sectionOf(g))) out.push(sectionOf(g))
  return out
}

/** A stable sort by position in `order`; anything the order does not name keeps its default place
 *  after the named ones. */
function byOrder<T>(items: readonly T[], key: (item: T) => string, order: readonly string[]): T[] {
  const rank = (item: T) => {
    const i = order.indexOf(key(item))
    return i < 0 ? Number.POSITIVE_INFINITY : i
  }
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map((x) => x.item)
}

/** The groups in the person's order, each section kept contiguous. */
export function orderGroups(groups: readonly NavGroup[], layout: SidebarLayout | null): NavGroup[] {
  if (!layout) return [...groups]
  return byOrder(sectionKeys(groups), (s) => s, layout.sections).flatMap((section) =>
    byOrder(
      groups.filter((g) => sectionOf(g) === section),
      (g) => g.id,
      layout.groups,
    ),
  )
}

export interface SidebarArrangement {
  /** What the sidebar shows, in order: every group not hidden, plus the active one if it is. */
  shown: NavGroup[]
  /** The hidden groups, in order. */
  hidden: NavGroup[]
  /** The active group when it is hidden and shown only because it is where you are. */
  revealed: string | null
}

/**
 * The sidebar as this person arranged it. A hidden group you navigate to still appears, at its own
 * place (its section's heading with it), so the sidebar never hides where you are.
 */
export function arrangeSidebar(groups: readonly NavGroup[], layout: SidebarLayout | null, activeGroup: string): SidebarArrangement {
  const ordered = orderGroups(groups, layout)
  const hidden = new Set(layout?.hidden ?? [])
  const revealed = hidden.has(activeGroup) && ordered.some((g) => g.id === activeGroup) ? activeGroup : null
  return {
    shown: ordered.filter((g) => !hidden.has(g.id) || g.id === revealed),
    hidden: ordered.filter((g) => hidden.has(g.id)),
    revealed,
  }
}

/**
 * The layout that records `ordered` (the full arrangement, hidden groups included, sections
 * contiguous) and `hidden`. Ids of groups the app no longer shows are kept at the end, so an entry
 * that comes back finds its place and hidden state again.
 */
export function layoutOf(ordered: readonly NavGroup[], hidden: readonly string[], previous: SidebarLayout | null): SidebarLayout {
  const keep = (next: string[], prev: readonly string[] = []) => [...next, ...prev.filter((id) => !next.includes(id))]
  const ids = ordered.map((g) => g.id)
  return {
    sections: keep(sectionKeys(ordered), previous?.sections),
    groups: keep(ids, previous?.groups),
    hidden: keep(
      ids.filter((id) => hidden.includes(id)),
      previous?.hidden.filter((id) => !ids.includes(id)),
    ),
  }
}
