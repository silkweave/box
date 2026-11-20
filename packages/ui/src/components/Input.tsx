import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { useFieldControl } from './Field.tsx'
import { isInvalid as resolveInvalid, joinIds, textControlCls, textFrameCls, textInvalidCls } from './textControl.ts'

const SIZE = {
  md: 'px-2.5 py-1.5',
  sm: 'h-7 px-2 py-0',
} as const

/**
 * The kit's single-line text input, styled like every other form control.
 *
 * Use it for: names, addresses, keys, numbers and search boxes in forms, toolbars and dense rows.
 * Not for: several lines (use `Textarea`), a choice from a list (use `SelectField`), a read-only
 * value to copy (use `CopyField`), a click-to-edit title (use `InlineEdit`).
 * Props: `size` md (forms, default) or sm (toolbars, dense rows); `mono` for ids, keys and URLs;
 * `invalid` sets `aria-invalid` and the danger border; `leading` and `trailing` sit inside the edges
 * (an icon, a unit, a `CopyButton`).
 * Rules: inside a `Field` it takes its id, `aria-describedby` and invalid state from the field.
 */
export function Input({
  size = 'md',
  invalid,
  mono,
  leading,
  trailing,
  className,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ref,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  /** md for settings forms (default), sm for toolbars and dense rows. */
  size?: 'sm' | 'md'
  /** Sets `aria-invalid` and the danger border. A surrounding `Field` with an `error` sets it too. */
  invalid?: boolean
  /** Monospace, for ids, keys and URLs. */
  mono?: boolean
  /** An icon or short prefix inside the left edge. */
  leading?: React.ReactNode
  /** Inside the right edge: a unit, a `CopyButton`. */
  trailing?: React.ReactNode
  ref?: React.Ref<HTMLInputElement>
}) {
  const field = useFieldControl()
  const isInvalid = resolveInvalid(invalid, ariaInvalid, field?.invalid)
  const input = (
    <input
      ref={ref}
      id={id ?? field?.id}
      aria-describedby={joinIds(describedBy, field?.describedBy)}
      aria-invalid={isInvalid || undefined}
      {...props}
      className={
        leading || trailing
          ? cn(
              'min-w-0 flex-1 self-stretch bg-transparent text-inherit outline-none placeholder:text-fg-4 disabled:cursor-not-allowed',
              size === 'sm' ? 'h-full px-2 py-0' : 'px-2.5 py-1.5',
              leading && 'pl-1.5',
              trailing && 'pr-1.5',
              mono && 'font-mono',
            )
          : cn(
              textFrameCls,
              textControlCls,
              SIZE[size],
              mono && 'font-mono',
              isInvalid && textInvalidCls,
              className,
            )
      }
    />
  )
  if (!leading && !trailing) return input
  return (
    <div
      className={cn(
        textFrameCls,
        'flex w-full min-w-0 items-center focus-within:border-accent',
        'has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50',
        size === 'sm' && 'h-7',
        isInvalid && 'border-danger hover:border-danger focus-within:border-danger',
        className,
      )}>
      {leading && (
        <span className={cn('flex shrink-0 items-center text-fg-4 [&_svg]:size-3.5', size === 'sm' ? 'pl-2' : 'pl-2.5')}>{leading}</span>
      )}
      {input}
      {trailing && <span className='flex shrink-0 items-center gap-1 pr-1 text-fg-4'>{trailing}</span>}
    </div>
  )
}
