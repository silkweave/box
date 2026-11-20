import * as React from 'react'
import { Check, ChevronRight, ChevronsUpDown, Info, MoreHorizontal } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../components/Popover.tsx'
import { NavAnchor } from '../components/NavAnchor.tsx'

export interface CrumbMenuItem {
  label: string
  value: string
  current?: boolean
  onSelect: () => void
  /** The item's URL; makes it a real link so modified clicks open it in a new tab or window. */
  href?: string
}

export interface Crumb {
  /** Stable route or record identity used to reset rename/menu state when the crumb's subject changes. */
  key?: React.Key
  label: string
  onClick?: () => void
  /** The crumb's URL; makes a clickable crumb a real link so modified clicks open a new tab. */
  href?: string
  /** When set (typically on the last crumb), the crumb renders as a quick-switch dropdown. */
  menu?: CrumbMenuItem[]
  /**
   * When set, the crumb IS the record's name field: click to edit, commit on blur or Enter. For a
   * detail view whose page header has been retired - the crumb is already the only place the name
   * appears, and a second copy of it in the surface below was the thing being deleted.
   */
  onRename?: (next: string) => void
  /** Context for the crumb (a record's description), behind an info icon beside it. Lets a view drop
   *  its own title and description row: the crumb names the record, the icon explains it. */
  info?: React.ReactNode
}

export interface TopBarContent {
  crumbs: Crumb[]
  actions?: React.ReactNode
}

// A view's actions (its own and the ones `TopBarActions` portals in) share one region. The bar is a
// container: it narrows with the sidebar and split panes, not only with the window, so its rules ask
// the bar's width (`@max-2xl/topbar`), never the viewport's. When the actions do not fit beside the
// crumbs and the shell controls, they move behind a "More actions" button into a panel under the
// bar: the same nodes (portals keep their target), so nothing is dropped and nothing paints over
// the account and Work controls. The vertical padding keeps focus rings inside the box.
const actionsRow = 'flex w-max items-center gap-1.5 py-1 [&>*]:shrink-0'

// A pointer down inside a floating popup (a select's list, a menu) opened from an action is not
// "outside" the panel: closing would hide the popup's anchor mid-choice.
const insidePopup = (el: Element): boolean => el.closest('[data-side],[role="listbox"],[role="menu"],[role="dialog"]') != null

const MORE_WIDTH = 32

type CenterMode = 'center' | 'row' | 'below'

/**
 * How the bar lays out, measured on the bar's own width: whether the view's actions fit inline
 * (else they go behind "More actions"), and where a view switcher goes: centred on the bar while
 * the crumbs on its left and the controls on its right clear it, else in the row beside the
 * actions, else on a second row under the bar.
 */
