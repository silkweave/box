import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { SettingsDialogHost } from '../views/SettingsView.tsx'
import { AppShell } from '@silkweave/box-ui'
import { navEntries, useGroupNav } from '../lib/nav.ts'
import { createChromeController, RouteChromeContext, useShellIdentity } from '../lib/routeShell.tsx'
import { selectRouteChrome } from '../lib/routeShellStore.ts'

/** Installed as the root shell, outside the router's recoverable content boundaries. */
export function AppLayout({ children }: { children: ReactNode }) {
  const [controller] = useState(createChromeController)
  return <RouteChromeContext.Provider value={controller}>
    <ShellHost controller={controller}>{children}</ShellHost>
    <SettingsDialogHost />
  </RouteChromeContext.Provider>
}

function ShellHost({ controller, children }: { controller: ReturnType<typeof createChromeController>; children: ReactNode }) {
  const identity = useShellIdentity()
  const groupNav = useGroupNav(identity.group)
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const chrome = selectRouteChrome(snapshot, identity.section, identity.location)
  const label = navEntries().find((entry) => entry.id === identity.group)?.label
  return <AppShell
    groupNav={groupNav}
    items={chrome?.items ?? []}
    activeId={chrome?.activeId ?? ''}
    onSelect={chrome?.onSelect ?? ignoreSelection}
    topbar={chrome?.topbar ?? { crumbs: label ? [{ label }] : [] }}
    groupAction={chrome?.groupAction}
    navigationKey={identity.location}
    scrollResetKey={identity.section}>
    {children}
  </AppShell>
}

function ignoreSelection() {}
