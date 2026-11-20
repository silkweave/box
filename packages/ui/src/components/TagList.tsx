import type * as React from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/utils.ts'

export interface TagItem {
  /** Stable key and, without `label`, the text. */
  value: string
  label?: React.ReactNode
  /** Hover text: where it came from, who added it. */
  title?: string
  /** A fixed tag: shows this muted note ("box.json") instead of a remove button. */
  fixed?: string
}

/**
 * A wrapping row of rounded tags, each with a remove button unless it is fixed.
 *
 * Use it for: a saved set of short values shown as chips (allowed addresses, trusted senders,
 * domains, labels), where adding happens through a separate input or dialog.
 * Not for: typing and picking values in one control (use `TokenPicker`), a status (use `Badge`), a
 * collection whose items have their own detail (use a `DataGrid`).
 * Props: `onRemove` gets the tag's `value` (confirm and call the server there); without it no tag
 * shows a remove button; `empty` is shown muted when there are no tags; `removeLabel` builds each
 * remove button's name (default "Remove <value>").
 * Rules: a fixed tag (from configuration a person cannot change here) says why in `fixed`.
 * Under a disabled fieldset the remove buttons are disabled with it.
 */
export function TagList({ items, onRemove, empty, removeLabel = (v) => `Remove ${v}`, label, className }: {
  items: TagItem[]
  onRemove?: (value: string) => void
  empty?: React.ReactNode
  removeLabel?: (value: string) => string
  /** The list's accessible name. */
  label?: string
  className?: string
}) {
  if (items.length === 0) return empty != null ? <span className='text-body-sm text-muted-foreground'>{empty}</span> : null
  return (
    <ul aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {items.map((t) => (
        <li
          key={t.value}
          title={t.title}
          className='inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface py-0.5 pr-1 pl-2.5 text-label text-text'>
          <span className='truncate'>{t.label ?? t.value}</span>
          {t.fixed != null ? (
            <span className='pr-1.5 text-fg-4'>{t.fixed}</span>
          ) : onRemove ? (
            <button
              type='button'
              aria-label={removeLabel(t.value)}
              onClick={() => onRemove(t.value)}
              className='grid size-4 place-items-center rounded-full text-muted-foreground hover:bg-danger-bg hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50'>
              <X className='size-3' />
            </button>
          ) : (
            <span className='pr-1.5' />
          )}
        </li>
      ))}
    </ul>
  )
}
