// The settings detail pane and the pieces every settings section is built from (2026-10-10).
//
// A settings section is a canvas, not a stack of cards: a fixed title bar, one scrolling surface,
// and a fixed footer for the section's primary actions. Lists are full-bleed rows with hairline
// rules; forms are labelled fields on a grid; groups are separated by a ruled heading. Contained
// surfaces are reserved for short callouts that need separation.
//
// This file is the frame: the pane, its footer bar and the three publish contexts (footer, title bar
// actions, title bar info) the slots in `slots.tsx` write to. The vocabulary lives beside it, one
// file per piece; `index.ts` is the public surface, and the contexts stay internal.
//
// These are the frame and the vocabulary only. What a row shows, which actions the footer carries
// and what a field edits stay with the section that owns them.
//
// The house rules every section follows (2026-11-13):
//   title bar slim: breadcrumbs, the title, the info icon and the section's create actions
//   intro     `SettingsIntro`: one plain sentence, shown in the title bar's info popover with any
//             longer story (`info`); nothing on the canvas
//   actions   a list's create buttons go in the title bar (`SettingsHeaderActions`); a page open
//             over the section owns the bar (its own create buttons show, the section's hide); a form's Save
//             sits in the footer, right-aligned, primary last, Reset or Cancel left of it, a status
//             note at the footer's left; the footer shows only while a form or editor needs it
//   lists     a `DataGrid` (it adapts to the pane: sticky bar and column header, its count in
//             the footer); a row ends in at most one status and one "..." `ActionMenu`; a value
//             every row shares (an "Active" badge, "No email") is left out
//   empty     `SettingsEmpty`: one sentence saying what goes here and how to add the first
//   groups    `SettingsGroup` for a form's parts; a second list is a `section` grid with its title
//   notices   `SettingsNotice` for a state that needs the owner (setup missing, attention)

import * as React from 'react'
import { ChevronRight, Info, X } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { FormColumnContext, SettingsCanvasContext, SettingsDraftContext, SettingsLayerHostContext, leaveState, type DraftHost, type DraftState, type LayerHost, type SettingsLeaveState } from './internal.tsx'
import { InlineCrumbProvider, type InlineCrumb, type InlineCrumbHost } from '../components/InlineDialog.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../components/Popover.tsx'

/** The horizontal gutter every settings surface shares: title bar, intro, list rows, footer. */
export const SETTINGS_GUTTER = 'px-4 md:px-6'

/** A footer, or a function of whether content continues underneath it (to fade only then). */
export type SettingsFooter = React.ReactNode | ((shadowed: boolean) => React.ReactNode)

/** Footers are kept per publisher in publish order; the pane shows the newest. A list publishes
 *  its create button, the editor that replaces it publishes Save, a confirmation over that its own
 *  answer; each removal hands the bar back to the one underneath. */
export type FooterHost = (key: object, footer: SettingsFooter | null) => void
export const SettingsFooterContext = React.createContext<FooterHost | null>(null)

