import { Settings } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import type { GroupNav } from '@silkweave/box-ui'
import type { NavEntry } from '../feature.ts'
import { WEB_FEATURE_LIST } from '../generated/features.ts'

/** Core's own group. Order band 900 so it is always last. */
const SETTINGS: NavEntry = { id: 'settings', label: 'Settings', icon: Settings, to: '/settings', order: 900 }

/**
 * The sidebar groups: every present feature's `nav` entries plus Settings, by order band then id.
 * Computed at first use, not at module evaluation: this module sits on an import cycle with every
 * view (view -> nav.ts -> generated/features -> feature index -> view), which is safe only as long
 * as nothing here touches WEB_FEATURES while the cycle is still loading.
 */
let cached: NavEntry[] | undefined
export function navEntries(): NavEntry[] {
  cached ??= [...WEB_FEATURE_LIST.flatMap((f) => f.nav ?? []), SETTINGS].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  )
  return cached
}

/**
 * The present features' nav entries, WITHOUT core's Settings - "the apps this Box has". The app
 * dashboard at `/` draws one card each; Settings is chrome, not an app, and stays in the sidebar.
 * Same laziness rule as navEntries(): call it inside a component, never at module scope.
 */
export function appEntries(): NavEntry[] {
  return navEntries().filter((e) => e.id !== SETTINGS.id)
}

/**
 * Where `/` lands when there are no apps to list: the first group in nav order. On a Box with no
 * features that is Settings, which is the whole point - an empty dashboard is not a landing page,
 * and the blank-Box proof (AGENTS.md) depends on `/` going somewhere with something on it.
 */
export function homePath(): string {
  return navEntries()[0].to
}

/** GroupNav for the active view - group selection navigates between the top-level routes. */
export function useGroupNav(activeGroup: string): GroupNav {
  const navigate = useNavigate()
  const groups = navEntries()
  return {
    groups,
    activeGroup,
    onSelectGroup: (id) => {
      const entry = groups.find((g) => g.id === id)
      // `to` is a path a present feature declared; TanStack's literal-constrained `ToPathOption`
      // cannot know that from a string, hence the cast.
      if (entry) void navigate({ to: entry.to as never })
    },
  }
}
