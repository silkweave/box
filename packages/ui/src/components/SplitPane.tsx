import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { usePersistedState } from '../lib/usePersistedState.ts'

/**
 * Lets the panel's OWN header host the collapse button. The alternative - a rail column beside the
 * panel - spent ~32px of width permanently on a control that is only ever pressed once, and put it
 * somewhere no header explains. Every right-hand panel here already draws a `file icon · path ·
 * actions` header, so the button belongs at the head of that row.
 *
 * Context rather than a prop because `right` is an opaque node handed to SplitPane: threading a
 * toggle down would mean every call site forwarding it through its own editor's props.
 */
const SplitPaneCtx = createContext<{ collapse: () => void; label: string } | null>(null)

/**
 * The collapse button, rendered by a panel inside its header. Null outside a SplitPane, so the same
 * editor renders unchanged in its standalone `card` form (the task modal, the sink page). Hidden
 * below md, where the panes stack and there is no expand affordance to come back from.
 */
export function SplitPaneToggle({ className }: { className?: string }) {
  const ctx = useContext(SplitPaneCtx)
  if (!ctx) return null
  return (
    <button
      type='button'
      onClick={ctx.collapse}
      aria-expanded
      aria-label={`Hide ${ctx.label}`}
      title={`Hide ${ctx.label}`}
      className={cn(
        'hidden shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent-tint hover:text-text md:inline-flex',
        className,
      )}>
      <PanelRightClose className='size-3.5' />
    </button>
  )
}

/**
 * Horizontal split: scrollable `left` content + a fixed-width `right` panel separated by a draggable
 * hairline. The right width (px) persists per `storageKey`; the handle itself is the separator line
 * (the right panel needs no border of its own). Below md the panes stack vertically and the handle
 * hides. Fills its parent's height - both panes scroll independently.
 *
 * The right panel also COLLAPSES (2026-09-08), because on a detail view it is a reference pane, not
 * the work: reading a long task list or a CRM account's tables wants the whole width, and dragging
 * the handle to the edge left a useless 320px stub rather than getting out of the way. Collapsed
 * state persists next to the width under `<storageKey>.collapsed`, so a reader who works
 * list-first stays list-first across navigations instead of re-closing the pane on every row.
 * Re-opening restores the dragged width, so collapse is not a destructive reset.
 *
 * `open={false}` takes the split out of the layout entirely - no handle, no panel, and `left`
 * renders as if nothing wrapped it, scrolling with the page. It is for a panel that comes and goes
 * beside an ordinary page: `left` keeps its place in the tree, so opening the panel does not remount
 * the page under it, and the scroll position is handed across both ways.
 *
 * `narrow="push"` changes the layout below md: instead of stacking under `left`, the open panel
 * slides in from the right and covers it, like a pushed view on a phone. Closing it is the caller's
 * (`open={false}`), so the panel should carry its own close control.
 */
