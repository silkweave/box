import * as React from 'react'
import { Check, Loader2, TriangleAlert } from 'lucide-react'
import { cn } from '../lib/utils.ts'

export type SaveStatusValue = 'idle' | 'loading' | 'dirty' | 'saving' | 'saved' | 'error'

const LABEL: Record<Exclude<SaveStatusValue, 'idle'>, string> = {
  loading: 'Loading…',
  dirty: 'Unsaved',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
}

const ICON: Record<Exclude<SaveStatusValue, 'idle'>, React.ReactNode> = {
  loading: <Loader2 className='size-3 animate-spin' />,
  dirty: <span className='size-1.5 rounded-full bg-muted-foreground' />,
  saving: <Loader2 className='size-3 animate-spin text-accent' />,
  saved: <Check className='size-3 text-success' />,
  error: <TriangleAlert className='size-3 text-danger' />,
}

/**
 * Where an autosaving editor's document stands: loading, unsaved changes, saving, saved, failed.
 *
 * Use it for: a document editor that saves by itself (the Sink, a CRM account doc, a content body),
 * in its toolbar or top bar.
 * Not for: a form with a Save button (`SettingsSaveBar`'s note), a single autosaved control (its own
 * short "Saved").
 * Props: `compact` shows the icon only (the label stays for screen readers and as the tooltip), for
 * a toolbar with no room; `idle` renders nothing.
 */
export function SaveStatus({ status, compact = false, className }: { status: SaveStatusValue | undefined; compact?: boolean; className?: string }) {
  if (!status || status === 'idle') return null
  return (
    <span role='status' title={compact ? LABEL[status] : undefined} className={cn('inline-flex shrink-0 items-center gap-1 text-label text-muted-foreground', className)}>
      <span aria-hidden className='grid size-3 place-items-center'>{ICON[status]}</span>
      <span className={compact ? 'sr-only' : undefined}>{LABEL[status]}</span>
    </span>
  )
}
