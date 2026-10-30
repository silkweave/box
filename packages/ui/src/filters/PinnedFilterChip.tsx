// A pinned filter: one field brought out of the funnel into the bar, as a chip that says the field
// and its value ("Owner: Anna, Ben", "Due: Any"). Click it for that one field's editor; while it is
// narrowing it is accent-tinted and carries its own x, joined to it the way the funnel's x is.
//
// A preset decides which fields are pinned, so a lens like "My week" can put the two questions it is
// about where they can be answered without opening anything.

import { X } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../components/Popover.tsx'
import { FilterEditor } from './editors.tsx'
import { isActive, summarize } from './match.ts'
import type { FilterField, FilterValue } from './types.ts'

export function PinnedFilterChip({
  field,
  value,
  onChange,
  today,
}: {
  field: FilterField
  value: unknown
  onChange: (next: FilterValue | null) => void
  /** The date editor's "today" (the default clock when absent). */
  today?: string
}) {
  const active = isActive(field.type, value)
  const text = summarize(field, value)
  return (
    <div className='inline-flex items-center'>
      <Popover>
        <PopoverTrigger
          aria-label={`${field.title}: ${text}`}
          title={`${field.title}: ${text}`}
          className={cn(
            'inline-flex h-7 max-w-56 items-center gap-1 rounded-md border px-2 text-body-sm transition-colors',
            active
              ? 'rounded-r-none border-r-0 border-accent/40 bg-accent-tint text-accent'
              : 'border-border bg-bg text-text hover:border-accent/40',
          )}>
          <span className={cn('shrink-0', !active && 'text-muted-foreground')}>{field.title}:</span>
          <span className='truncate'>{text}</span>
        </PopoverTrigger>
        <PopoverContent align='start' side='bottom' className='flex max-h-[70vh] w-64 flex-col gap-1 overflow-y-auto p-1.5'>
          <span className='px-1.5 pt-0.5 text-label font-medium text-muted-foreground'>{field.title}</span>
          <FilterEditor field={field} value={value} onChange={onChange} today={today} />
          {field.note && <span className='px-1.5 pt-1 text-label text-muted-foreground'>{field.note}</span>}
        </PopoverContent>
      </Popover>
      {active && (
        <button
          type='button'
          onClick={() => onChange(null)}
          aria-label={`Clear ${field.title}`}
          title={`Clear ${field.title}`}
          className='inline-flex h-7 items-center rounded-r-md border border-accent/40 bg-accent-tint px-1 text-accent transition-colors hover:bg-accent/20'>
          <X className='size-3.5' />
        </button>
      )}
    </div>
  )
}
