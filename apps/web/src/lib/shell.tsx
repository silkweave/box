import { useMemo, type ComponentType, type ReactNode } from 'react'
import { Settings } from 'lucide-react'
import { useSettingsDialog } from './settingsDialog.ts'
import { Button } from '@silkweave/box-ui'
import { Link } from '@tanstack/react-router'
import { ShellExtensionsProvider, type HomeLinkProps, type ShellExtensions } from '@silkweave/box-ui'
import { ALL_WEB_FEATURES } from '../web-features.ts'
import { AgentSidebar, AgentToggle, useAgentFullscreen } from '../components/agent/AgentSidebar.tsx'
import { useAgent } from './agentStore.ts'
import { APP_STORAGE_PREFIX } from './storage.ts'
import { AppUserMenu } from './userMenu.tsx'
import { isBuilderPreview } from './builderPreview.ts'

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
  cachedTopbar ??= ALL_WEB_FEATURES.flatMap((f) => f.shell?.topbar ?? [])
    .sort((a, b) => a.order - b.order)
    .map((slot) => slot.component)
  return cachedTopbar
}

// The wordmark normally uses TanStack's <Link> so app route changes preserve live subscriptions.
// The stable Builder snapshot is a separate document boundary, so leaving it must request the
// editable app explicitly. Exact matching keeps the regular app path client-side.
function HomeLink({ children, ...rest }: HomeLinkProps) {
  if (typeof window !== 'undefined' && window.location.pathname === '/builder') {
    return (
      <a href='/' {...rest}>
        {children}
      </a>
    )
  }

  return (
    <Link to='/' activeOptions={{ exact: true }} {...rest}>
      {children}
    </Link>
  )
}

// One mount, app-wide, and a stable element so the context value only changes when the flag does.
const agentAside = <AgentSidebar />

function SettingsControl() {
  const { open } = useSettingsDialog()
  return <Button variant='ghost' size='icon' className='size-8' aria-label='Settings' title='Settings' onClick={() => open()}><Settings /></Button>
}

export function AppShellExtensions({ children }: { children: ReactNode }) {
  const { config, open } = useAgent()
  const builderPreview = isBuilderPreview()
  const agentFullscreen = useAgentFullscreen()
  const mainInert = !builderPreview && agentFullscreen
  const asideOpen = !builderPreview && open && config?.enabled === true
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
          {!builderPreview && <AgentToggle />}
        </>
      ),
      aside: builderPreview ? undefined : agentAside,
      asideOpen,
      mainInert,
      homeLink: HomeLink,
      settingsControl: SettingsControl,
      // Set once here so the persistent root shell's sidebar and theme preferences share this
      // app's namespace with everything appKey() builds. See lib/storage.ts.
      storagePrefix: APP_STORAGE_PREFIX,
    }),
    [asideOpen, builderPreview, mainInert],
  )
  return <ShellExtensionsProvider value={value}>{children}</ShellExtensionsProvider>
}
