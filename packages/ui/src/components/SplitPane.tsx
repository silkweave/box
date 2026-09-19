import { createContext, useContext, useMemo, useRef } from 'react'
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
 */
export function SplitPane({
  storageKey,
  left,
  right,
  defaultRightClass = 'md:w-[42%]',
  minLeft = 360,
  minRight = 320,
  collapseLabel = 'panel',
}: {
  storageKey: string
  left: React.ReactNode
  right: React.ReactNode
  defaultRightClass?: string
  minLeft?: number
  minRight?: number
  /** Named in the toggle's tooltip/aria - "Hide notes" reads better than "Hide panel". */
  collapseLabel?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [rightWidth, setRightWidth] = usePersistedState<number | null>(
    storageKey,
    null,
    (v) => v === null || typeof v === 'number',
  )
  const [collapsed, setCollapsed] = usePersistedState<boolean>(
    `${storageKey}.collapsed`,
    false,
    (v) => typeof v === 'boolean',
  )

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

  return (
    <div ref={containerRef} className='flex h-full min-h-0 flex-col md:flex-row'>
      <div className='min-h-0 min-w-0 flex-1 overflow-y-auto'>{left}</div>

      {/* Collapsed, the panel is replaced by a slim rail holding the only way back - the same shape
          the sprint planning backlog uses. The expand button cannot live in the panel's header for
          the obvious reason: the header is what got hidden. */}
      {collapsed && (
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
      {!collapsed && (
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
      <aside
        style={rightWidth != null && !collapsed ? { width: rightWidth } : undefined}
        className={cn(
          'flex min-h-0 min-w-0 shrink-0 flex-col border-t border-border md:border-t-0',
          collapsed ? 'md:hidden' : rightWidth == null && defaultRightClass,
        )}>
        <SplitPaneCtx.Provider value={ctx}>{right}</SplitPaneCtx.Provider>
      </aside>
    </div>
  )
}