function useBarLayout(
  bar: React.RefObject<HTMLDivElement | null>,
  row: React.RefObject<HTMLDivElement | null>,
  center: React.RefObject<HTMLDivElement | null>,
  leading: React.RefObject<HTMLDivElement | null>,
  trailing: React.RefObject<HTMLDivElement | null>,
): { fits: boolean; center: CenterMode } {
  const [layout, setLayout] = React.useState<{ fits: boolean; center: CenterMode }>({ fits: true, center: 'center' })
  React.useLayoutEffect(() => {
    const el = bar.current
    const actions = row.current
    if (!el || !actions) return
    const check = () => {
      const style = getComputedStyle(el)
      const gap = parseFloat(style.columnGap) || 0
      const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const nav = el.querySelector<HTMLElement>(':scope > nav')
      // The crumbs keep up to a third of the bar (their natural width if less).
      const crumbs = nav ? Math.min(nav.scrollWidth, inner * 0.35) : 0
      const leadW = leading.current?.offsetWidth ?? 0
      const trailW = trailing.current?.offsetWidth ?? 0
      // The switcher's own width (its children), not its box: on the second row the box is full width.
      const kids = center.current ? [...center.current.children] as HTMLElement[] : []
      const c = kids.reduce((n, k) => n + k.offsetWidth, 0) + Math.max(0, kids.length - 1) * gap
      const need = actions.scrollWidth
      // Everything in the row but the actions, with the gaps between items.
      const fixed = leadW + crumbs + trailW + gap * ((leadW ? 1 : 0) + (nav ? 1 : 0) + (trailW ? 1 : 0))
      const room = inner - fixed
      if (c === 0) return setLayout({ fits: need === 0 || need <= room, center: 'center' })
      // Centred: the left side and the right side each have half the bar minus half the switcher.
      const side = inner / 2 - c / 2 - gap
      const leftClear = leadW + (leadW ? gap : 0) + crumbs <= side
      const rightClear = (w: number) => trailW + (trailW ? gap : 0) + w <= side
      // Where the switcher goes when the right side is `w` wide.
      const place = (w: number): CenterMode => (leftClear && rightClear(w) ? 'center' : c + gap + w <= room ? 'row' : 'below')
      if (need === 0) return setLayout({ fits: true, center: place(0) })
      if (leftClear && rightClear(need)) return setLayout({ fits: true, center: 'center' })
      if (need + c + gap <= room) return setLayout({ fits: true, center: 'row' })
      setLayout({ fits: false, center: place(MORE_WIDTH) })
    }
    check()
    const observer = new ResizeObserver(check)
    for (const r of [el, actions, center.current, leading.current, trailing.current]) if (r) observer.observe(r)
    const nav = el.querySelector(':scope > nav')
    if (nav) observer.observe(nav)
    // Portalled actions and switchers arrive after mount and change without resizing the bar.
    const mutations = new MutationObserver(check)
    for (const r of [actions, center.current]) if (r) mutations.observe(r, { childList: true, subtree: true, characterData: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
  }, [bar, row, center, leading, trailing])
  return layout
}

/**
 * Single top bar (ported from claudepad): breadcrumbs on the left (links, quick-switch menus, rename
 * in place, info), actions on the right; app chrome comes in through `leading` and `trailing`.
 * Use it through `AppShell`, which fills it from `topbar`; views do not render it.
 * Not the way for a view to add its actions: `slotRef` marks where `TopBarActions` portals them
 * ("New initiative") and `centerSlotRef` where `TopBarCenter` puts a view switcher.
 * Not for a page title inside the canvas (`PageHeader`).
 * Rules: when a view's actions do not fit the bar's width (a narrow window, the sidebar open, a split
 * pane), they move behind a "More actions" button, and a centred view switcher that would collide
 * joins the row; a view never adds margins or drops actions to make room.
 */
export function TopBar({
  content,
  leading,
  trailing,
  slotRef,
  centerSlotRef,
}: {
  content?: TopBarContent
  leading?: React.ReactNode
  trailing?: React.ReactNode
  slotRef?: (el: HTMLDivElement | null) => void
  centerSlotRef?: (el: HTMLDivElement | null) => void
}) {
  const barRef = React.useRef<HTMLDivElement>(null)
  const rowRef = React.useRef<HTMLDivElement>(null)
  const leadingRef = React.useRef<HTMLDivElement>(null)
  const trailingRef = React.useRef<HTMLDivElement>(null)
  const moreRef = React.useRef<HTMLButtonElement>(null)
  const centerRef = React.useRef<HTMLDivElement | null>(null)
  const setCenter = React.useCallback((el: HTMLDivElement | null) => {
    centerRef.current = el
    centerSlotRef?.(el)
  }, [centerSlotRef])
  const panelId = React.useId()
  const { fits, center } = useBarLayout(barRef, rowRef, centerRef, leadingRef, trailingRef)
  const [open, setOpen] = React.useState(false)
  const shown = fits || open
  React.useEffect(() => {
    if (fits) setOpen(false)
  }, [fits])
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element
      if (rowRef.current?.contains(t) || moreRef.current?.contains(t) || insidePopup(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      setOpen(false)
      moreRef.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  // A plain action (not one that opens its own popup) closes the panel once used; focus goes back
  // to More actions rather than staying in content that is now hidden.
  const onRowClick = (e: React.MouseEvent) => {
    if (fits) return
    const hit = (e.target as Element).closest('button,a')
    if (hit && !hit.hasAttribute('aria-haspopup') && !hit.hasAttribute('aria-expanded')) {
      setOpen(false)
      requestAnimationFrame(() => {
        if (!document.activeElement || document.activeElement === document.body || rowRef.current?.contains(document.activeElement)) moreRef.current?.focus()
      })
    }
  }
  return (
    <header className='relative z-20 border-b border-border bg-bg/90 backdrop-blur supports-[backdrop-filter]:bg-bg/75'>
      {/* On a narrow bar the switcher wraps onto a second row (`below`): the bar grows, nothing overlaps. */}
      <div ref={barRef} className={cn('@container/topbar relative flex items-center gap-2 px-4', center === 'below' ? 'min-h-14 flex-wrap py-2.5' : 'h-14')}>
        {leading && <div ref={leadingRef} className='flex shrink-0 items-center'>{leading}</div>}
        {content && <Breadcrumbs crumbs={content.crumbs} />}
        <div className='min-w-0 flex-1' />
        {/* Centred on the BAR, not on the space left over between the crumbs and the controls -
            those two are different widths on every page, so a flex-centred switcher would drift as
            a sprint title got longer. Absolute keeps it put; `pointer-events-none` on the wrapper
            means the empty space either side of it never eats a click meant for the bar. When it
            would collide it joins the row, or wraps to a second row (`useBarLayout`). */}
        <div
          ref={setCenter}
          className={cn(
            'flex items-center gap-1.5 empty:hidden',
            center === 'row' && 'shrink-0',
            center === 'below' && 'order-last basis-full justify-center pt-1',
            center === 'center' && 'pointer-events-none absolute left-1/2 -translate-x-1/2 [&>*]:pointer-events-auto',
          )}
        />
        {/* Before the panel, so Tab moves from the button into the actions it revealed. */}
        {!fits && (
          <button
            ref={moreRef}
            type='button'
            aria-label='More actions'
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((o) => !o)}
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent-tint hover:text-text focus-visible:outline-2 focus-visible:outline-ring',
              open && 'bg-accent-tint text-text',
            )}>
            <MoreHorizontal className='size-4' />
          </button>
        )}
        {/* In the bar while it fits; otherwise laid out off-flow (still measured) and shown as the
            panel under the bar while open. Invisible content is neither focusable nor clickable. */}
        <div
          id={panelId}
          role={fits ? undefined : 'group'}
          aria-label={fits ? undefined : 'View actions'}
          onClick={onRowClick}
          className={cn(
            fits ? 'min-w-0' : 'absolute top-full right-2 z-30 mt-1 max-w-[calc(100%-1rem)] overflow-x-auto rounded-lg border border-border bg-surface px-2 py-1 shadow-(--shadow-md)',
            !shown && 'invisible',
          )}>
          <div ref={rowRef} className={actionsRow}>
            {content?.actions}
            <div ref={slotRef} className='flex items-center gap-1.5 empty:hidden [&>*]:shrink-0' />
          </div>
        </div>
        {trailing && <div ref={trailingRef} className='flex shrink-0 items-center gap-1.5'>{trailing}</div>}
      </div>
    </header>
  )
}

function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    // In a narrow bar only the last crumb shows, truncated, and it keeps its room ahead of a view's
    // actions (which scroll instead): a nav that overflows its box paints over the controls beside it.
    <nav
      aria-label='Breadcrumb'
      className='flex min-w-0 items-center gap-1.5 overflow-hidden text-body-sm @max-2xl/topbar:max-w-[35%] @max-2xl/topbar:shrink-0 @max-2xl/topbar:[&>:not(:last-child)]:hidden'>
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1
        const body =
            crumb.menu && crumb.menu.length > 0 && crumb.onRename ? (
              // Both: the crumb IS the name field, and the chevron beside it jumps to a sibling.
              // Renaming and navigating are different verbs, so they get different targets rather
              // than one control that does whichever you did not mean.
              <span className='flex min-w-0 items-center'>
                <CrumbRename crumb={crumb} onRename={crumb.onRename} />
                <CrumbMenu crumb={crumb} current={last} triggerOnly />
              </span>
            ) : crumb.menu && crumb.menu.length > 0 ? (
              <CrumbMenu crumb={crumb} current={last} />
            ) : crumb.onRename ? (
              <CrumbRename crumb={crumb} onRename={crumb.onRename} />
            ) : last ? (
              <span className='truncate font-medium text-text' aria-current='page'>
                {crumb.label}
              </span>
            ) : crumb.onClick || crumb.href ? (
              <NavAnchor
                href={crumb.href}
                onClick={crumb.onClick}
                className='shrink-0 text-muted-foreground transition-colors hover:text-text'>
                {crumb.label}
              </NavAnchor>
            ) : (
              <span className='shrink-0 text-muted-foreground'>{crumb.label}</span>
            )
        return (
          <React.Fragment key={crumb.key ?? `${crumb.label}-${i}`}>
            {i > 0 && <ChevronRight className='size-3.5 shrink-0 text-muted-foreground' />}
            {/* One box with its info icon, so the narrow rule (last child only) keeps both. */}
            {crumb.info ? (
              <span className='flex min-w-0 items-center gap-0.5'>
                {body}
                <CrumbInfo label={crumb.label}>{crumb.info}</CrumbInfo>
              </span>
            ) : (
              body
            )}
          </React.Fragment>
        )
      })}
    </nav>
  )
}

