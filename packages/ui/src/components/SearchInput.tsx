import { Search, X } from 'lucide-react'
import { cn } from '../lib/utils.ts'

/**
 * A controlled search field: leading magnifier, trailing clear button once there is text, and
 * Escape to clear. Filtering is the caller's; this only draws the field.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  label,
  autoFocus,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Accessible name. Defaults to the placeholder. */
  label?: string
  autoFocus?: boolean
  className?: string
}) {
  return (
    <div data-slot='search-input' className={cn('relative', className)}>
      <Search className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground' />
      <input
        type='search'
        value={value}
        autoFocus={autoFocus}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape' && value) { event.preventDefault(); onChange('') } }}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className='h-9 w-full rounded-lg border border-border bg-bg pr-8 pl-8.5 text-body-sm text-text transition-colors outline-none placeholder:text-fg-4 hover:border-accent/40 focus:border-accent [&::-webkit-search-cancel-button]:hidden'
      />
      {value && (
        <button
          type='button'
          onClick={() => onChange('')}
          aria-label='Clear search'
          className='absolute top-1/2 right-1.5 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-text'>
          <X className='size-3.5' />
        </button>
      )}
    </div>
  )
}
