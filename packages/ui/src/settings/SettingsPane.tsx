// The settings detail pane and the pieces every settings section is built from (2026-10-10).
//
// A settings section is a canvas, not a stack of cards: a fixed title bar, one scrolling surface,
// and a fixed footer for the section's primary actions. Lists are full-bleed rows with hairline
// rules; forms are labelled fields on a grid; groups are separated by a ruled heading. Contained
// surfaces are reserved for short callouts that need separation.
//
// These are the frame and the vocabulary only. What a row shows, which actions the footer carries
// and what a field edits stay with the section that owns them.

import * as React from 'react'
import { ChevronRight, X } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { InlineCrumbProvider, type InlineCrumb, type InlineCrumbHost } from '../components/InlineDialog.tsx'

/** The horizontal gutter every settings surface shares: title bar, intro, list rows, footer. */
export const SETTINGS_GUTTER = 'px-4 md:px-6'

/** The text input treatment settings forms use. */
export const settingsInputCls =
  'w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-body-sm text-text transition-colors hover:border-accent/40 focus:border-accent focus:outline-none'

/** A footer, or a function of whether content continues underneath it (to fade only then). */
export type SettingsFooter = React.ReactNode | ((shadowed: boolean) => React.ReactNode)

/** Footers are kept per publisher in publish order; the pane shows the newest. A list publishes
 *  its create button, the editor that replaces it publishes Save, a confirmation over that its own
 *  answer; each removal hands the bar back to the one underneath. */
type FooterHost = (key: object, footer: SettingsFooter | null) => void
const SettingsFooterContext = React.createContext<FooterHost | null>(null)

/** Publish this section's footer to the pane while mounted. Pass `null` to publish nothing. */
export function useSettingsFooter(footer: SettingsFooter | null, deps: React.DependencyList) {
  const host = React.useContext(SettingsFooterContext)
  if (!host) throw new Error('useSettingsFooter must be used inside a SettingsPane.')
  usePublishFooter(host, footer, deps)
}

