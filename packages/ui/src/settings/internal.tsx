// Internal plumbing shared by the settings pieces: where a piece sits (its gutter and vertical
// rhythm) and whether the member view is on. Not exported from the package.

import * as React from 'react'
import type { ActionMenuItem } from '../components/ActionMenu.tsx'

/**
 * Where a settings piece sits, which decides who owns the gutter and the space above it:
 *
 *   canvas  directly on a settings canvas (the section in a `SettingsPane`, a `SettingsPage`): the
 *           piece brings the gutter and its top offset; the first piece sits 8px under the title bar
 *           (16px for a group, which then drops its rule)
 *   panel   first level inside a `SettingsTabs` panel: as canvas, but the panel already has its
 *           20px offset and the first group or list drops its top rule
 *   flow    as canvas, after a leading piece the piece cannot see (the `SettingsReadOnly` note):
 *           no first-child treatment
 *   group   inside a group that already applied the gutter: no gutter, full-bleed pieces (lists)
 *           pull themselves back out to the pane edge
 *   null    outside any settings pane (a piece used on its own): no canvas offsets
 */
export type CanvasMode = 'canvas' | 'panel' | 'flow' | 'group' | null

export const SettingsCanvasContext = React.createContext<CanvasMode>(null)

/** A `RecordPage`'s column width class: the footer bar lines its buttons up with the form above. */
export const FormColumnContext = React.createContext<string | null>(null)

export function useCanvasMode(): CanvasMode {
  return React.useContext(SettingsCanvasContext)
}

/** True when the piece stands on a canvas level (not inside a group, not in a legacy section). */
export function onCanvas(mode: CanvasMode): boolean {
  return mode === 'canvas' || mode === 'panel' || mode === 'flow'
}

// A form drawn as `contents` (`useSettingsForm`'s `<form className='contents'>`) makes its first
// piece a DOM first child even when something stands above the form (a notice, a header). The
// `[form:not(:first-child)>&]` variants give that piece back the spacing of a piece in the middle.

/** Top spacing for a block piece (group, notice, facts, header, toolbar) on a canvas level. */
export function blockSpacing(mode: CanvasMode): string {
  if (mode === 'canvas') return 'mt-6 first:mt-2 [form:not(:first-child)>&]:mt-6'
  if (mode === 'panel') return 'mt-6 first:mt-0 [form:not(:first-child)>&]:mt-6'
  if (mode === 'flow') return 'mt-6'
  return ''
}

/** Top spacing for a full-bleed list on a canvas level; a heading or toolbar right above it keeps
 *  it tight (they carry `data-settings-lead`). */
export function listSpacing(mode: CanvasMode): string {
  if (mode === 'canvas') return 'mt-6 first:mt-0 [form:not(:first-child)>&]:mt-6 [[data-settings-lead]+&]:mt-0'
  if (mode === 'panel') return 'mt-6 first:mt-0 first:border-t-0 [form:not(:first-child)>&]:mt-6 [form:not(:first-child)>&]:border-t [[data-settings-lead]+&]:mt-0'
  if (mode === 'flow') return 'mt-6 [[data-settings-lead]+&]:mt-0'
  if (mode === 'group') return '-mx-4 md:-mx-6'
  return ''
}

/** How many `SettingsPage`s deep a piece sits: 0 on the section, 1 on a page over it. The title
 *  bar shows the actions of the deepest layer only, so a page owns the bar while it is open. */
export const SettingsLayerContext = React.createContext(0)

/** Where a `SettingsPage` registers its layer while open, whether or not it publishes actions: the
 *  pane shows actions of the deepest open layer only, so a page without a create button still
 *  hides the section's. */
export type LayerHost = (key: object, layer: number | null) => void
export const SettingsLayerHostContext = React.createContext<LayerHost | null>(null)

/** A form's draft as its hosts see it: unsaved (`true`), clean (`false`), or a save in flight (the
 *  promise, true when the save lands). */
export type DraftState = boolean | Promise<boolean>
/** Where a form reports its draft: `SettingsTabs` and the pane ask before leaving would drop unsaved
 *  work. Keyed per form; `false` or removal clears it. */
export type DraftHost = (key: object, state: DraftState) => void
export const SettingsDraftContext = React.createContext<DraftHost | null>(null)

/** Whether leaving is safe: `clean`; `dirty` (ask first); `failed` (a save in flight failed: stay,
 *  the form shows why and keeps the draft). Waits for saves in flight, then reads the drafts again:
 *  a landed save publishes its form's state at that moment (dirty when edited meanwhile). */
export type SettingsLeaveState = 'clean' | 'dirty' | 'failed'
export async function leaveState(read: () => Iterable<DraftState>): Promise<SettingsLeaveState> {
  const waited = new Set<Promise<boolean>>()
  // A new save can start while one is awaited; a few rounds cover it, more means something keeps
  // saving, so leaving asks.
  for (let round = 0; round < 8; round++) {
    const all = [...read()]
    const pending = all.filter((s): s is Promise<boolean> => typeof s !== 'boolean' && !waited.has(s))
    if (pending.length === 0) return all.some((s) => s === true) ? 'dirty' : 'clean'
    for (const s of pending) waited.add(s)
    if ((await Promise.all(pending)).some((ok) => !ok)) return 'failed'
  }
  return 'dirty'
}

export { SettingsReadOnlyContext } from '../lib/readOnly.ts'

/** Read-only keeps only the items marked `reader` (they change nothing) in a settings piece's
 *  "..." menu: a menu item that writes is as much a change control as a button. */
export function visibleMenuItems(items: ActionMenuItem[] | undefined, readOnly: boolean): ActionMenuItem[] {
  if (!items) return []
  return readOnly ? items.filter((i) => i.reader) : items
}