export function SplitPane({
  storageKey,
  left,
  right,
  defaultRightClass = 'md:w-[42%]',
  minLeft = 360,
  minRight = 320,
  collapseLabel = 'panel',
  open = true,
  collapsible = true,
  narrow = 'stack',
}: {
  storageKey: string
  left: React.ReactNode
  right: React.ReactNode
  defaultRightClass?: string
  minLeft?: number
  minRight?: number
  /** Named in the toggle's tooltip/aria - "Hide notes" reads better than "Hide panel". */
  collapseLabel?: string
  /** False: no split at all, `left` lays out and scrolls as plain page content. */
  open?: boolean
  /**
   * False: no collapse at all - the rail never shows and `SplitPaneToggle` renders nothing. For a
   * panel that closes rather than hides: an editor inside it would otherwise offer to hide the whole
   * panel from its own header.
   */
  collapsible?: boolean
  /** Below md: `stack` puts the panel under `left`; `push` slides it in over `left` from the right. */
  narrow?: 'stack' | 'push'
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  // The reader's scroll position, whichever element is scrolling: the page's scroller while closed,
  // the left pane while open. Handed over when `open` flips.
  const scrollTop = useRef(0)
  const wasOpen = useRef(open)
  const [rightWidth, setRightWidth] = usePersistedState<number | null>(
    storageKey,
    null,
    (v) => v === null || typeof v === 'number',
  )
  const [storedCollapsed, setCollapsed] = usePersistedState<boolean>(
    `${storageKey}.collapsed`,
    false,
    (v) => typeof v === 'boolean',
  )
  const collapsed = collapsible && storedCollapsed

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const move = (ev: PointerEvent) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const w = Math.max(minRight, Math.min(rect.width - minLeft, rect.right - ev.clientX))
      setRightWidth(w)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const ctx = useMemo(() => ({ collapse: () => setCollapsed(true), label: collapseLabel }), [setCollapsed, collapseLabel])

  useEffect(() => {
    if (open) return
    const scroller = scrollParent(containerRef.current)
    if (!scroller) return
    const track = () => void (scrollTop.current = scroller.scrollTop)
    track()
    scroller.addEventListener('scroll', track, { passive: true })
    return () => scroller.removeEventListener('scroll', track)
  }, [open])

  useLayoutEffect(() => {
    if (wasOpen.current === open) return
    wasOpen.current = open
    if (open) {
      if (leftRef.current) leftRef.current.scrollTop = scrollTop.current
    } else {
      const scroller = scrollParent(containerRef.current)
      if (scroller) scroller.scrollTop = scrollTop.current
    }
  }, [open])

  const push = narrow === 'push'

  return (
    <div
      ref={containerRef}
      className={
        open
          ? cn(
              'flex h-full min-h-0 flex-col md:flex-row',
              // Stacked below md, the page and the panel scroll together as one column; pushed, the
              // panel covers the page, which keeps its own scroll underneath.
              push ? 'relative overflow-hidden md:overflow-visible' : 'overflow-y-auto md:overflow-visible',
            )
          : 'contents'
      }>
      <div
        ref={leftRef}
        onScroll={open ? (e) => void (scrollTop.current = e.currentTarget.scrollTop) : undefined}
        className={open ? cn('min-w-0 md:min-h-0 md:flex-1 md:overflow-y-auto', push ? 'min-h-0 flex-1 overflow-y-auto' : 'shrink-0') : 'contents'}>
        {left}
      </div>

      {/* Collapsed, the panel is replaced by a slim rail holding the only way back - the same shape
          the sprint planning backlog uses. The expand button cannot live in the panel's header for
          the obvious reason: the header is what got hidden. */}
      {open && collapsed && (
        <button
          type='button'
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          aria-label={`Show ${collapseLabel}`}
          title={`Show ${collapseLabel}`}
          className='hidden shrink-0 items-start justify-center border-l border-border px-2 py-2.5 text-muted-foreground transition-colors hover:bg-accent-tint hover:text-text md:flex'>
          <PanelRightOpen className='size-4' />
        </button>
      )}

      {/* Drag handle (desktop) - a 1px rule that IS the panel's left border, with a fat invisible hit
          area either side. Gone when collapsed: there is nothing left to resize. */}
      {open && !collapsed && (
        <div
          role='separator'
          aria-orientation='vertical'
          onPointerDown={onPointerDown}
          onDoubleClick={() => setRightWidth(null)}
          title='Drag to resize · double-click to reset'
          className='relative z-10 hidden w-px shrink-0 cursor-col-resize bg-border transition-colors hover:bg-accent/60 active:bg-accent md:block'>
          <span className='absolute inset-y-0 -left-1.5 -right-1.5' />
        </div>
      )}

      {/* Collapse is a DESKTOP-only affordance: below md the panes stack and the rail is hidden, so a
          pane hidden there could never be reopened. `collapsed` therefore hides the aside from md up
          only, and the stacked layout always shows it (SplitPaneToggle is likewise md-and-up).
          Hidden rather than unmounted - `right` is a doc editor whose in-flight autosave should not
          be torn down by a layout toggle, and re-mounting would re-fetch and re-seed it on every open. */}
      {open && (
        <aside
          // The dragged width is a desktop fact: below md the panel stacks or covers the page.
          style={rightWidth != null && !collapsed ? ({ '--split-right-w': `${rightWidth}px` } as React.CSSProperties) : undefined}
          className={cn(
            'flex min-h-0 min-w-0 shrink-0 flex-col',
            rightWidth != null && !collapsed && 'md:w-(--split-right-w)',
            push
              ? 'absolute inset-0 z-30 bg-bg shadow-(--shadow-md) motion-safe:animate-slide-in-right md:static md:z-auto md:shadow-none md:motion-safe:animate-none'
              : 'border-t border-border md:border-t-0',
            collapsed ? 'md:hidden' : rightWidth == null && defaultRightClass,
          )}>
          <SplitPaneCtx.Provider value={collapsible ? ctx : null}>{right}</SplitPaneCtx.Provider>
        </aside>
      )}
    </div>
  )
}

/** The nearest ancestor that scrolls vertically. A `display: contents` box has no layout, so start above it. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p)
    if (overflowY === 'auto' || overflowY === 'scroll') return p
  }
  return null
}
