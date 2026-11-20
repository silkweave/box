import * as React from 'react'
import { cn } from '../lib/utils.ts'

/**
 * A quiet, icon-only button with a required label: the row and group action of the kit.
 *
 * Use it for: row actions (edit, open), a pencil beside a value, a toolbar Refresh, the eye on a
 * masked secret.
 * Not for: the main act of a page or a labelled action (use `Button`), several acts on one row (use
 * `ActionMenu`), deleting a row (Delete lives in the detail footer and the row's "..." menu).
 * Props: `label` is the aria-label and the title; `tone` danger turns red on hover only; `size` sm
 * (size-7, rows) or md (size-8, beside `Button size='sm'`).
 * Rules: `type='button'` by default, so it never submits the form it sits in.
 */
export function IconButton({
  label,
  icon,
  tone = 'default',
  size = 'sm',
  type = 'button',
  className,
  ref,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** Required: the aria-label and the hover title. */
  label: string
  /** A lucide icon; sized to 16px unless it carries its own `size-*` class. */
  icon: React.ReactNode
  /** danger: red on hover, for a destructive act that is not a row delete. */
  tone?: 'default' | 'danger'
  /** sm = size-7 for rows (default), md = size-8 beside small buttons. */
  size?: 'sm' | 'md'
  ref?: React.Ref<HTMLButtonElement>
}) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      {...props}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none',
        'focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        size === 'sm' ? 'size-7' : 'size-8',
        tone === 'danger' ? 'hover:bg-danger-bg hover:text-danger' : 'hover:bg-accent-tint hover:text-accent aria-pressed:text-accent',
        className,
      )}>
      {icon}
    </button>
  )
}
