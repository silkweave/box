// The sidebar's sections, built from the sections the nav entries declare. Pure, and free of any
// feature import, so it can be tested without the registration (lib/nav.ts feeds it).

import type { NavGroup } from '@silkweave/box-ui'
import type { NavEntry, NavSection } from '../feature.ts'

/** The heading of entries that declare no section. */
export const OTHER_SECTION = 'Other'

/** Nav order: entry `order`, ties broken by `id`. */
export function byNavOrder(a: NavEntry, b: NavEntry): number {
  return a.order - b.order || a.id.localeCompare(b.id)
}

/**
 * The sidebar groups, section by section (rules on `NavSection` in feature.ts):
 * - entries with the same section id form one section; its label and order come from its first
 *   entry in nav order, so the outcome never depends on registration order;
 * - sections sort by order, then id; entries inside one by nav order;
 * - entries without a section come last, under "Other".
 * Core names no feature: each feature places its own entries. A section exists only while one of
 * its entries does, so absent features leave no empty headings.
 */
export function sidebarGroups(entries: readonly NavEntry[]): NavGroup[] {
  const sorted = [...entries].sort(byNavOrder)
  const sections = new Map<string, NavSection>()
  for (const entry of sorted) if (entry.section && !sections.has(entry.section.id)) sections.set(entry.section.id, entry.section)
  const ordered = [...sections.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const group = (entry: NavEntry, section: string): NavGroup => ({ ...entry, href: entry.to, section })
  return [
    ...ordered.flatMap((section) =>
      sorted.filter((entry) => entry.section?.id === section.id).map((entry) => group(entry, section.label)),
    ),
    ...sorted.filter((entry) => !entry.section).map((entry) => group(entry, OTHER_SECTION)),
  ]
}
