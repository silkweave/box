import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { useFieldControl } from './Field.tsx'
import { isInvalid as resolveInvalid, joinIds, textControlCls, textFrameCls, textInvalidCls } from './textControl.ts'

/**
 * The kit's multi-line text input, framed like `Input`.
 *
 * Use it for: descriptions, notes, prompts, JSON or a list of addresses one per line.
 * Not for: one line (use `Input`), formatted text (use the editor from `@silkweave/box-ui/editor`).
 * Props: `autoGrow` grows with its content from `rows` (3 by default) up to `maxRows`, then scrolls;
 * `mono` for code and JSON; `invalid` sets `aria-invalid` and the danger border.
 * Rules: inside a `Field` it takes its id, `aria-describedby` and invalid state from the field.
 */
export function Textarea({
  invalid,
  mono,
  autoGrow,
  maxRows,
  rows = 3,
  className,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  onInput,
  ref,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Sets `aria-invalid` and the danger border. A surrounding `Field` with an `error` sets it too. */
  invalid?: boolean
  /** Monospace, for code, JSON and keys. */
  mono?: boolean
  /** Grow with the content from `rows` up to `maxRows`; the manual resize handle goes away. */
  autoGrow?: boolean
  /** The tallest an `autoGrow` textarea gets before it scrolls. No limit when unset. */
  maxRows?: number
  ref?: React.Ref<HTMLTextAreaElement>
}) {
  const field = useFieldControl()
  const bad = resolveInvalid(invalid, ariaInvalid, field?.invalid)
  const inner = React.useRef<HTMLTextAreaElement | null>(null)

  const setRef = React.useCallback(
    (el: HTMLTextAreaElement | null) => {
      inner.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    },
    [ref],
  )

  const resize = React.useCallback(() => {
    const el = inner.current
    if (!el || !autoGrow) return
    const cs = getComputedStyle(el)
    const line = parseFloat(cs.lineHeight) || 20
    const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    el.style.height = 'auto'
    const content = el.scrollHeight + border
    const min = line * rows + padding + border
    const max = maxRows ? line * maxRows + padding + border : Infinity
    el.style.height = `${Math.min(Math.max(content, min), max)}px`
    el.style.overflowY = content > max ? 'auto' : 'hidden'
  }, [autoGrow, rows, maxRows])

  React.useLayoutEffect(resize, [resize, props.value])

  return (
    <textarea
      ref={setRef}
      rows={rows}
      id={id ?? field?.id}
      aria-describedby={joinIds(describedBy, field?.describedBy)}
      aria-invalid={bad || undefined}
      onInput={(e) => {
        resize()
        onInput?.(e)
      }}
      {...props}
      className={cn(
        textFrameCls,
        textControlCls,
        'block px-2.5 py-1.5',
        autoGrow ? 'resize-none' : 'resize-y',
        mono && 'font-mono',
        bad && textInvalidCls,
        className,
      )}
    />
  )
}
