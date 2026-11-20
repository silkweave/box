import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { CopyButton } from '../components/CopyButton.tsx'
import { SETTINGS_GUTTER } from './SettingsPane.tsx'
import { blockSpacing, useCanvasMode } from './internal.tsx'

const FactColumns = React.createContext<1 | 2 | 3>(2)

// Literal class strings so Tailwind sees each; the grid answers the pane's width, not the viewport.
const GRID: Record<1 | 2 | 3, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 @md:grid-cols-2',
  3: 'grid-cols-1 @md:grid-cols-2 @xl:grid-cols-3',
}
const SPAN: Record<1 | 2 | 3, Record<1 | 2 | 3, string>> = {
  1: { 1: '', 2: 'col-span-full', 3: 'col-span-full' },
  2: { 1: '', 2: 'col-span-full', 3: 'col-span-full' },
  3: { 1: '', 2: '@md:col-span-2', 3: 'col-span-full' },
}

/**
 * Read-only facts as labels over values, on the same column grid as a form.
 *
 * Use it for: the state of an integration (a sign-in URL, an issuer, a certificate's expiry), a
 * webhook's address, counts in an overview, a thing's id on its detail page.
 * Not for: values someone edits (use `Field`s in a `FieldGrid`), a collection (use a `DataGrid`).
 * Props: `columns` is the count at full width (2 by default); it collapses to one in a narrow pane.
 * Rules: children are `SettingsFact`s; renders a `<dl>`. On a canvas it brings its gutter; inside a
 * `SettingsGroup` it uses the group's.
 */
export function SettingsFacts({ columns = 2, className, children }: { columns?: 1 | 2 | 3; className?: string; children: React.ReactNode }) {
  const mode = useCanvasMode()
  return (
    <div className={cn('@container min-w-0', mode !== 'group' && SETTINGS_GUTTER, blockSpacing(mode))}>
      <dl className={cn('grid gap-x-6 gap-y-4', GRID[columns], className)}>
        <FactColumns.Provider value={columns}>{children}</FactColumns.Provider>
      </dl>
    </div>
  )
}

/**
 * One fact: a label over its value.
 *
 * Use it for: a single read-only value inside `SettingsFacts`.
 * Props: `mono` for ids, keys and URLs; `copy` adds a `CopyButton` for that text; `span` takes more
 * columns (`full` the whole row, for a long URL or a certificate fingerprint); `hint` is one muted
 * line under the value (where it comes from, what it means).
 * Rules: a missing value is the caller's muted "Not set", never an empty cell.
 */
export function SettingsFact({ label, mono = false, copy, hint, span = 1, children }: {
  label: React.ReactNode
  mono?: boolean
  copy?: string
  hint?: React.ReactNode
  span?: 1 | 2 | 3 | 'full'
  /** The value. */
  children: React.ReactNode
}) {
  const columns = React.useContext(FactColumns)
  return (
    <div className={cn('flex min-w-0 flex-col gap-0.5', span === 'full' ? 'col-span-full' : SPAN[columns][span])}>
      <dt className='text-label text-muted-foreground'>{label}</dt>
      <dd className='flex min-w-0 items-center gap-1 text-body-sm text-text'>
        <span className={cn('min-w-0 break-words', mono && 'font-mono text-label break-all')}>{children}</span>
        {copy != null && <CopyButton value={copy} className='-my-1' />}
      </dd>
      {hint != null && <dd className='text-label text-fg-4'>{hint}</dd>}
    </div>
  )
}
