import { cn } from '../lib/utils.ts'

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
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  /** Rendered before the track, e.g. `"Group by"`. Omit for a bare control. */
  label?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {label ? <span className='text-label text-muted-foreground'>{label}</span> : null}
      <div className='flex items-center rounded-md border border-border bg-surface p-0.5'>
        {options.map((o) => (
          <button
            key={o.value}
            type='button'
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={cn(
              'rounded px-2.5 py-1 text-label font-medium transition-colors',
              value === o.value ? 'bg-accent-tint text-accent' : 'text-muted-foreground hover:text-text',
            )}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
