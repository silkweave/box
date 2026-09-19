import { Check } from 'lucide-react'
import { cn } from '../lib/utils.ts'

/**
 * Token-styled checkbox (appearance-none native input, so forms/labels behave normally): theme
 * bg + border when unchecked, accent fill with a check glyph when checked. Wrap in a <label>
 * for a text click-surface.
 *
 * `ref` reaches the input (React 19 passes it as an ordinary prop), which is the only way to set
 * `indeterminate` - it is a DOM property with no HTML attribute behind it, so a "some but not all"
 * box cannot be expressed in JSX alone.
 */
export function Checkbox({
  className,
  ref,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <span className={cn('relative inline-flex shrink-0 items-center justify-center', className)}>
      <input
        type='checkbox'
        ref={ref}
        {...props}
        className={cn(
          'peer size-4 cursor-pointer appearance-none rounded-[4px] border border-border-strong bg-bg',
          'transition-colors hover:border-accent checked:border-accent checked:bg-accent',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
      <Check
        strokeWidth={3}
        className='pointer-events-none absolute size-3 text-accent-fg opacity-0 transition-opacity peer-checked:opacity-100'
      />
    </span>
  )
}
