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
import { cn } from '../lib/utils.ts'

export interface AppShellProps {
  /** Top-level view switcher rendered as the sidebar's group accordion. */
  groupNav: GroupNav
  items: NavItem[]
  activeId: string
  onSelect: (id: string) => void
  topbar?: TopBarContent
  /** Small control rendered at the right of the active group's sidebar header. */
  groupAction?: React.ReactNode
  /** Changes when navigation commits. Closes an open mobile drawer without remounting the shell. */
  navigationKey?: unknown
  /** Changes when the owning section changes. Resets only the shell-owned main scroller. */
  scrollResetKey?: unknown
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
  navigationKey,
  scrollResetKey,
  storagePrefix: storagePrefixProp,
  children,
}: AppShellProps) {
  const { trailing, aside, asideOpen = false, mainInert = false, storagePrefix: shellPrefix } = useShellExtensions()
  const framed = asideOpen && aside != null
  const storagePrefix = storagePrefixProp ?? shellPrefix
  const topBarSlot = useTopBarSlot()
  const topBarCenter = useTopBarSlot()
  const [drawerOpen, setDrawerOpen] = React.useState(false)
  const mainRef = React.useRef<HTMLElement>(null)
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

  React.useLayoutEffect(() => setDrawerOpen(false), [navigationKey])
  React.useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0
  }, [scrollResetKey])

  const select = (id: string) => {
    onSelect(id)
    setDrawerOpen(false)
  }

  const selectGroup = (id: string) => {
    groupNav.onSelectGroup(id)
    setDrawerOpen(false)
  }

  const closeDrawer = () => setDrawerOpen(false)

  const shellGroupNav = { ...groupNav, onSelectGroup: selectGroup }

  return (
    <div className='relative flex h-dvh w-full overflow-hidden bg-sidebar text-text'>
      <div className={cn('flex min-w-0 flex-1 overflow-hidden', framed && 'm-2 rounded-xl frame-shine shadow-(--frame-shadow)')}>
        {/* Desktop sidebar: full nav, or an icon-only group rail while collapsed */}
        {/* The rule keeps the tinted sidebar from bleeding into the canvas (light mode most of all). */}
        <aside className='hidden shrink-0 border-r border-border md:block'>
          {collapsed ? (
            <SidebarRail {...shellGroupNav} onHomeClick={closeDrawer} onExpand={() => setCollapsed(false)} storagePrefix={storagePrefix} framed={framed} />
          ) : (
            <Sidebar
              {...shellGroupNav}
              items={items}
              activeId={activeId}
              onSelect={select}
              onCollapse={() => setCollapsed(true)}
              groupAction={groupAction}
              storagePrefix={storagePrefix}
              framed={framed}
              onHomeClick={closeDrawer}
            />
          )}
        </aside>

        {/* Mobile off-canvas drawer */}
        {drawerOpen && (
          <div className='fixed inset-0 z-40 md:hidden'>
            <button
              type='button'
              aria-label='Close menu'
              className='absolute inset-0 bg-text/30'
              onClick={() => setDrawerOpen(false)}
            />
            <div className='absolute inset-y-0 left-0 shadow-(--shadow-md)'>
              <Sidebar
                className='border-r border-border'
                {...shellGroupNav}
                items={items}
                activeId={activeId}
                onSelect={select}
                groupAction={groupAction}
                storagePrefix={storagePrefix}
                framed={framed}
                onHomeClick={closeDrawer}
              />
            </div>
          </div>
        )}

        {/* Main canvas. The ordinary shell stays flat; the frame appears when the aside is open. */}
        <div className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
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
              {/* Below sm the drawer carries the brand; the bar keeps its room for the page name. */}
              <span className='hidden sm:inline md:hidden'>
                <Wordmark size='small' />
              </span>
            </>
          }
          trailing={trailing}
        />

        <div className='relative flex min-h-0 flex-1 overflow-hidden bg-bg'>
          <main ref={mainRef} inert={mainInert} className='min-h-0 min-w-0 flex-1 overflow-y-auto'>
            <TopBarSlotProvider node={topBarSlot.node} centerNode={topBarCenter.node}>
              {children}
            </TopBarSlotProvider>
          </main>
        </div>
        </div>
      </div>
      {/* App extensions such as Assistant live outside the frame, like a workspace utility pane. */}
      {aside}
    </div>
  )
}