/** The info icon beside a crumb: opens on hover, focus or click, so it also works on touch. */
function CrumbInfo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        aria-label={`About ${label}`}
        className='grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-ring'>
        <Info className='size-3.5' />
      </PopoverTrigger>
      <PopoverContent align='start' className='w-80 gap-2 text-body-sm'>
        {children}
      </PopoverContent>
    </Popover>
  )
}

/**
 * A crumb you can rename in place. Sized to its own text so it never draws a full-width field
 * across the bar: the input is laid over a hidden span holding the same string, which is the only
 * way to make an input shrink-wrap its content.
 */
function CrumbRename({ crumb, onRename }: { crumb: Crumb; onRename: (next: string) => void }) {
  const [value, setValue] = React.useState(crumb.label)
  // The record is the truth - a rename from anywhere else (another tab, MCP) lands here.
  React.useEffect(() => setValue(crumb.label), [crumb.label])

  const commit = (next: string): void => {
    const trimmed = next.trim()
    if (!trimmed || trimmed === crumb.label) return setValue(crumb.label)
    onRename(trimmed)
  }

  return (
    <span className='relative inline-grid min-w-0 items-center'>
      {/* The sizer: same text, same type ramp, same box, invisible - it gives the grid cell its
          width. It carries the input's transparent BORDER too, or the cell comes out 2px narrow and
          a long name loses its last character to the ellipsis. */}
      <span className='invisible col-start-1 row-start-1 border border-transparent px-1.5 font-medium whitespace-pre' aria-hidden>
        {value || crumb.label}
      </span>
      <input
        value={value}
        aria-label={`Rename ${crumb.label}`}
        aria-current='page'
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setValue(crumb.label)
            e.currentTarget.blur()
          }
        }}
        className='col-start-1 row-start-1 w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 font-medium text-text outline-none transition-colors hover:border-border-light hover:bg-accent-tint focus:border-accent focus:bg-bg'
      />
    </span>
  )
}

