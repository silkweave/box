import { Pencil } from 'lucide-react'
import { cn } from '../lib/utils.ts'

interface InlineEditProps {
  defaultValue?: string | number
  /** Called on blur (and Enter for single-line) only when the value changed. */
  onCommit: (value: string) => void
  type?: 'text' | 'number'
  multiline?: boolean
  placeholder?: string
  className?: string
  inputClassName?: string
  min?: number
  max?: number
  rows?: number
  /** Focus the input on mount - used when the field is revealed by an explicit edit toggle. */
  autoFocus?: boolean
  /** Fired after commit on blur/Enter/Escape - lets a parent-controlled edit mode exit. */
  onDone?: () => void
  'aria-label'?: string
}

// A field that reads as presentable text at rest, hints it's editable with a
// subtle pencil + a soft highlight on hover, and becomes a prominent input on
// focus/click. It is always a real input under the hood (commit on blur / Enter);
// the "view mode" is purely the resting style.
const restCls =
  'peer w-full rounded-md border border-transparent bg-transparent text-body-sm text-text outline-none transition-colors placeholder:text-fg-4 hover:border-border-light hover:bg-accent-tint focus:cursor-text focus:border-accent focus:bg-bg'

export function InlineEdit({
  defaultValue,
  onCommit,
  type = 'text',
  multiline = false,
  placeholder,
  className,
  inputClassName,
  min,
  max,
  rows = 3,
  autoFocus,
  onDone,
  'aria-label': ariaLabel,
}: InlineEditProps) {
  const orig = String(defaultValue ?? '')
  const commit = (el: HTMLInputElement | HTMLTextAreaElement) => {
    if (el.value !== orig) onCommit(el.value)
    onDone?.()
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.currentTarget.value = orig
      e.currentTarget.blur()
    } else if (e.key === 'Enter' && !multiline) {
      e.preventDefault()
      e.currentTarget.blur()
    }
  }

  return (
    <div className={cn('group relative', className)}>
      {multiline ? (
        <textarea
          autoFocus={autoFocus}
          defaultValue={orig}
          placeholder={placeholder}
          rows={rows}
          aria-label={ariaLabel}
          onBlur={(e) => commit(e.currentTarget)}
          onKeyDown={onKeyDown}
          className={cn(restCls, 'resize-y px-2 py-1.5 pr-7 leading-relaxed', inputClassName)}
        />
      ) : (
        <input
          autoFocus={autoFocus}
          type={type}
          defaultValue={orig}
          placeholder={placeholder}
          min={min}
          max={max}
          aria-label={ariaLabel}
          onBlur={(e) => commit(e.currentTarget)}
          onKeyDown={onKeyDown}
          className={cn(restCls, 'h-8 px-2 pr-7', inputClassName)}
        />
      )}
      <Pencil
        aria-hidden
        className={cn(
          'pointer-events-none absolute right-2 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-50 peer-focus:opacity-0',
          multiline ? 'top-2.5' : 'top-1/2 -translate-y-1/2',
        )}
      />
    </div>
  )
}
