import { ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { cn } from '../lib/utils.ts'
import { usePersistedState } from '../lib/usePersistedState.ts'
import { storageKey } from '../lib/storage.ts'
import { Wordmark } from '../brand/Wordmark.tsx'
import { Button } from '../components/Button.tsx'
import { ThemeToggle } from './ThemeToggle'
import { PlainHomeLink, useShellExtensions } from './ShellExtensions.tsx'

/** Any icon component taking a className - lucide and tabler (brand) icons both satisfy this. */
export type NavIcon = ComponentType<{ className?: string }>

/** A sub-nav entry within a group (e.g. a channel under Signals, a section under Automation). */
export interface NavItem {
  id: string
  label: string
  icon: NavIcon
  /** Overrides the default icon coloring (e.g. a content status tone). */
  iconClass?: string
  /**
   * A rendered element to draw INSTEAD of `icon` - an avatar, for a row that is a person rather
   * than a place (a DM in the chat sidebar). A node rather than a second component type because
   * what it needs is per-row data (which user), and `icon` stays required so every row has a
   * fallback if the node is absent.
   */
  leading?: ReactNode
  count?: number
  /** Free-form right-aligned badge (e.g. "1/3" published); takes precedence over `count`. */
  badge?: string
  /**
   * Optional heading this item sits under. A heading is drawn whenever the value CHANGES down the
   * list, so items of one section must be contiguous - which also means a list that sets no section
   * (every sidebar but the CRM's) renders exactly as it always did.
   */
  section?: string
}

/** A top-level collapsible group = one of the app's views (Signals / Inbox / Automation). */
export interface NavGroup {
  id: string
  label: string
  icon: NavIcon
}

/** The top-level view switcher, threaded from App through AppShell into the Sidebar. */
export interface GroupNav {
  groups: NavGroup[]
  activeGroup: string
  onSelectGroup: (id: string) => void
}

interface SidebarProps extends GroupNav {
  /** Sub-nav of the *active* group (only the active group's items are loaded). */
  items: NavItem[]
  activeId: string
  onSelect: (id: string) => void
  /** Collapse the sidebar (desktop); omitted in the mobile drawer. */
  onCollapse?: () => void
  /** Small control rendered at the right of the *active* group's header row (e.g. a filter toggle). */
  groupAction?: React.ReactNode
  /** localStorage namespace for the sidebar's own preferences. Defaults to `ui`. */
  storagePrefix?: string
  className?: string
}

// Channel-nav sidebar (shell ported from claudepad): wordmark, then a vertical accordion of the
// top-level groups (Signals/Inbox/Automation). The active group is expandable and nests its sub-nav
// beneath it; the others collapse to a single header. App chrome sits in a row at the bottom.
export function Sidebar({
  groups,
  activeGroup,
  onSelectGroup,
  items,
  activeId,
  onSelect,
  onCollapse,
  groupAction,
  storagePrefix,
  className,
}: SidebarProps) {
  // Whether the *active* group's sub-nav is expanded. Persisted (survives the per-view remount);
  // selecting a different group re-opens it, clicking the active header toggles it.
  const [expanded, setExpanded] = usePersistedState(
    storageKey(storagePrefix, 'sidebar', 'groupExpanded'),
    true,
    (v) => typeof v === 'boolean',
  )
  // The wordmark's link home is the app's to define (its router's <Link>), through the shell seam;
  // standalone, a plain anchor to the origin root. Never `#/` - that was hash-router vocabulary.
  const { homeLink: HomeLink = PlainHomeLink } = useShellExtensions()

  return (
    <nav
      className={cn('flex h-full w-[256px] flex-col bg-sidebar', className)}
      aria-label='Views'>
      {/* mt = the inset frame's top margin (8px) + border (1px), so the wordmark row shares the
          top bar's vertical center and the breadcrumb baseline. */}
      <div className='mt-[9px] px-3 h-14 flex items-center gap-1'>
        <HomeLink className='flex items-center rounded-md' aria-label='Home'>
          <Wordmark size='full' />
        </HomeLink>
      </div>

      <div className='flex-1 overflow-y-auto px-2 py-2 space-y-0.5'>
        {groups.map((group) => {
          const GroupIcon = group.icon
          const isActive = group.id === activeGroup
          const isOpen = isActive && expanded
          const Chevron = isOpen ? ChevronDown : ChevronRight
          // On the group's index/overview when its view is active but no sub-item matches the selection.
          const onOverview = isActive && !items.some((i) => i.id === activeId)
          return (
            <div key={group.id}>
              {/* Two affordances on one row: the caret toggles expand/collapse (no navigation), the
                  label routes to the group's index - the overview/all page (replacing a sub-item). */}
              <div
                className={cn(
                  'group/grp relative flex w-full items-center rounded-md text-body-sm text-text',
                  'transition-colors duration-[120ms] ease-[var(--ease-standard)] hover:bg-accent-tint',
                  onOverview && 'bg-accent-tint',
                  isActive && 'font-medium',
                )}>
                {onOverview && <span className='absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent' />}
                <button
                  type='button'
                  aria-label={isOpen ? `Collapse ${group.label}` : `Expand ${group.label}`}
                  aria-expanded={isOpen}
                  onClick={() => {
                    if (isActive) setExpanded((e) => !e)
                    else {
                      onSelectGroup(group.id)
                      setExpanded(true)
                    }
                  }}
                  className='flex shrink-0 items-center rounded-md py-1.5 pl-2.5 pr-1 text-muted-foreground transition-colors hover:text-text'>
                  <Chevron className='size-3.5 shrink-0' />
                </button>
                <button
                  type='button'
                  onClick={() => {
                    onSelectGroup(group.id)
                    if (!isActive) setExpanded(true)
                  }}
                  className='flex flex-1 items-center gap-2 rounded-md py-1.5 pr-2.5 text-left'>
                  <GroupIcon className={cn('size-4 shrink-0', isActive ? 'text-accent' : 'text-muted-foreground')} />
                  <span className='line-clamp-1 flex-1'>{group.label}</span>
                </button>
                {isActive && groupAction && <span className='mr-1.5 flex shrink-0 items-center'>{groupAction}</span>}
              </div>

              {isOpen && (
                <ul className='mt-0.5 ml-[0.9375rem] border-l border-border pl-1.5 space-y-0.5'>
                  {items.map((item, i) => {
                    const Icon = item.icon
                    const active = item.id === activeId
                    const heading = item.section && item.section !== items[i - 1]?.section ? item.section : null
                    return (
                      <li key={item.id}>
                        {heading && (
                          <div
                            className={cn(
                              'px-2.5 pb-0.5 text-label text-muted-foreground',
                              i > 0 && 'mt-2 border-t border-border pt-1.5',
                            )}>
                            {heading}
                          </div>
                        )}
                        <button
                          type='button'
                          onClick={() => onSelect(item.id)}
                          className={cn(
                            'group/nav relative flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-left text-body-sm text-text',
                            'transition-colors duration-[120ms] ease-[var(--ease-standard)] hover:bg-accent-tint',
                            active && 'bg-accent-tint font-medium',
                          )}>
                          {active && <span className='absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-accent' />}
                          {item.leading ?? (
                            <Icon
                              className={cn(
                                'size-4 shrink-0',
                                item.iconClass ?? (active ? 'text-accent' : 'text-muted-foreground'),
                              )}
                            />
                          )}
                          <span className='line-clamp-1 flex-1'>{item.label}</span>
                          {(item.badge ?? item.count) != null && (
                            <span className='text-label text-muted-foreground tabular-nums'>
                              {item.badge ?? item.count}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {/* App chrome lives at the BOTTOM LEFT, not in the top bar (2026-08-12). Appearance is a
          preference you set once and then never look at again, and collapsing is a thing you do to
          the sidebar - neither belongs in the top bar, which is prime real estate for the things you
          act on. Every icon parked up there taxed the row the breadcrumbs and the view's own actions
          need. The bottom row used to carry a two-line stats blurb as well ("18 initiatives · 42
          tasks"); it went with the same reasoning - the numbers are on the board you are looking at. */}
      <div className='flex items-center justify-evenly px-3 py-3'>
        <ThemeToggle className='size-8' storageKey={storageKey(storagePrefix, 'theme')} />
        {onCollapse && (
          <Button
            variant='ghost'
            size='icon'
            className='size-8'
            onClick={onCollapse}
            aria-label='Collapse sidebar'
            title='Collapse sidebar'>
            <PanelLeftClose />
          </Button>
        )}
      </div>
    </nav>
  )
}

/** The collapsed sidebar: an icon-only rail of the top-level groups (mark on top, expand at the
 *  bottom). Selecting a group navigates; the rail stays collapsed until expanded explicitly. */
export function SidebarRail({
  groups,
  activeGroup,
  onSelectGroup,
  onExpand,
  storagePrefix,
}: GroupNav & { onExpand: () => void; storagePrefix?: string }) {
  const { homeLink: HomeLink = PlainHomeLink } = useShellExtensions()
  return (
    <nav className='flex h-full w-12 flex-col items-center bg-sidebar' aria-label='Views'>
      {/* Same 9px offset as the full sidebar: keep the mark centered on the top bar row. */}
      <div className='mt-[9px] flex h-14 items-center'>
        <HomeLink className='flex rounded-md' aria-label='Home'>
          <Wordmark size='mark' />
        </HomeLink>
      </div>
      <div className='flex flex-1 flex-col items-center gap-1 overflow-y-auto py-2'>
        {groups.map((group) => {
          const GroupIcon = group.icon
          const isActive = group.id === activeGroup
          return (
            <button
              key={group.id}
              type='button'
              onClick={() => onSelectGroup(group.id)}
              aria-label={group.label}
              aria-current={isActive ? 'page' : undefined}
              title={group.label}
              className={cn(
                'flex size-9 items-center justify-center rounded-md',
                'transition-colors duration-[120ms] ease-[var(--ease-standard)] hover:bg-accent-tint hover:text-text',
                isActive ? 'bg-accent-tint text-accent' : 'text-muted-foreground',
              )}>
              <GroupIcon className='size-4' />
            </button>
          )
        })}
      </div>
      {/* The same bottom-left chrome as the full sidebar, stacked instead of in a row. */}
      <div className='flex flex-col items-center gap-2 py-3'>
        <ThemeToggle className='size-8' storageKey={storageKey(storagePrefix, 'theme')} />
        <Button
          variant='ghost'
          size='icon'
          className='size-8'
          onClick={onExpand}
          aria-label='Expand sidebar'
          title='Expand sidebar'>
          <PanelLeftOpen />
        </Button>
      </div>
    </nav>
  )
}
