import { useMemo, type ComponentType, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ShellExtensionsProvider, type HomeLinkProps, type ShellExtensions } from '@silkweave/box-ui'
import { WEB_FEATURE_LIST } from '../generated/features.ts'
import { AgentSidebar, AgentToggle, useAgentFullscreen } from '../components/agent/AgentSidebar.tsx'
import { APP_STORAGE_PREFIX } from './storage.ts'
import { AppUserMenu } from './userMenu.tsx'

/**
 * This app's half of the shell seam (@silkweave/box-ui `ShellExtensions`): the agent panel, the
 * feature-contributed top-bar controls, and the user menu. The library's <AppShell> knows about
 * none of them.
 */

/**
 * Feature-contributed top-bar controls (a restart prompt, a notification bell), by order.
 *
 * Computed on first use and cached, NEVER at module scope. `generated/features.ts` sits on an
 * import cycle with every view that renders the shell, so a module-scope read of WEB_FEATURE_LIST
 * runs while the binding is still in its temporal dead zone and throws `Cannot access
 * 'WEB_FEATURE_LIST' before initialization` at load - which is exactly what AppShell.tsx did from
 * bf5a3f2 until this seam, and what `box verify` cannot see because it has no runtime step.
 * `lib/nav.ts` and `lib/slots.ts` dodge the same hazard the same way.
 */
let cachedTopbar: ComponentType[] | undefined
function topbarComponents(): ComponentType[] {
  cachedTopbar ??= WEB_FEATURE_LIST.flatMap((f) => f.shell?.topbar ?? [])
    .sort((a, b) => a.order - b.order)
    .map((slot) => slot.component)
  return cachedTopbar
}

// The wordmark's link home: TanStack's <Link>, not <a href='/'>. Since browser history replaced
// hash routing (2026-09-14) a bare anchor to the origin is a full document reload, which drops the
// change feed and every feature's live subscription. `/` is the index route, whose beforeLoad
// redirects to homePath(). Exact matching, or the link would count as "active" on every path (every
// path starts with `/`) and carry aria-current='page' everywhere. Rendered inside the shell, so the
// router context is in scope even though AppShellExtensions sits outside RouterProvider.
function HomeLink({ children, ...rest }: HomeLinkProps) {
  return (
    <Link to='/' activeOptions={{ exact: true }} {...rest}>
      {children}
    </Link>
  )
}

// One mount, app-wide, and a stable element so the context value only changes when the flag does.
const agentAside = <AgentSidebar />

export function AppShellExtensions({ children }: { children: ReactNode }) {
  const mainInert = useAgentFullscreen()
  // useAgentFullscreen subscribes to the whole agent store, which emits on every pointermove of the
  // panel's width drag. Memoising on the flag keeps those emits from re-rendering the whole shell.
  const value = useMemo<ShellExtensions>(
    () => ({
      trailing: (
        <>
          {topbarComponents().map((Slot, i) => (
            <Slot key={i} />
          ))}
          <AppUserMenu />
          <AgentToggle />
        </>
      ),
      aside: agentAside,
      mainInert,
      homeLink: HomeLink,
      // Set ONCE, here, not on each of the thirteen <AppShell> mounts: the shell's sidebar and
      // theme preferences then share this app's namespace with everything appKey() builds, and a
      // fourteenth view cannot split it by forgetting a prop. See lib/storagePrefix.ts.
      storagePrefix: APP_STORAGE_PREFIX,
    }),
    [mainInert],
  )
  return <ShellExtensionsProvider value={value}>{children}</ShellExtensionsProvider>
}