function usePublishFooter(host: FooterHost | null, footer: SettingsFooter | null, deps: React.DependencyList) {
  const key = React.useRef({}).current
  React.useEffect(() => {
    if (!host) return
    host(key, footer)
    // The caller names what the footer depends on, like useMemo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, footer === null, ...deps])
  React.useEffect(() => (host ? () => host(key, null) : undefined), [host, key])
}

/**
 * The action row at the bottom of an editor or confirmation. Inside a SettingsPane it is pinned to
 * the pane's footer, so the actions stay in reach however long the form is; anywhere else it is a
 * plain right-aligned row. A submit button rendered here sits outside its form's DOM, so give it
 * `form='<form id>'`.
 */
export function SettingsActions({ className, children }: { className?: string; children: React.ReactNode }) {
  const host = React.useContext(SettingsFooterContext)
  usePublishFooter(
    host,
    host ? (shadowed) => <SettingsFooterBar shadowed={shadowed} className={className}>{children}</SettingsFooterBar> : null,
    [children, className],
  )
  return host ? null : <div className={cn('flex items-center justify-end gap-2', className)}>{children}</div>
}

function EdgeFade({ edge, visible }: { edge: 'top' | 'bottom'; visible: boolean }) {
  return (
    <div
      aria-hidden='true'
      className={cn(
        'pointer-events-none absolute inset-x-0 h-8 transition-opacity duration-200',
        edge === 'top' ? 'top-full' : 'bottom-full',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      style={{ background: `linear-gradient(to ${edge === 'top' ? 'bottom' : 'top'}, var(--surface) 0%, transparent 100%)` }}
    />
  )
}

/**
 * The detail pane: a fixed title bar with Close, one scrolling surface, and the footer slot a
 * section fills with `useSettingsFooter`. The bars fade in a shadow only while content continues
 * under that edge.
 *
 * An inline editor opened inside it (an `InlineDialog` under an `InlineDialogScope`) shows as a
 * breadcrumb in the title bar - "Users › Toby" - and the section title becomes the way back.
 */
export function SettingsPane({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  const mainRef = React.useRef<HTMLDivElement>(null)
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const [edges, setEdges] = React.useState({ above: false, below: false })
  const footers = React.useRef(new Map<object, SettingsFooter>())
  const [, setFooterVersion] = React.useState(0)
  const publish = React.useCallback<FooterHost>((key, next) => {
    if (next === null) footers.current.delete(key)
    else footers.current.set(key, next)
    setFooterVersion((v) => v + 1)
  }, [])
  const footer = [...footers.current.values()].at(-1) ?? null

  // Crumbs are kept per editor in open order; the title bar shows the newest. Only its title is
  // state: Back reads the current entry at click time, so it never calls a stale close.
  const crumbs = React.useRef(new Map<object, InlineCrumb>())
  const [crumb, setCrumb] = React.useState<{ key: object; title: React.ReactNode; trail: React.ReactNode[] } | null>(null)
  const crumbHost = React.useCallback<InlineCrumbHost>((key, next) => {
    if (next) crumbs.current.set(key, next)
    else crumbs.current.delete(key)
    const last = [...crumbs.current.entries()].at(-1)
    setCrumb((prev) => {
      if (!last) return null
      const trail = (last[1].trail ?? []).map((t) => t.title)
      const same = prev && prev.key === last[0] && prev.title === last[1].title && prev.trail.length === trail.length && prev.trail.every((t, i) => t === trail[i])
      return same ? prev : { key: last[0], title: last[1].title, trail }
    })
  }, [])
  const current = () => (crumb ? crumbs.current.get(crumb.key) : undefined)
  const toRoot = () => {
    const c = current()
    ;(c?.onRoot ?? c?.onBack)?.()
  }
  const crumbBtn = 'rounded-sm text-muted-foreground transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
  const sep = <li aria-hidden='true' className='shrink-0 text-fg-4'><ChevronRight className='size-4' /></li>

  const measure = React.useCallback(() => {
    const main = mainRef.current
    if (!main) return
    const next = { above: main.scrollTop > 0, below: main.scrollTop + main.clientHeight < main.scrollHeight - 1 }
    setEdges((prev) => (prev.above === next.above && prev.below === next.below ? prev : next))
  }, [])

  // Both boxes are observed: the pane resizing, and its content growing (data arriving, rows wrapping).
  React.useEffect(() => {
    measure()
    const observer = new ResizeObserver(measure)
    if (mainRef.current) observer.observe(mainRef.current)
    if (bodyRef.current) observer.observe(bodyRef.current)
    return () => observer.disconnect()
  }, [measure])

  return (
    <SettingsFooterContext.Provider value={publish}>
      <InlineCrumbProvider host={crumbHost}>
      <div className='flex h-full min-h-0 flex-col overflow-hidden bg-surface'>
        <header className={cn('relative z-10 flex h-16 shrink-0 items-center gap-4 bg-surface', SETTINGS_GUTTER)}>
          {crumb ? (
            <nav aria-label='Breadcrumb' className='min-w-0'>
              <ol className='flex min-w-0 items-center gap-1.5 font-serif text-lg'>
                <li className='shrink-0'>
                  <button type='button' onClick={toRoot} className={crumbBtn}>
                    {title}
                  </button>
                </li>
                {sep}
                {crumb.trail.map((t, i) => (
                  <React.Fragment key={i}>
                    <li className='min-w-0 max-w-[14rem] truncate'>
                      <button type='button' onClick={() => current()?.trail?.[i]?.onSelect()} className={cn(crumbBtn, 'max-w-full truncate')}>
                        {t}
                      </button>
                    </li>
                    {sep}
                  </React.Fragment>
                ))}
                <li className='min-w-0'>
                  <h1 aria-current='page' className='truncate text-text'>{crumb.title}</h1>
                </li>
              </ol>
            </nav>
          ) : (
            <h1 className='font-serif text-lg text-text'>{title}</h1>
          )}
          <button
            type='button'
            aria-label='Close settings'
            onClick={onClose}
            className='ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-text'>
            <X className='size-4' />
          </button>
          <EdgeFade edge='top' visible={edges.above} />
        </header>
        <main ref={mainRef} data-settings-main className='settings-detail-main min-h-0 flex-1 overflow-y-auto bg-surface' onScroll={measure}>
          <div ref={bodyRef} className='min-h-full'>{children}</div>
        </main>
        {typeof footer === 'function' ? footer(edges.below) : footer}
      </div>
      </InlineCrumbProvider>
    </SettingsFooterContext.Provider>
  )
}

/** The fixed bottom bar for a section's primary actions. Pass the `shadowed` flag the footer gets. */
export function SettingsFooterBar({ shadowed, className, children }: { shadowed: boolean; className?: string; children: React.ReactNode }) {
  return (
    <footer className={cn('relative z-10 flex shrink-0 items-center justify-end gap-2 bg-surface py-4', SETTINGS_GUTTER, className)}>
      <EdgeFade edge='bottom' visible={shadowed} />
      {children}
    </footer>
  )
}

/** The section's one-paragraph explanation, under the title bar. */
export function SettingsIntro({ children, aside, className }: { children: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 pb-4', SETTINGS_GUTTER, className)}>
      <p className='min-w-0 flex-1 basis-80 text-body-sm text-muted-foreground'>{children}</p>
      {aside && <div className='flex shrink-0 items-center gap-2'>{aside}</div>}
    </div>
  )
}

/** A group inside a section: a hairline rule, an uppercase label and an optional aside (a count, a
 *  reset button), then the group's content. */
export function SettingsGroup({ title, aside, className, children }: { title: React.ReactNode; aside?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn('flex flex-col gap-4', className)}>
      <div className='flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border pt-4'>
        <h2 className='text-label uppercase tracking-[0.07em] text-muted-foreground'>{title}</h2>
        {aside && <div className='flex items-center gap-2'>{aside}</div>}
      </div>
      {children}
    </section>
  )
}

/** A labelled field: label, the control, and an optional hint line under it. */
export function SettingsField({ label, hint, className, children }: { label: React.ReactNode; hint?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1 text-label text-muted-foreground', className)}>
      <span className='flex flex-wrap items-baseline gap-x-2'>{label}</span>
      {children}
      {hint && <span className='text-fg-4'>{hint}</span>}
    </label>
  )
}

/** The identity header of a person-shaped editor (Profile, a user): avatar, name, a meta line. */
export function SettingsIdentity({ avatar, title, meta }: { avatar: React.ReactNode; title: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <section className='relative overflow-hidden rounded-xl bg-gradient-to-br from-accent/20 via-accent/10 to-transparent px-5 py-6 sm:px-6'>
      <div aria-hidden='true' className='absolute -top-12 -right-10 size-40 rounded-full bg-accent/15 blur-2xl' />
      <div className='relative flex items-center gap-4'>
        <div className='shrink-0'>{avatar}</div>
        <div className='min-w-0'>
          <p className='truncate font-serif text-display-sm text-text'>{title}</p>
          {meta && <div className='mt-0.5 flex flex-wrap items-center gap-2 text-body-sm text-muted-foreground'>{meta}</div>}
        </div>
      </div>
    </section>
  )
}

/** A full-bleed list of rows ruled top and bottom. Rows are `SettingsListRow`s. */
export function SettingsList({ label, className, children }: { label?: string; className?: string; children: React.ReactNode }) {
  return <ul aria-label={label} className={cn('flex flex-col border-t border-border', className)}>{children}</ul>
}

/** The label over a full-bleed list that is not the section's first (in the gutter, no rule: the
 *  list's own top rule follows it). */
export function SettingsListHeading({ title, aside, className }: { title: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-8 items-end justify-between gap-3 pt-8 pb-2', SETTINGS_GUTTER, className)}>
      <h2 className='text-label uppercase tracking-[0.07em] text-muted-foreground'>{title}</h2>
      {aside && <div className='flex items-center gap-2'>{aside}</div>}
    </div>
  )
}

/** A list's column-header row: the same grid as its rows (pass the template through `className`). */
export function SettingsListHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <li aria-hidden='true' className={cn('grid items-center gap-3 border-b border-border py-2 text-label font-medium text-muted-foreground', SETTINGS_GUTTER, className)}>
      {children}
    </li>
  )
}

/**
 * One row. The caller supplies the column template through `className` (a grid) so a section's
 * rows and its header or create row line up. With `onOpen` the whole row is a button that opens
 * the item; controls inside it should stop propagation.
 */
export function SettingsListRow({ onOpen, label, className, children }: { onOpen?: () => void; label?: string; className?: string; children: React.ReactNode }) {
  return (
    <li
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={label}
      onClick={onOpen}
      onKeyDown={onOpen ? (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen() } } : undefined}
      className={cn(
        'grid min-h-14 items-center gap-3 border-b border-border py-2.5 transition-colors',
        SETTINGS_GUTTER,
        onOpen && 'cursor-pointer hover:bg-accent-tint/50 focus-visible:bg-accent-tint/50 focus-visible:outline-none',
        className,
      )}>
      {children}
    </li>
  )
}

/** The quiet square icon button rows use for their trailing actions. */
export const settingsRowActionCls =
  'inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent-tint hover:text-accent disabled:pointer-events-none disabled:opacity-50'
