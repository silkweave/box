import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { ActionMenu, type ActionMenuItem } from '../components/ActionMenu.tsx'
import { SETTINGS_GUTTER } from './SettingsPane.tsx'
import { SettingsReadOnlyContext, listSpacing, useCanvasMode, visibleMenuItems } from './internal.tsx'

/**
 * A setting as a row: its title and description on the left, the control that sets it on the right.
 *
 * Use it for: a list of settings each with one control (a role's access per area, a server's tool
 * levels, a feature switch): a `Switch`, `SegmentedControl` or `SelectField`.
 * Not for: a record that opens a detail page (a `DataGrid` row), a labelled form field (use
 * `Field`), picking items from a set (a `Checkbox` list).
 * Props: `description` may hold blocks (a paragraph, a `ChangedFrom` note); `meta` is a small muted
 * line or badge under the title ("inherited"); `actions` adds a "..." menu after the control.
 * Rules: an `<li>`: put it inside a `SettingsControlList` (full-bleed rows). Under an active
 * `SettingsReadOnly` the control is disabled and the menu keeps only items marked `reader`; a
 * control that only reads or navigates ("Open history", a page of the section) passes `reader` and
 * stays live. A control that saves on change shows its own short "Saved".
 */
export function SettingsControlRow({ title, description, meta, actions, reader = false, className, children }: {
  title: React.ReactNode
  description?: React.ReactNode
  meta?: React.ReactNode
  actions?: ActionMenuItem[]
  /** The control reads or navigates, so the member view keeps it live. */
  reader?: boolean
  className?: string
  /** The control on the right. */
  children: React.ReactNode
}) {
  const readOnly = React.useContext(SettingsReadOnlyContext)
  const items = visibleMenuItems(actions, readOnly)
  return (
    <li className={cn('grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-border py-2.5', SETTINGS_GUTTER, className)}>
      <div className='min-w-0'>
        <div className='text-body font-medium text-text'>{title}</div>
        {description && <div className='text-body-sm text-muted-foreground'>{description}</div>}
        {meta && <div className='mt-0.5 flex flex-wrap items-center gap-2 text-label text-muted-foreground'>{meta}</div>}
      </div>
      <div className='flex items-center justify-end gap-1.5'>
        {/* The member view disables the control, not the row: its menu still offers what a reader may do. */}
        {readOnly && !reader ? <fieldset disabled className='contents'>{children}</fieldset> : children}
        {items.length > 0 && <ActionMenu items={items} size='sm' />}
      </div>
    </li>
  )
}

/**
 * The ruled, full-bleed list that holds `SettingsControlRow`s: settings, not records.
 *
 * Use it for: a role's access per area, a server's tool levels, a group of feature switches.
 * Not for: records (use a `DataGrid`), label and value facts (use `SettingsFacts`).
 * Rules: on a canvas the first list's top rule sits under the title bar; inside a canvas
 * `SettingsGroup` it reaches the pane edge by itself.
 */
export function SettingsControlList({ label, children }: {
  /** The list's accessible name, e.g. "Access by area". */
  label?: string
  children: React.ReactNode
}) {
  const mode = useCanvasMode()
  return <ul aria-label={label} className={cn('flex flex-col border-t border-border', listSpacing(mode))}>{children}</ul>
}
