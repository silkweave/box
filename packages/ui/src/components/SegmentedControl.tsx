import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { useFieldControl } from './Field.tsx'

/**
 * A segmented button group: a short, flat set of mutually exclusive choices, rendered as pills in a
 * bordered track.
 *
 * It draws a CHOICE, and has no idea what the choice means. The optional `label` is how a caller
 * says "Group by" or "Show" or "Sort" - the control itself never composes that sentence, which is
 * what let one widget serve grouping, layout switching and range selection instead of one component
 * per use.
 *
 * Use it for 2-5 options where seeing all of them at once is the point. Past that, a `Select`.
 * The track is a `role='group'`: inside a `Field` the field's label names it; outside one pass
 * `aria-label` (or `label`, which names it too).
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
  'aria-label': ariaLabel,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  /** Rendered before the track, e.g. `"Group by"`. Omit for a bare control. */
  label?: React.ReactNode
  className?: string
  /** The group's name outside a `Field` when there is no visible `label`. */
  'aria-label'?: string
}) {
  const field = useFieldControl()
  const labelId = React.useId()
  const labelledBy = label ? labelId : ariaLabel ? undefined : field?.labelId
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {label ? <span id={labelId} className='text-label text-muted-foreground'>{label}</span> : null}
      <div
        role='group'
        id={field?.id}
        aria-label={label ? undefined : ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={field?.describedBy}
        className='flex items-center rounded-md border border-border bg-surface p-0.5'>
        {options.map((o) => (
          <button
            key={o.value}
            type='button'
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={cn(
              'rounded px-2.5 py-1 text-label font-medium transition-colors disabled:cursor-not-allowed',
              // Disabled (a member's read-only page): the chosen option still reads as the value.
              value === o.value ? 'bg-accent-tint text-accent' : 'text-muted-foreground hover:text-text disabled:opacity-40 disabled:hover:text-muted-foreground',
            )}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
