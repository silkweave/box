// The slots a section writes into the pane it sits in: the footer, the title bar's create actions
// and the title bar's info popover. Each publishes while mounted, newest publisher wins, and each
// removal hands the slot back to the one underneath.

import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { SettingsActionsContext, SettingsFooterBar, SettingsFooterContext, SettingsInfoButton, SettingsInfoContext, usePublishFooter, type SettingsFooter } from './SettingsPane.tsx'
import { SettingsLayerContext, SettingsReadOnlyContext } from './internal.tsx'

/**
 * Publish this section's footer to the pane while mounted. Pass `null` to publish nothing.
 *
 * Use it for: a footer `SettingsActions` cannot express (a bar that needs the `shadowed` flag).
 * Not for: a form's Save (use `SettingsSaveBar`) or a plain row of buttons (use `SettingsActions`).
 * Rules: throws outside a `SettingsPane`; `deps` names what the footer depends on, like `useMemo`.
 */
export function useSettingsFooter(footer: SettingsFooter | null, deps: React.DependencyList) {
  const host = React.useContext(SettingsFooterContext)
  if (!host) throw new Error('useSettingsFooter must be used inside a SettingsPane.')
  usePublishFooter(host, footer, deps)
}

/**
 * Put a section's create actions ("New role") in the pane's title bar while mounted.
 *
 * Use it for: a list's create buttons, at most two, the primary last.
 * Not for: filters or Refresh (a list's `DataGrid` bar and its `actions`), operational acts like Reconnect (put them in
 * their group's `aside`), Save (footer).
 * Rules: the open layer owns the bar. On a `SettingsPage` (a detail with a child list, a tab that
 * creates) it shows the page's own create buttons and hides the section's; closing the page hands
 * the bar back. Render it inside the tab or page that owns the act, never in a parent for a child.
 * Outside a pane it renders in place, right-aligned. Under an active `SettingsReadOnly` it renders
 * nothing.
 */
export function SettingsHeaderActions({ children }: { children: React.ReactNode }) {
  const host = React.useContext(SettingsActionsContext)
  const readOnly = React.useContext(SettingsReadOnlyContext)
  const layer = React.useContext(SettingsLayerContext)
  const key = React.useRef({}).current
  const content = readOnly ? null : (children ?? null)
  React.useEffect(() => {
    if (!host) return
    host(key, content, layer)
    return () => host(key, null)
  }, [host, key, content, layer])
  if (host || content === null) return null
  return <div className='flex items-center justify-end gap-2'>{content}</div>
}

/**
 * Publish a section's explanation to the pane's title bar while mounted: an info icon beside the
 * title (or the breadcrumb) that opens a short popover.
 *
 * Use it for: a custom popover body. Prefer `SettingsIntro` (a sentence plus `info`) for a section
 * and `SettingsPage`'s `info` for a detail or create page.
 * Rules: outside a pane it renders the icon in place; keep it to a sentence or two.
 */
export function SettingsInfo({ children }: { children: React.ReactNode }) {
  const host = React.useContext(SettingsInfoContext)
  const key = React.useRef({}).current
  React.useEffect(() => {
    if (!host) return
    host(key, children)
    return () => host(key, null)
  }, [host, key, children])
  return host ? null : <SettingsInfoButton>{children}</SettingsInfoButton>
}

/**
 * The action row at the bottom of an editor or confirmation.
 *
 * Use it for: a confirmation's answer, a page whose footer is not a form (Close). A form uses
 * `SettingsSaveBar`, which is built on this.
 * Rules: inside a `SettingsPane` it is pinned to the pane's footer, so the actions stay in reach
 * however long the form is; anywhere else it is a plain right-aligned row. A submit button rendered
 * here sits outside its form's DOM, so give it `form='<form id>'`. The member view flag travels
 * with it into the footer, so a `SettingsDeleteButton` inside still hides under `SettingsReadOnly`.
 */
export function SettingsActions({ className, children }: { className?: string; children: React.ReactNode }) {
  const host = React.useContext(SettingsFooterContext)
  const readOnly = React.useContext(SettingsReadOnlyContext)
  usePublishFooter(
    host,
    host
      ? (shadowed) => (
          <SettingsReadOnlyContext.Provider value={readOnly}>
            <SettingsFooterBar shadowed={shadowed} className={className}>{children}</SettingsFooterBar>
          </SettingsReadOnlyContext.Provider>
        )
      : null,
    [children, className, readOnly],
  )
  return host ? null : <div className={cn('flex items-center justify-end gap-2', className)}>{children}</div>
}

/**
 * The section's explanation: one plain sentence, plus the longer story (how it works, where it is
 * stored) as `info`.
 *
 * Use it for: every section's intro. Both show in the title bar's info popover; nothing renders on
 * the canvas.
 * Not for: a state that needs the owner (use `SettingsNotice`).
 */
export function SettingsIntro({ children, info }: { children: React.ReactNode; info?: React.ReactNode }) {
  return (
    <SettingsInfo>
      <p className='font-medium'>{children}</p>
      {info != null && <p className='mt-1.5 text-muted-foreground'>{info}</p>}
    </SettingsInfo>
  )
}