/** A crumb that opens a quick-switch dropdown (e.g. jump between a post's channel siblings). */
function CrumbMenu({ crumb, current, triggerOnly = false }: { crumb: Crumb; current: boolean; triggerOnly?: boolean }) {
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        {...(triggerOnly ? { 'aria-label': `Switch from ${crumb.label}`, title: 'Switch to another task' } : {})}
        className={cn(
          'flex min-w-0 items-center gap-1 rounded-md transition-colors hover:text-text',
          // Trigger-only sits next to a rename input that already carries the label, so it is the
          // chevron alone - square, and tucked in tight rather than spanning the name twice.
          triggerOnly ? 'shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent-tint' : '-mx-1 px-1',
          !triggerOnly && (current ? 'font-medium text-text' : 'text-muted-foreground'),
        )}
        aria-current={current && !triggerOnly ? 'page' : undefined}>
        {!triggerOnly && <span className='truncate'>{crumb.label}</span>}
        <ChevronsUpDown className='size-3 shrink-0 text-muted-foreground' />
      </PopoverTrigger>
      <PopoverContent align='start' side='bottom' className='w-56 gap-0 p-1'>
        {crumb.menu!.map((item) => (
          <NavAnchor
            key={item.value}
            href={item.href}
            onClick={() => {
              setOpen(false)
              if (!item.current) item.onSelect()
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-body-sm transition-colors hover:bg-accent-tint hover:text-text',
              item.current ? 'text-text' : 'text-muted-foreground',
            )}>
            <Check className={cn('size-3.5 shrink-0', item.current ? 'opacity-100 text-accent' : 'opacity-0')} />
            <span className='truncate'>{item.label}</span>
          </NavAnchor>
        ))}
      </PopoverContent>
    </Popover>
  )
}
