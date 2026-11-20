import { useRef } from 'react'
import { Pencil } from 'lucide-react'
import { cn } from '../lib/utils.ts'

interface InlineEditProps {
  defaultValue?: string | number
  /** Called on blur (and Enter for single-line) only when the value changed. Return the write's
   *  promise: when it rejects, the field shows the stored value again (report the failure yourself,
   *  with `notifyError`). */
  onCommit: (value: string) => unknown
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
  /** 'always' keeps the pencil showing at rest, so a table cell reads as editable before it is
   *  hovered; 'hover' (the default) shows it only on hover, for forms where every field edits. */
  icon?: 'hover' | 'always'
  'aria-label'?: string
}

/**
 * One commit of an `InlineEdit` (exported for its test): calls `onCommit` when the text changed;
 * when the returned promise rejects, the field goes back to the stored value, unless the person has
 * typed or committed again since (a newer edit, or its own request, owns the field then).
 */
export function commitEdit(
  el: { value: string },
  orig: string,
  onCommit: (value: string) => unknown,
  generation: { current: number },
  focused: () => boolean,
): void {
  if (el.value === orig) return
  const sent = el.value
  const mine = ++generation.current
  const done = onCommit(sent)
  if (done instanceof Promise) done.catch(() => { if (mine === generation.current && !focused() && el.value === sent) el.value = orig })
}

// A field that reads as presentable text at rest, hints it's editable with a
// subtle pencil + a soft highlight on hover, and becomes a prominent input on
// focus/click. It is always a real input under the hood (commit on blur / Enter);
// the "view mode" is purely the resting style.
const restCls =
  'peer w-full rounded-md border border-transparent bg-transparent text-body-sm text-text outline-none transition-colors placeholder:text-fg-4 hover:border-border-light hover:bg-accent-tint focus:cursor-text focus:border-accent focus:bg-bg'

/**
 * A field that reads as text at rest and edits in place: a pencil and a soft highlight on hover, a
 * real input on focus. Commits on blur and Enter (single line) only when the value changed; Escape
 * restores it.
 * Use it for a record's own fields on its detail view or in a table cell, where every edit saves at once.
 * Not for a form with a Save button (`Input` inside a `Field`) or a record name in the top bar (the
 * crumb's `onRename`).
 * `icon='always'` shows the pencil at rest (table cells). Uncontrolled: a changed `defaultValue`
 * does not replace the text on screen; give it a `key` to reseed. A failed write restores the text
 * when `onCommit` returns its promise and it rejects.
 */
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
  icon = 'hover',
  'aria-label': ariaLabel,
}: InlineEditProps) {
  const orig = String(defaultValue ?? '')
  // Each commit's number: only the latest commit's rejection may reset the field.
  const generation = useRef(0)
  const commit = (el: HTMLInputElement | HTMLTextAreaElement) => {
    commitEdit(el, orig, onCommit, generation, () => document.activeElement === el)
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
          'pointer-events-none absolute right-2 size-3.5 text-muted-foreground transition-opacity peer-focus:opacity-0',
          icon === 'always' ? 'opacity-40 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-50',
          multiline ? 'top-2.5' : 'top-1/2 -translate-y-1/2',
        )}
      />
    </div>
  )
}
