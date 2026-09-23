import * as React from 'react'
import { Check, ChevronRight, ChevronsUpDown } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../components/Popover.tsx'

export interface CrumbMenuItem {
  label: string
  value: string
  current?: boolean
  onSelect: () => void
}

export interface Crumb {
  /** Stable route or record identity used to reset rename/menu state when the crumb's subject changes. */
  key?: React.Key
  label: string
  onClick?: () => void
  /** When set (typically on the last crumb), the crumb renders as a quick-switch dropdown. */
  menu?: CrumbMenuItem[]
  /**
   * When set, the crumb IS the record's name field: click to edit, commit on blur or Enter. For a
   * detail view whose page header has been retired - the crumb is already the only place the name
   * appears, and a second copy of it in the surface below was the thing being deleted.
   */
  onRename?: (next: string) => void
}

export interface TopBarContent {
  crumbs: Crumb[]
  actions?: React.ReactNode
}

// Single top bar (ported from claudepad): breadcrumbs on the left, app actions on
// the right; app-chrome (mobile menu, appearance) injected via leading/trailing.
//
// `slotRef` marks where a VIEW's own primary actions land ("New initiative"). They used to sit in a
// page heading the view drew below the bar; the heading is gone, and `TopBarActions` portals them
// up here instead (see `TopBarActions.tsx`).
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
  return (
    <header className='border-b border-border bg-bg/90 backdrop-blur supports-[backdrop-filter]:bg-bg/75'>
      <div className='relative flex h-14 items-center gap-2 px-4'>
        {leading}
        {content && <Breadcrumbs crumbs={content.crumbs} />}
        <div className='min-w-0 flex-1' />
        {/* Centred on the BAR, not on the space left over between the crumbs and the controls -
            those two are different widths on every page, so a flex-centred switcher would drift as
            a sprint title got longer. Absolute keeps it put; `pointer-events-none` on the wrapper
            means the empty space either side of it never eats a click meant for the bar. */}
        <div
          ref={centerSlotRef}
          className='pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 empty:hidden [&>*]:pointer-events-auto'
        />
        {content?.actions && <div className='flex items-center gap-1.5'>{content.actions}</div>}
        <div ref={slotRef} className='flex items-center gap-1.5 empty:hidden' />
        {trailing}
      </div>
    </header>
  )
}

function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label='Breadcrumb' className='flex min-w-0 items-center gap-1.5 text-body-sm'>
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1
        return (
          <React.Fragment key={crumb.key ?? `${crumb.label}-${i}`}>
            {i > 0 && <ChevronRight className='size-3.5 shrink-0 text-muted-foreground' />}
            {crumb.menu && crumb.menu.length > 0 && crumb.onRename ? (
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
            ) : crumb.onClick ? (
              <button
                type='button'
                onClick={crumb.onClick}
                className='shrink-0 text-muted-foreground transition-colors hover:text-text'>
                {crumb.label}
              </button>
            ) : (
              <span className='shrink-0 text-muted-foreground'>{crumb.label}</span>
            )}
          </React.Fragment>
        )
      })}
    </nav>
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
          <button
            key={item.value}
            type='button'
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
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}
