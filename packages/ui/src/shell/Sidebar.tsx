import { ChevronRight, Cog, EyeOff, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { cn } from '../lib/utils.ts'
import { storageKey } from '../lib/storage.ts'
import { usePersistedState } from '../lib/usePersistedState.ts'
import { Wordmark } from '../brand/Wordmark.tsx'
import { Button } from '../components/Button.tsx'
import { ThemeToggle } from './ThemeToggle'
import { NavAnchor } from '../components/NavAnchor.tsx'
import { PlainHomeLink, useShellExtensions } from './ShellExtensions.tsx'
import { arrangeSidebar, type SidebarCustomization } from './sidebarLayout.ts'
import { SidebarCustomize } from './SidebarCustomize.tsx'

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
  /**
   * The URL this item leads to. When set the row is a real link, so Cmd/Ctrl/Shift/middle click
   * open it in a new tab or window; a plain click still goes through `onSelect`.
   */
  href?: string
}

/** A top-level navigation group = one of the app's views (Signals / Inbox / Automation). */
export interface NavGroup {
  /** False for destinations without sub-navigation. */
  expandable?: boolean
  /** Optional section heading; entries in a section must be contiguous. */
  section?: string
  id: string
  label: string
  icon: NavIcon
  /** The URL of the group's destination; makes the header a real link (see `NavItem.href`). */
  href?: string
}

/** The top-level view switcher, threaded from App through AppShell into the Sidebar. */
export interface GroupNav {
  groups: NavGroup[]
  activeGroup: string
  onSelectGroup: (id: string) => void
  /**
   * The person's own arrangement (order of sections and groups, hidden groups) and its writer. When
   * set, the full sidebar offers a Customize mode; without it the sidebar shows `groups` as given.
   */
  customization?: SidebarCustomization
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
  /** Align the wordmark with the framed top bar when the shell is inset. */
  framed?: boolean
  /** Called when the wordmark link is activated, including navigation to the current URL. */
  onHomeClick?: () => void
}

