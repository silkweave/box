import { LayoutDashboard } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import type { GroupNav, NavGroup } from '@silkweave/box-ui'
import type { NavEntry } from '../feature.ts'
import { ALL_WEB_FEATURES } from '../web-features.ts'

const DASHBOARD: NavEntry = { id: 'home', label: 'Dashboard', icon: LayoutDashboard, to: '/', order: 0, expandable: false }

/**
 * The sidebar groups: every present feature's `nav` entries plus Dashboard, by order band then id.
 * Computed at first use, not at module evaluation: this module sits on an import cycle with every
 * view (view -> nav.ts -> generated/features -> feature index -> view), which is safe only as long
 * as nothing here touches WEB_FEATURES while the cycle is still loading.
 */
let cached: NavEntry[] | undefined
export function navEntries(): NavEntry[] {
  cached ??= [DASHBOARD, ...ALL_WEB_FEATURES.flatMap((f) => f.nav ?? [])].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  )
  return cached
}

/** This Box's sidebar organization. Domain names belong here, outside the UI library. */
const SIDEBAR_SECTIONS = [
  { label: 'Workspace', ids: ['home', 'comms', 'chat', 'artifacts', 'sink'] },
  { label: 'Reporting', ids: ['signals', 'boards'] },
  { label: 'Operations', ids: ['goals', 'initiatives', 'sprints', 'reminders'] },
  { label: 'Sales', ids: ['crm'] },
  { label: 'Marketing', ids: ['content', 'engagement'] },
  { label: 'Support', ids: ['support', 'support-help'] },
]

function sidebarGroups(): NavGroup[] {
  const entries = navEntries()
  const assigned = new Set(SIDEBAR_SECTIONS.flatMap((section) => section.ids))
  return [
    ...SIDEBAR_SECTIONS.flatMap((section) =>
      section.ids.flatMap((id) => {
        const entry = entries.find((item) => item.id === id)
        return entry ? [{ ...entry, href: entry.to, section: section.label }] : []
      }),
    ),
    ...entries.filter((entry) => !assigned.has(entry.id)).map((entry) => ({ ...entry, href: entry.to, section: 'Other' })),
  ]
}

/** GroupNav for the active view - group selection navigates between the top-level routes. */
export function useGroupNav(activeGroup: string): GroupNav {
  const navigate = useNavigate()
  const groups = sidebarGroups()
  return {
    groups,
    activeGroup,
    onSelectGroup: (id) => {
      const entry = navEntries().find((g) => g.id === id)
      // `to` is a path a present feature declared; TanStack's literal-constrained `ToPathOption`
      // cannot know that from a string, hence the cast.
      if (!entry) return

      void navigate({ to: entry.to as never })
    },
  }
}
