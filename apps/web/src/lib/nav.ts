import { LayoutDashboard } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import type { GroupNav } from '@silkweave/box-ui'
import { WORKSPACE_SECTION, type NavEntry } from '../feature.ts'
import { ALL_WEB_FEATURES } from '../web-features.ts'
import { byNavOrder, sidebarGroups } from './navSections.ts'
import { useSidebarCustomization } from './sidebarLayout.ts'

const DASHBOARD: NavEntry = {
  id: 'home',
  label: 'Dashboard',
  icon: LayoutDashboard,
  to: '/',
  order: 0,
  expandable: false,
  section: WORKSPACE_SECTION,
}

/**
 * The sidebar groups: every present feature's `nav` entries plus Dashboard, by order band then id.
 * Computed at first use, not at module evaluation: this module sits on an import cycle with every
 * view (view -> nav.ts -> generated/features -> feature index -> view), which is safe only as long
 * as nothing here touches WEB_FEATURES while the cycle is still loading.
 */
let cached: NavEntry[] | undefined
export function navEntries(): NavEntry[] {
  cached ??= [DASHBOARD, ...ALL_WEB_FEATURES.flatMap((f) => f.nav ?? [])].sort(byNavOrder)
  return cached
}

/** GroupNav for the active view - group selection navigates between the top-level routes. */
export function useGroupNav(activeGroup: string): GroupNav {
  const navigate = useNavigate()
  // Sections come from the entries themselves (lib/navSections.ts); core names no feature.
  const groups = sidebarGroups(navEntries())
  // Each person may reorder sections and entries and hide entries (the sidebar's Customize mode).
  const customization = useSidebarCustomization()
  return {
    groups,
    activeGroup,
    customization,
    onSelectGroup: (id) => {
      const entry = navEntries().find((g) => g.id === id)
      // `to` is a path a present feature declared; TanStack's literal-constrained `ToPathOption`
      // cannot know that from a string, hence the cast.
      if (!entry) return

      void navigate({ to: entry.to as never })
    },
  }
}
