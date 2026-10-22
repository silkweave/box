import { createContext, useContext, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './Dialog.tsx'
import { cn } from '../lib/utils.ts'

const InlineTarget = createContext<{ target: HTMLDivElement | null; enter: () => () => void } | null>(null)
const InlineClose = createContext<(() => void) | null>(null)
export function useInlineDialogTarget() { return useContext(InlineTarget) }

/** An open inline editor as a breadcrumb: its title, and the way back to the list it replaced. */
export interface InlineCrumb {
  title: ReactNode
  onBack: () => void
  /** Pages between the section and this editor (a group, above its member editor), outermost first. */
  trail?: { title: ReactNode; onSelect: () => void }[]
  /** Where the section title leads; defaults to `onBack`. A nested editor sets it to the list. */
  onRoot?: () => void
}

/** Receives the crumbs of open inline editors, keyed per editor; `null` removes one. */
export type InlineCrumbHost = (key: object, crumb: InlineCrumb | null) => void

const InlineCrumbs = createContext<InlineCrumbHost | null>(null)

/**
 * Where a pane shows its editors' breadcrumbs (a settings title bar: "Users › Toby"). Inside one,
 * an inline editor's title becomes the crumb and its Back button is dropped: the crumb's parent
 * link is the way back.
 */
export function InlineCrumbProvider({ host, children }: { host: InlineCrumbHost; children: ReactNode }) {
  return <InlineCrumbs.Provider value={host}>{children}</InlineCrumbs.Provider>
}

/** The nearest ancestor that scrolls vertically: the surface an inline editor shares with its list. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
  }
  return null
}

/**
 * Editors occupy the current pane. The underlying list keeps its state and becomes inert.
 *
 * With `scroll` the list and the editor each get their own scroller, so the list keeps its scroll
 * position for free. Without it both share the ancestor's scroller (a settings pane): the list is
 * then taken out of the layout while an editor is open, so the editor alone sets the height, and
 * the shared scroller starts the editor at the top and returns the list to where it was. Leaving
 * the list in the layout (invisible) kept its height under the editor: a long list scrolled down
 * opened an editor above the viewport, and clicks inside it scrolled into the empty space below.
 */
export function InlineDialogScope({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const [editors, setEditors] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const listScroll = useRef(0)
  const open = useRef(0)
  const enter = useRef(() => {
    // Read the list's position here, while it is still laid out: once it is hidden the shared
    // scroller clamps to the editor's height and the position is gone.
    if (open.current++ === 0) listScroll.current = scrollParent(root.current)?.scrollTop ?? 0
    setEditors((n) => n + 1)
    return () => {
      open.current--
      setEditors((n) => n - 1)
    }
  }).current
  const editing = editors > 0
  const mounted = useRef(false)
  useLayoutEffect(() => {
    if (scroll) return
    const scroller = scrollParent(root.current)
    // The editor starts at the top; the list returns to where it was. A scope that mounts with its
    // editor already open (a deep link) starts at the top too, and has no list position to restore.
    if (scroller && (editing || mounted.current)) scroller.scrollTop = editing ? 0 : listScroll.current
    mounted.current = true
  }, [editing, scroll])
  if (scroll) {
    return <InlineTarget.Provider value={{ target, enter }}>
      <div className='relative h-full min-h-0'>
        <div className={cn('h-full overflow-auto', editing && 'invisible')} inert={editing || undefined}>{children}</div>
        <div ref={setTarget} className={cn('absolute inset-0 overflow-auto bg-surface', !editing && 'hidden')} />
      </div>
    </InlineTarget.Provider>
  }
  return <InlineTarget.Provider value={{ target, enter }}>
    <div ref={root} className='min-h-full'>
      <div className={cn(editing && 'hidden')} inert={editing || undefined}>{children}</div>
      <div ref={setTarget} className={cn('bg-surface', !editing && 'hidden')} />
    </div>
  </InlineTarget.Provider>
}

export function InlineDialog({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }) {
  const scope = useInlineDialogTarget()
  if (!scope) return <Dialog open={open} onOpenChange={onOpenChange}>{children}</Dialog>
  return open ? <InlineClose.Provider value={() => onOpenChange?.(false)}>{children}</InlineClose.Provider> : null
}

export function InlineDialogContent({ children, className, showClose = true, fill = true }: HTMLAttributes<HTMLDivElement> & {
  showClose?: boolean
  /** Inline, take the whole pane width (the default for editors). A confirmation keeps its own
   *  width, aligned with the pane's text rather than centred in it. */
  fill?: boolean
}) {
  const scope = useInlineDialogTarget()
  const close = useContext(InlineClose)
  const crumbs = useContext(InlineCrumbs)
  const panel = useRef<HTMLDivElement>(null)
  const enter = scope?.enter
  useLayoutEffect(() => enter?.(), [enter])
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus({ preventScroll: true })
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [scope?.target])
  if (!scope) return <DialogContent className={className} showClose={showClose}>{children}</DialogContent>
  // Inline, an editor IS the pane: the width a caller sized for a floating modal (`max-w-md`) is
  // dropped so the form uses the space it has, with the same gutters as the list it replaced.
  const content = <div ref={panel} tabIndex={-1} className={cn('flex w-full flex-col gap-4 px-4 pt-1 pb-6 outline-none md:px-6', className, fill && 'max-w-none')}>
    {showClose && !crumbs && <button type='button' onClick={close ?? undefined} className='flex w-fit items-center gap-2 text-body-sm text-muted-foreground hover:text-text'><ArrowLeft className='size-4' /> Back</button>}
    {children}
  </div>
  return scope?.target ? createPortal(content, scope.target) : content
}

export function InlineDialogTitle({ className, crumb = true, trail, onRoot, children, ...props }: HTMLAttributes<HTMLHeadingElement> & {
  /** Under an InlineCrumbProvider, show this title as the pane's breadcrumb (default) instead of in
   *  the body. A confirmation keeps its question in the body. */
  crumb?: boolean
  trail?: InlineCrumb['trail']
  onRoot?: InlineCrumb['onRoot']
}) {
  const scope = useInlineDialogTarget()
  const close = useContext(InlineClose)
  const crumbs = useContext(InlineCrumbs)
  const key = useRef({}).current
  const asCrumb = !!scope && !!crumbs && crumb
  useLayoutEffect(() => {
    if (!asCrumb || !crumbs) return
    crumbs(key, { title: children, onBack: () => close?.(), trail, onRoot })
  })
  useLayoutEffect(() => (asCrumb && crumbs ? () => crumbs(key, null) : undefined), [asCrumb, crumbs, key])
  if (!scope) return <DialogTitle className={className} {...props}>{children}</DialogTitle>
  return <h2 className={cn('font-serif text-display-sm leading-tight text-text', asCrumb && 'sr-only', className)} {...props}>{children}</h2>
}
export function InlineDialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const scope = useInlineDialogTarget()
  if (!scope) return <DialogDescription className={className} {...props} />
  return <p className={cn('text-body-sm text-muted-foreground', className)} {...props} />
}
