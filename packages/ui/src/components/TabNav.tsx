import { cn } from '../lib/utils.ts'

/**
 * An underlined tab bar: the sub-pages of one view, laid along a bottom rule with the current one
 * marked by an accent underline. It is navigation, so each tab is a button carrying `aria-current`
 * and the caller decides what "open" means (a route, a hash, state).
 *
 * Use it for the pages of a view. For a choice that filters or regroups what is on screen, use
 * `SegmentedControl`.
 */
export function TabNav<T extends string>({
  value,
  items,
  onChange,
  label,
  className,
}: {
  value: T
  items: { value: T; label: React.ReactNode }[]
  onChange: (v: T) => void
  /** The nav landmark's accessible name, e.g. `"Automation sections"`. */
  label: string
  className?: string
}) {
  return (
    <nav aria-label={label} className={cn('flex gap-5 border-b border-border', className)}>
      {items.map((item) => {
        const current = item.value === value
        return (
          <button
            key={item.value}
            type='button'
            aria-current={current ? 'page' : undefined}
            onClick={() => onChange(item.value)}
            className={cn(
              '-mb-px border-b-2 pt-1 pb-2.5 text-body-sm transition-colors',
              current ? 'border-accent font-medium text-text' : 'border-transparent text-muted-foreground hover:border-border hover:text-text',
            )}>
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}
