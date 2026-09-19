import { Menu } from 'lucide-react'
import * as React from 'react'
import { usePersistedState } from '../lib/usePersistedState.ts'
import { storageKey } from '../lib/storage.ts'
import { Button } from '../components/Button.tsx'
import { Wordmark } from '../brand/Wordmark.tsx'
import { Sidebar, SidebarRail, type GroupNav, type NavItem } from './Sidebar.tsx'
import { TopBar, type TopBarContent } from './TopBar.tsx'
import { TopBarSlotProvider, useTopBarSlot } from './TopBarActions.tsx'
import { useShellExtensions } from './ShellExtensions.tsx'

export interface AppShellProps {
  /** Top-level view switcher rendered as the sidebar's group accordion. */
  groupNav: GroupNav
  items: NavItem[]
  activeId: string
  onSelect: (id: string) => void
  topbar?: TopBarContent
  /** Small control rendered at the right of the active group's sidebar header. */
  groupAction?: React.ReactNode
  /**
   * localStorage namespace for the shell's own preferences (sidebar collapsed / group expanded /
   * theme). Defaults to the `storagePrefix` on `ShellExtensions`, and to `ui` if that is unset too;
   * pass your Box's name to keep two Boxes on one origin out of each other's way. An APP should set
   * it on the extensions value at its root rather than here - one place, not one per view.
   */
  storagePrefix?: string
  children: React.ReactNode
}

// App shell (ported from claudepad): sidebar + canvas on desktop; below md the
// sidebar collapses to an off-canvas drawer toggled from the top bar.
export function AppShell({
  groupNav,
  items,
  activeId,
  onSelect,
  topbar,
  groupAction,
  storagePrefix: storagePrefixProp,
  children,
}: AppShellProps) {
  const { trailing, aside, mainInert = false, storagePrefix: shellPrefix } = useShellExtensions()
  const storagePrefix = storagePrefixProp ?? shellPrefix
  const topBarSlot = useTopBarSlot()
  const topBarCenter = useTopBarSlot()
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const [collapsed, setCollapsed] = usePersistedState(
    storageKey(storagePrefix, 'sidebar', 'collapsed'),
    false,
    (v) => typeof v === 'boolean',
  )

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const select = (id: string) => {
    onSelect(id)
    setDrawerOpen(false)
  }

  // Inset ("framed") layout: the sidebar sits directly on the app background; the top bar +
  // canvas live in a rounded, bordered surface inset with a margin all around (Linear-style).
  return (
    <div className='flex h-dvh w-full overflow-hidden bg-sidebar text-text'>
      {/* Desktop sidebar: full nav, or an icon-only group rail while collapsed */}
      <aside className='hidden shrink-0 md:block'>
        {collapsed ? (
          <SidebarRail {...groupNav} onExpand={() => setCollapsed(false)} storagePrefix={storagePrefix} />
        ) : (
          <Sidebar
            {...groupNav}
            items={items}
            activeId={activeId}
            onSelect={select}
            onCollapse={() => setCollapsed(true)}
            groupAction={groupAction}
            storagePrefix={storagePrefix}
          />
        )}
      </aside>

      {/* Mobile off-canvas drawer */}
      {drawerOpen && (
        <div className='md:hidden fixed inset-0 z-40'>
          <button
            type='button'
            aria-label='Close menu'
            className='absolute inset-0 bg-text/30'
            onClick={() => setDrawerOpen(false)}
          />
          <div className='absolute inset-y-0 left-0 shadow-(--shadow-md)'>
            <Sidebar
              className='border-r border-border'
              {...groupNav}
              items={items}
              activeId={activeId}
              onSelect={select}
              groupAction={groupAction}
              storagePrefix={storagePrefix}
              />
          </div>
        </div>
      )}

      {/* Main canvas - the inset frame (the sidebar/rail occupies the left on desktop) */}
      <div className='flex min-w-0 flex-1 flex-col p-2 md:pl-0'>
        <div className='frame-shine flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl shadow-(--frame-shadow)'>
        <TopBar
          content={topbar}
          slotRef={topBarSlot.ref}
          centerSlotRef={topBarCenter.ref}
          leading={
            <>
              <Button
                variant='ghost'
                size='icon'
                className='md:hidden'
                aria-label='Open menu'
                onClick={() => setDrawerOpen(true)}>
                <Menu />
              </Button>
              <span className='md:hidden'>
                <Wordmark size='small' />
              </span>
            </>
          }
          trailing={trailing}
        />

        {/* The app's aside (an agent panel) rides inside the framed canvas as a sibling of <main> -
            one mount, visible app-wide. `relative` is its fullscreen containing block: the panel
            then covers this row and <main> goes inert but keeps its scroll position. */}
        <div className='relative flex min-h-0 flex-1 overflow-hidden'>
          <main inert={mainInert} className='min-h-0 min-w-0 flex-1 overflow-y-auto'>
            <TopBarSlotProvider node={topBarSlot.node} centerNode={topBarCenter.node}>
              {children}
            </TopBarSlotProvider>
          </main>
          {aside}
        </div>
        </div>
      </div>
    </div>
  )
}
