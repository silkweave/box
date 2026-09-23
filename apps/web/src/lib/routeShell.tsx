import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from 'react'
import { useRouterState } from '@tanstack/react-router'
import type { AppShellProps } from '@silkweave/box-ui'
import { createRouteShellStore } from './routeShellStore.ts'

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    shellGroup?: string
  }
}

export type RouteChromeDescriptor = Pick<AppShellProps, 'items' | 'activeId' | 'onSelect' | 'topbar' | 'groupAction'>
export const createChromeController = () => createRouteShellStore<RouteChromeDescriptor>()
export const RouteChromeContext = createContext<ReturnType<typeof createChromeController> | null>(null)

/** Select committed matches, including a history key so returning to a URL is a new visit. */
export function useShellIdentity() {
  return useRouterState({ select: (state) => {
    const section = [...state.matches].reverse().find((match) => match.staticData.shellGroup)
    return {
      section: section?.routeId ?? '',
      group: section?.staticData.shellGroup ?? '',
      location: `${state.resolvedLocation?.state.__TSR_key ?? state.location.state.__TSR_key ?? ''}:${state.resolvedLocation?.href ?? state.location.href}`,
    }
  } })
}

/** Writers never subscribe to the chrome snapshot. Their children stay in the route subtree. */
export function RouteChrome({ children, ...descriptor }: RouteChromeDescriptor & { children: ReactNode }) {
  const controller = useContext(RouteChromeContext)
  if (!controller) throw new Error('RouteChrome requires the application shell')
  const [owner] = useState(() => Symbol('route chrome'))
  const { section, location } = useShellIdentity()
  // A complete publication after every writer commit refreshes closures without parent updates
  // during render. Snapshot updates only render ShellHost, never this writer's context provider.
  useLayoutEffect(() => { controller.publish(owner, section, location, descriptor) })
  useLayoutEffect(() => () => controller.remove(owner), [controller, owner])
  return children
}
