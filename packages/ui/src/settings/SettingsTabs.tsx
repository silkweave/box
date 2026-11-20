import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { TabNav } from '../components/TabNav.tsx'
import { SETTINGS_GUTTER } from './SettingsPane.tsx'
import { confirm } from '../components/Confirm.tsx'
import { SettingsCanvasContext, SettingsDraftContext, leaveState, useCanvasMode, type DraftHost, type DraftState } from './internal.tsx'

/**
 * The pages of a tabbed section or a detail page: the tab bar with its rule full-bleed, then the
 * open tab's content 20px under it.
 *
 * Use it for: parts that are different tasks for different moments (Tools, Access, Details,
 * Activity; Triggers, Runs, Alerts).
 * Not for: parts read together (use `SettingsGroup`s and scroll), a filter or regrouping of what is
 * on screen (use `SegmentedControl`), a second level of tabs (never two levels on one page).
 * Props: `label` names the nav landmark ("Automation sections"); `onChange` navigates (the section
 * owns the route, `#settings/automation/runs`); an item's `icon` and `badge` sit beside its label.
 * Rules: section tabs come first on the canvas, detail tabs after the `SettingsDetailHeader` and any
 * notice. The panel is a canvas: a `SettingsGroup` or list first in it drops its own top
 * rule. The bar scrolls with the canvas. Keep `SettingsReadOnly` inside the panel.
 * The open tab owns the title bar actions and the footer: each tab renders its own
 * `SettingsHeaderActions` and `SettingsSaveBar`, and they leave with it. A switch away from a tab
 * whose form has unsaved changes asks first ("Discard changes?"); staying keeps the draft. For that,
 * the form's `useSettingsForm` must run inside the tab (a component rendered as `children`), not in
 * the component that renders `SettingsTabs`.
 */
export function SettingsTabs<T extends string>({ label, value, onChange, items, children }: {
  label: string
  value: T
  onChange: (v: T) => void
  items: { value: T; label: React.ReactNode; badge?: React.ReactNode; icon?: React.ReactNode }[]
  /** The open tab's content. */
  children: React.ReactNode
}) {
  const mode = useCanvasMode()
  // Forms in the open tab report their dirty state here (`useSettingsForm` does it).
  // They pass on to the pane's, so the app's navigation guard sees them too.
  const parent = React.useContext(SettingsDraftContext)
  const drafts = React.useRef(new Map<object, DraftState>())
  const host = React.useCallback<DraftHost>((key, next) => {
    if (next === false) drafts.current.delete(key)
    else drafts.current.set(key, next)
    parent?.(key, next)
  }, [parent])
  const change = async (next: T) => {
    if (next === value) return
    const state = await leaveState(() => drafts.current.values())
    if (state === 'failed') return
    if (state === 'dirty') {
      const ok = await confirm({ title: 'Discard changes?', message: 'This tab has changes that are not saved yet.', confirmLabel: 'Discard', danger: true })
      if (!ok) return
    }
    // Already confirmed: the tab's drafts are dropped, so the navigation guard does not ask again.
    for (const key of drafts.current.keys()) parent?.(key, false)
    drafts.current.clear()
    onChange(next)
  }
  const tabs = items.map((item) => ({
    value: item.value,
    label:
      item.icon || item.badge ? (
        <span className='inline-flex items-center gap-1.5 [&_svg]:size-4'>
          {item.icon}
          {item.label}
          {item.badge}
        </span>
      ) : (
        item.label
      ),
  }))
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col',
        mode === 'canvas' && 'mt-6 first:-mt-1',
        (mode === 'panel' || mode === 'flow') && 'mt-6',
        mode === 'group' && '-mx-4 md:-mx-6',
      )}>
      <TabNav label={label} value={value} items={tabs} onChange={(v) => void change(v)} className={SETTINGS_GUTTER} />
      <div className='flex min-w-0 flex-col pt-5'>
        <SettingsDraftContext.Provider value={host}>
          <SettingsCanvasContext.Provider value='panel'>{children}</SettingsCanvasContext.Provider>
        </SettingsDraftContext.Provider>
      </div>
    </div>
  )
}