/** Publish a footer to `host` while mounted (internal: `useSettingsFooter`, `SettingsActions`). */
export function usePublishFooter(host: FooterHost | null, footer: SettingsFooter | null, deps: React.DependencyList) {
  const key = React.useRef({}).current
  React.useEffect(() => {
    if (!host) return
    host(key, footer)
    // The caller names what the footer depends on, like useMemo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, footer === null, ...deps])
  React.useEffect(() => (host ? () => host(key, null) : undefined), [host, key])
}

/** The pane's base footer: a list's status row (its count). Any published footer (a Save bar, a
 *  confirmation) replaces it while it is up. Newest publisher wins. */
export const SettingsBaseFooterContext = React.createContext<FooterHost | null>(null)

/** The title bar's actions slot: create buttons of the deepest layer (the section, or the page open
 *  over it), newest publisher of that layer wins. */
export type ActionsHost = (key: object, actions: React.ReactNode | null, layer?: number) => void
export const SettingsActionsContext = React.createContext<ActionsHost | null>(null)

/** The title bar's info slot: one short explanation of the section, behind an info icon. */
export type InfoHost = (key: object, info: React.ReactNode | null) => void
export const SettingsInfoContext = React.createContext<InfoHost | null>(null)

/** The info icon and its popover (internal: the pane's title bar and `SettingsInfo` outside a pane). */
export function SettingsInfoButton({ children }: { children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label='About this section'
        className='inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent-tint hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'>
        <Info className='size-4' />
      </PopoverTrigger>
      <PopoverContent align='start' className='w-80 text-body-sm text-text'>
        {children}
      </PopoverContent>
    </Popover>
  )
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
 *
 * `leaveCheck` is a ref the pane fills with a check of every `useSettingsForm` inside it: `clean`,
 * `dirty` (ask first) or `failed` (a save that was in flight failed: stay, the form says why). It
 * waits for saves in flight. A tab switch the person already confirmed and Cancel count as clean.
 * The app calls it from its router's navigation blocker (Back, Close, a link); the kit never sees
 * the router.
 */
export function SettingsPane({ title, onClose, leaveCheck, children }: {
  title: React.ReactNode
  onClose: () => void
  leaveCheck?: React.RefObject<(() => Promise<SettingsLeaveState>) | null>
  children: React.ReactNode
}) {
  const drafts = React.useRef(new Map<object, DraftState>())
  const draftHost = React.useCallback<DraftHost>((key, state) => {
    if (state === false) drafts.current.delete(key)
    else drafts.current.set(key, state)
  }, [])
  React.useEffect(() => {
    if (!leaveCheck) return
    leaveCheck.current = () => leaveState(() => drafts.current.values())
    return () => { leaveCheck.current = null }
  }, [leaveCheck])
  const { mainRef, bodyRef, edges, measure } = useScrollEdges()
  const footers = React.useRef(new Map<object, SettingsFooter>())
  const [, setFooterVersion] = React.useState(0)
  // The newest published info wins, like footers: a section's own note, or an editor's over it.
  const infos = React.useRef(new Map<object, React.ReactNode>())
  const [info, setInfo] = React.useState<React.ReactNode>(null)
  // Actions are kept per publisher with the layer it sits on: the section is 0, a page over it 1.
  // Open pages register their layer separately, so the deepest open layer owns the bar even when
  // it publishes nothing.
  const actionsMap = React.useRef(new Map<object, { node: React.ReactNode; layer: number }>())
  const layers = React.useRef(new Map<object, number>())
  const [, setActionsVersion] = React.useState(0)
  const publishActions = React.useCallback<ActionsHost>((key, next, layer = 0) => {
    if (next === null) actionsMap.current.delete(key)
    else actionsMap.current.set(key, { node: next, layer })
    setActionsVersion((v) => v + 1)
  }, [])
  const publishLayer = React.useCallback<LayerHost>((key, layer) => {
    if (layer === null) layers.current.delete(key)
    else layers.current.set(key, layer)
    setActionsVersion((v) => v + 1)
  }, [])
  const publishInfo = React.useCallback<InfoHost>((key, next) => {
    if (next === null) infos.current.delete(key)
    else infos.current.set(key, next)
    setInfo([...infos.current.values()].at(-1) ?? null)
  }, [])
  const publish = React.useCallback<FooterHost>((key, next) => {
    if (next === null) footers.current.delete(key)
    else footers.current.set(key, next)
    setFooterVersion((v) => v + 1)
  }, [])
  const baseFooters = React.useRef(new Map<object, SettingsFooter>())
  const publishBase = React.useCallback<FooterHost>((key, next) => {
    if (next === null) baseFooters.current.delete(key)
    else baseFooters.current.set(key, next)
    setFooterVersion((v) => v + 1)
  }, [])
  const footerBelowCrumbs = [...footers.current.values()].at(-1)

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
  // While a page covers the section, the section list's count row is not the page's: hide it.
  const footer = footerBelowCrumbs ?? (crumb ? null : [...baseFooters.current.values()].at(-1)) ?? null
  const current = () => (crumb ? crumbs.current.get(crumb.key) : undefined)
  // The owner of the title bar: the deepest open page, or the section. An editor over it that is not
  // a page (more crumbs than pages) owns it too, with no actions.
  const topLayer = Math.max(0, ...layers.current.values())
  const actions = crumbs.current.size > layers.current.size ? null : ([...actionsMap.current.values()].filter((a) => a.layer === topLayer).at(-1)?.node ?? null)
  const toRoot = () => {
    const c = current()
    ;(c?.onRoot ?? c?.onBack)?.()
  }
  const crumbBtn = 'rounded-sm text-muted-foreground transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
  const sep = <li aria-hidden='true' className='shrink-0 text-fg-4'><ChevronRight className='size-4' /></li>

  return (
    <SettingsFooterContext.Provider value={publish}>
      <SettingsBaseFooterContext.Provider value={publishBase}>
      <SettingsInfoContext.Provider value={publishInfo}>
      <SettingsActionsContext.Provider value={publishActions}>
      <SettingsLayerHostContext.Provider value={publishLayer}>
      <SettingsDraftContext.Provider value={draftHost}>
      <InlineCrumbProvider host={crumbHost}>
      <div className='flex h-full min-h-0 flex-col overflow-hidden bg-surface'>
        <header className={cn('relative z-10 flex h-14 shrink-0 items-center gap-2 bg-surface', SETTINGS_GUTTER)}>
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
          {info != null && <SettingsInfoButton>{info}</SettingsInfoButton>}
          {/* The open page owns the bar: the section's create buttons hide under it, the page's own
              show. An editor over the section that is not a page (no layer) shows none. */}
          <div className='ml-auto flex items-center gap-2'>{actions}</div>
          <button
            type='button'
            aria-label='Close settings'
            onClick={onClose}
            className='rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-text'>
            <X className='size-4' />
          </button>
          <EdgeFade edge='top' visible={edges.above} />
        </header>
        <main ref={mainRef} data-settings-main className='settings-detail-main min-h-0 flex-1 overflow-y-auto bg-surface' onScroll={measure}>
          {/* The canvas: sections stand on it directly, so their pieces bring the gutter and their
              top offset; the canvas gives only the ends. */}
          <div ref={bodyRef} className='flex min-h-full min-w-0 flex-col pt-2 pb-8'>
            <SettingsCanvasContext.Provider value='canvas'>{children}</SettingsCanvasContext.Provider>
          </div>
        </main>
        {typeof footer === 'function' ? footer(edges.below) : footer}
      </div>
      </InlineCrumbProvider>
      </SettingsDraftContext.Provider>
      </SettingsLayerHostContext.Provider>
      </SettingsActionsContext.Provider>
      </SettingsInfoContext.Provider>
      </SettingsBaseFooterContext.Provider>
    </SettingsFooterContext.Provider>
  )
}

/** The fixed bottom bar for a section's primary actions. Pass the `shadowed` flag the footer gets. */
export function SettingsFooterBar({ shadowed, className, children }: { shadowed: boolean; className?: string; children: React.ReactNode }) {
  // On a `RecordPage` the bar spans the page and its buttons line up with the form's column.
  const column = React.useContext(FormColumnContext)
  return (
    <footer className={cn('relative z-10 flex shrink-0 items-center justify-end gap-2 bg-surface py-4', !column && SETTINGS_GUTTER, !column && className)}>
      <EdgeFade edge='bottom' visible={shadowed} />
      {/* The gutter sits inside the capped column, as the groups' gutter does in the body. */}
      {column ? <div className={cn('mx-auto flex w-full min-w-0 items-center justify-end gap-2', column, SETTINGS_GUTTER, className)}>{children}</div> : children}
    </footer>
  )
}

/** The scroll edges of a canvas: whether content continues above and below (to fade the bars). */
export function useScrollEdges(): { mainRef: React.RefObject<HTMLDivElement | null>; bodyRef: React.RefObject<HTMLDivElement | null>; edges: { above: boolean; below: boolean }; measure: () => void } {
  const mainRef = React.useRef<HTMLDivElement>(null)
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const [edges, setEdges] = React.useState({ above: false, below: false })
  const measure = React.useCallback(() => {
    const main = mainRef.current
    if (!main) return
    const next = { above: main.scrollTop > 0, below: main.scrollTop + main.clientHeight < main.scrollHeight - 1 }
    setEdges((prev) => (prev.above === next.above && prev.below === next.below ? prev : next))
  }, [])
  React.useEffect(() => {
    measure()
    const observer = new ResizeObserver(measure)
    if (mainRef.current) observer.observe(mainRef.current)
    if (bodyRef.current) observer.observe(bodyRef.current)
    return () => observer.disconnect()
  }, [measure])
  return { mainRef, bodyRef, edges, measure }
}
