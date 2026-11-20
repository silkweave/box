import * as React from 'react'
import { Check, Copy, X } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { buttonVariants } from './Button.tsx'

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * A button that puts a value on the clipboard and says so: a tick and "Copied" for 1.5 s, or
 * "Copy failed" when the browser refuses.
 *
 * Use it for: an id, a URL, a command or a token beside where it is shown, in an `Input`'s
 * `trailing` slot, or a "Copy" next to a code block.
 * Not for: a read-only value with its own box (use `CopyField`, which includes this), copying as a
 * side effect of another act.
 * Props: `value` is the text, or a function that produces it at click time (sync or async); `variant`
 * icon (default, `label` becomes the aria-label) or text (`label` is shown); `size` sm or md.
 * Rules: the result is announced to screen readers; it never submits a surrounding form. Copying
 * is reading, so it stays usable inside a disabled `<fieldset>` (a member's read-only page): it is a
 * `role='button'` element, not a `<button>`, which a disabled fieldset would switch off.
 */
export function CopyButton({
  value,
  label = 'Copy',
  variant = 'icon',
  size = 'sm',
  onCopied,
  className,
}: {
  /** The text to copy, or a function returning it (or a promise of it) when clicked. */
  value: string | (() => string | Promise<string>)
  /** Default 'Copy'. Shown as text when `variant='text'`, otherwise the aria-label and title. */
  label?: string
  /** icon (default) or text. */
  variant?: 'icon' | 'text'
  /** sm (default) for rows and input slots, md beside small buttons. */
  size?: 'sm' | 'md'
  /** Called after a successful copy. */
  onCopied?: () => void
  className?: string
}) {
  const [state, setState] = React.useState<CopyState>('idle')
  React.useEffect(() => {
    if (state === 'idle') return
    const t = setTimeout(() => setState('idle'), 1500)
    return () => clearTimeout(t)
  }, [state])

  const copy = async () => {
    try {
      const text = typeof value === 'function' ? await value() : value
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
      setState('copied')
      onCopied?.()
    } catch {
      setState('failed')
    }
  }

  const said = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label
  const icon = state === 'copied' ? <Check className='text-accent' /> : state === 'failed' ? <X className='text-danger' /> : <Copy />
  const live = (
    <span aria-live='polite' className='sr-only'>
      {state === 'idle' ? '' : said}
    </span>
  )

  // Not a <button>: a disabled fieldset (SettingsReadOnly) must not switch copying off.
  const press = {
    role: 'button',
    tabIndex: 0,
    'aria-label': variant === 'icon' ? said : undefined,
    title: variant === 'icon' ? said : undefined,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation()
      void copy()
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      e.stopPropagation()
      void copy()
    },
  } as const

  if (variant === 'text') {
    return (
      <span {...press} className={cn(buttonVariants({ variant: 'outline', size: size === 'sm' ? 'xs' : 'sm' }), 'cursor-pointer', className)}>
        {icon}
        {said}
        {live}
      </span>
    )
  }
  return (
    <span
      {...press}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors outline-none',
        'hover:bg-accent-tint hover:text-accent focus-visible:ring-3 focus-visible:ring-ring/50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        size === 'sm' ? 'size-7' : 'size-8',
        className,
      )}>
      {icon}
      {live}
    </span>
  )
}
