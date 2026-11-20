// A page over a section's list: a detail or create page.

import * as React from 'react'
import { InlineDialog, InlineDialogContent, InlineDialogTitle, useInlineDialogTarget, type InlineCrumb } from '../components/InlineDialog.tsx'
import { cn } from '../lib/utils.ts'
import { SettingsCanvasContext, SettingsLayerContext, SettingsLayerHostContext } from './internal.tsx'
import { SettingsInfo } from './slots.tsx'
import { SettingsBaseFooterContext } from './SettingsPane.tsx'

/** A page's canvas. Inside a `SettingsPane` the pane already gives the canvas its ends (top and
 *  bottom space), so the page adds only the context; as a modal it adds both. */
function Canvas({ inline, children }: { inline: boolean; children: React.ReactNode }) {
  const layer = React.useContext(SettingsLayerContext)
  // Claim the title bar while open, with or without actions of its own.
  const host = React.useContext(SettingsLayerHostContext)
  const key = React.useRef({}).current
  React.useEffect(() => {
    if (!host || !inline) return
    host(key, layer + 1)
    return () => host(key, null)
  }, [host, key, layer, inline])
  return (
    <div className={cn('flex min-w-0 flex-col', !inline && 'pt-2 pb-8')}>
      {/* The pane's count row belongs to the section's list; a list on a page keeps its own count. */}
      <SettingsBaseFooterContext.Provider value={null}>
        {/* One layer deeper: its title bar actions win over the section's while it is open. */}
        <SettingsLayerContext.Provider value={layer + 1}>
          <SettingsCanvasContext.Provider value='canvas'>{children}</SettingsCanvasContext.Provider>
        </SettingsLayerContext.Provider>
      </SettingsBaseFooterContext.Provider>
    </div>
  )
}

/**
 * A detail or create page that replaces the section's list, with its title as the breadcrumb
 * ("Roles › Sales").
 *
 * Use it for: every page opened from a section (`#settings/roles/sales`, `#settings/roles/new`).
 * The section decides from its route whether the page is open and renders this for it; the kit
 * never sees the router.
 * Not for: a confirmation (use `confirm`) or a result someone must copy before leaving (a `Dialog`).
 * Props: `title` is the breadcrumb, never repeated on the canvas (use `SettingsDetailHeader` when the
 * thing has more identity than its name); `info` is the page's description, shown in the title
 * bar's info popover; `onClose` goes back to the list (navigate to the list route); `trail` and
 * `onRoot` are the crumbs of a page nested under another.
 * Rules: needs an `InlineDialogScope scroll={false}` around the section inside a `SettingsPane`;
 * outside one it opens as a modal `Dialog`. Its content is a canvas with no gutter of its own: pieces
 * inside behave exactly as on the section canvas.
 */
export function SettingsPage({ title, info, onClose, trail, onRoot, children }: {
  title: React.ReactNode
  info?: React.ReactNode
  onClose: () => void
  trail?: InlineCrumb['trail']
  onRoot?: InlineCrumb['onRoot']
  children: React.ReactNode
}) {
  const inline = !!useInlineDialogTarget()
  return (
    <InlineDialog open onOpenChange={(open) => !open && onClose()}>
      <InlineDialogContent className={inline ? 'gap-0 px-0 pt-0 pb-0 md:px-0' : undefined}>
        <InlineDialogTitle trail={trail} onRoot={onRoot}>{title}</InlineDialogTitle>
        {info != null && <SettingsInfo>{info}</SettingsInfo>}
        <Canvas inline={inline}>{children}</Canvas>
      </InlineDialogContent>
    </InlineDialog>
  )
}
