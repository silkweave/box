import { Search, X } from 'lucide-react'
import { cn } from '../lib/utils.ts'

/**
 * A controlled search field: leading magnifier, trailing clear button once there is text, and
 * Escape to clear. Filtering is the caller's; this only draws the field.
 * Use it above the list or grid it filters (a picker popover; a list's search is the `DataGrid` bar's). Not for a
 * form value (`Input`) or free text with suggestions (`Autocomplete`).
 * Props: `size='sm'` is the 28px field of the filter bars (`BoardViewBar`).
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  label,
  autoFocus,
  size = 'default',
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Accessible name. Defaults to the placeholder. */
  label?: string
  autoFocus?: boolean
  size?: 'default' | 'sm'
  className?: string
}) {
  const sm = size === 'sm'
  return (
    <div data-slot='search-input' className={cn('relative', className)}>
      <Search className={cn('pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground', sm ? 'left-2 size-3.5' : 'left-2.5 size-4')} />
      <input
        type='search'
        value={value}
        autoFocus={autoFocus}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape' && value) { event.preventDefault(); onChange('') } }}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className={cn(
          'w-full border border-border bg-bg text-body-sm text-text transition-colors outline-none placeholder:text-fg-4 hover:border-accent/40 focus:border-accent [&::-webkit-search-cancel-button]:hidden',
          sm ? 'h-7 rounded-md pr-7 pl-7' : 'h-9 rounded-lg pr-8 pl-8.5',
        )}
      />
      {value && (
        <button
          type='button'
          onClick={() => onChange('')}
          aria-label='Clear search'
          className={cn('absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-hover hover:text-text', sm ? 'right-1 size-5' : 'right-1.5 size-6')}>
          <X className='size-3.5' />
        </button>
      )}
    </div>
  )
}