// Channel-nav sidebar (shell ported from claudepad): wordmark, then a vertical accordion of the
// top-level groups (Signals/Inbox/Automation). The active group automatically reveals its sub-nav
// beneath it; the others collapse to a single header. App chrome sits in a row at the bottom.
export function Sidebar({
  groups: allGroups,
  activeGroup,
  customization,
  onSelectGroup,
  items,
  activeId,
  onSelect,
  onCollapse,
  groupAction,
  storagePrefix,
  className,
  framed = false,
  onHomeClick,
}: SidebarProps) {
  // The wordmark's link home is the app's to define (its router's <Link>), through the shell seam;
  // standalone, a plain anchor to the origin root. Never `#/` - that was hash-router vocabulary.
  const { homeLink: HomeLink = PlainHomeLink, settingsControl: SettingsControl } = useShellExtensions()
  // Folded section headings, by label. A folded section still shows its ACTIVE group, so the
  // sidebar never hides where you are; only the inactive destinations fold away.
  const [foldedSections, setFoldedSections] = usePersistedState<string[]>(
    storageKey(storagePrefix, 'sidebar', 'foldedSections'),
    [],
    (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
  )
  // Keep the active group's whole panel (header plus its open sub-nav) in view when the selection
  // changes, scrolling only as far as needed.
  const activePanel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    activePanel.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [activeGroup, activeId, items.length])
  const [customizing, setCustomizing] = useState(false)
  const { shown: groups, revealed } = arrangeSidebar(allGroups, customization?.layout ?? null, activeGroup)
  const toggleSection = (section: string) =>
    setFoldedSections((prev) => (prev.includes(section) ? prev.filter((x) => x !== section) : [...prev, section]))

  return (
    <nav
      className={cn('flex h-full w-[256px] flex-col bg-sidebar', className)}
      aria-label='Views'>
      {/* In framed mode, mt = the inset frame's top margin (8px) + border (1px), so the wordmark
          row shares the top bar's vertical center and the breadcrumb baseline. */}
      <div className={cn(framed ? 'mt-[9px]' : 'mt-0', 'flex h-14 items-center gap-1 px-3')}>
        <HomeLink className='flex items-center rounded-md' aria-label='Home' onClick={onHomeClick}>
          <Wordmark size='full' />
        </HomeLink>
        {customization &&
          (customizing ? (
            <Button variant='ghost' size='sm' className='ml-auto h-7 px-2 text-label' onClick={() => setCustomizing(false)}>
              Done
            </Button>
          ) : (
            <Button
              variant='ghost'
              size='icon'
              className='ml-auto size-7 text-muted-foreground'
              onClick={() => setCustomizing(true)}
              aria-label='Customize sidebar'
              title='Customize sidebar'>
              <Cog className='size-4' />
            </Button>
          ))}
      </div>

      <div className='flex-1 overflow-x-hidden overflow-y-auto px-2 py-2'>
        {customization && customizing ? (
          <SidebarCustomize groups={allGroups} customization={customization} />
        ) : groups.map((group, index) => {
          const GroupIcon = group.icon
          const isActive = group.id === activeGroup
          const isOpen = group.expandable !== false && isActive && items.length > 0
          const section = group.section
          const folded = section !== undefined && foldedSections.includes(section)
          const startsSection = section !== undefined && section !== groups[index - 1]?.section
          return (
            <div key={group.id}>
              {startsSection && (
                <h2 className={cn('px-1', index > 0 ? 'pt-5' : 'pt-1', 'pb-1.5')}>
                  <button
                    type='button'
                    onClick={() => toggleSection(section)}
                    aria-expanded={!folded}
                    className={cn(
                      'group/sec flex w-full items-center gap-1 rounded-md px-1.5 text-left text-label font-medium text-muted-foreground',
                      'transition-colors duration-[120ms] ease-[var(--ease-standard)] hover:text-text',
                    )}>
                    <span className='flex-1 truncate'>{section}</span>
                    <ChevronRight
                      aria-hidden
                      className={cn(
                        'size-3.5 shrink-0 transition-transform',
                        !folded && 'rotate-90',
                        // Quiet until the heading is hovered or focused, unless folded (the caret is
                        // then the only sign that something is hidden).
                        folded ? 'opacity-100' : 'opacity-0 group-hover/sec:opacity-100 group-focus-visible/sec:opacity-100',
                      )}
                    />
                  </button>
                </h2>
              )}
              {folded && !isActive ? null : (
                <div ref={isActive ? activePanel : undefined} className={cn(
                  // Reserve the panel inset even when closed so activating a group never moves its header.
                  'rounded-lg border p-1',
                  isOpen
                    ? 'border-[var(--sidebar-group-border)] bg-[var(--sidebar-group-bg)] shadow-[0_1px_3px_#00000008]'
                    : 'border-transparent',
                )}>
                  <div
                    className={cn(
                      'group/grp flex w-full items-center rounded-md text-body-sm',
                      'transition-colors duration-[120ms] ease-[var(--ease-standard)]',
                      isActive
                        ? 'bg-[var(--sidebar-group-active-bg)] text-[var(--sidebar-group-active-text)] font-semibold'
                        : 'text-text hover:bg-accent-tint',
                    )}>
                    <NavAnchor
                      href={group.href}
                      onClick={() => onSelectGroup(group.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className='flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-left'>
                      <GroupIcon className={cn('size-4 shrink-0', isActive ? 'text-[var(--sidebar-group-active-icon)]' : 'text-muted-foreground')} />
                      <span className='line-clamp-1 flex-1'>{group.label}</span>
                      {group.id === revealed && (
                        // Hidden from this person's sidebar, shown only while they are here.
                        <span title='Hidden from your sidebar: shown while you are here' className='flex shrink-0'>
                          <EyeOff aria-label='Hidden from your sidebar' className='size-3.5 opacity-70' />
                        </span>
                      )}
                    </NavAnchor>
                    {isActive && groupAction && <span className='mr-1.5 flex shrink-0 items-center'>{groupAction}</span>}
                  </div>

                  {isOpen && (
                    <ul className='mt-1 space-y-1'>
                      {items.map((item, i) => {
                        const Icon = item.icon
                        const active = item.id === activeId
                        const heading = item.section && item.section !== items[i - 1]?.section ? item.section : null
                        return (
                          <li key={item.id}>
                            {heading && (
                              <div
                                className={cn(
                                  'px-2.5 pb-1.5 pt-1 text-label font-medium text-muted-foreground',
                                  i > 0 && 'mt-2 border-t border-border pt-1.5',
                                )}>
                                {heading}
                              </div>
                            )}
                            <NavAnchor
                              href={item.href}
                              onClick={() => onSelect(item.id)}
                              aria-current={active ? 'page' : undefined}
                              className={cn(
                                'group/nav relative flex min-h-9 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-body-sm',
                                'transition-colors duration-[120ms] ease-[var(--ease-standard)]',
                                active
                                  ? 'bg-[var(--sidebar-item-selected)] text-[var(--sidebar-item-selected-text)] font-medium ring-1 ring-inset ring-[var(--sidebar-item-selected-border)]'
                                  : 'text-text hover:bg-[var(--sidebar-item-hover)]',
                              )}>
                              {item.leading ?? (
                                <Icon
                                  className={cn(
                                    'size-4 shrink-0',
                                    item.iconClass ?? (active ? 'text-[var(--sidebar-item-selected-icon)]' : 'text-muted-foreground'),
                                  )}
                                />
                              )}
                              <span className='line-clamp-1 flex-1'>{item.label}</span>
                              {(item.badge ?? item.count) != null && (
                                <span className='text-label text-muted-foreground tabular-nums'>
                                  {item.badge ?? item.count}
                                </span>
                              )}
                            </NavAnchor>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
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
        {SettingsControl && <SettingsControl />}
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
  groups: allGroups,
  activeGroup,
  onSelectGroup,
  customization,
  onExpand,
  storagePrefix,
  framed = false,
  onHomeClick,
}: GroupNav & { onExpand: () => void; storagePrefix?: string; framed?: boolean; onHomeClick?: () => void }) {
  const { homeLink: HomeLink = PlainHomeLink, settingsControl: SettingsControl } = useShellExtensions()
  // The person's arrangement, as in the full sidebar; customizing it is the full sidebar's.
  const groups = arrangeSidebar(allGroups, customization?.layout ?? null, activeGroup).shown
  return (
    <nav className='flex h-full w-12 flex-col items-center bg-sidebar' aria-label='Views'>
      {/* The framed shell has the same 9px offset as the full sidebar. */}
      <div className={cn(framed ? 'mt-[9px]' : 'mt-0', 'flex h-14 items-center')}>
        <HomeLink className='flex rounded-md' aria-label='Home' onClick={onHomeClick}>
          <Wordmark size='mark' />
        </HomeLink>
      </div>
      <div className='flex flex-1 flex-col items-center gap-1 overflow-y-auto py-2'>
        {groups.map((group) => {
          const GroupIcon = group.icon
          const isActive = group.id === activeGroup
          return (
            <NavAnchor
              key={group.id}
              href={group.href}
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
            </NavAnchor>
          )
        })}
      </div>
      {/* The same bottom-left chrome as the full sidebar, stacked instead of in a row. */}
      <div className='flex flex-col items-center gap-2 py-3'>
        {SettingsControl && <SettingsControl />}
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
