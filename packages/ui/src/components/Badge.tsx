import { cn } from '../lib/utils.ts'
import { type VariantProps, cva } from 'class-variance-authority'
import { type FunctionComponent, type HTMLAttributes } from 'react'

// Pill badge - semantic state + the reserved `silk` brand variant. Color is
// information, never decoration: pick the variant that matches the real state.
// `silk` (the multi-stop gradient) is for top-of-surface brand accents only -
// at most once per surface (design guide).
const badgeVariants = cva(
  'inline-flex items-center rounded-full border font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'border-border-light bg-[var(--bg-code)] text-fg-2',
        accent: 'border-accent/30 bg-accent-bg text-accent',
        success: 'border-success/30 bg-success-bg text-success',
        warning: 'border-warning/30 bg-warning-bg text-warning',
        danger: 'border-danger/30 bg-danger-bg text-danger',
        info: 'border-info/30 bg-info-bg text-info',
        silk: 'border-transparent text-white',
      },
      mono: { true: 'font-mono', false: '' },
      // `sm` for several tags on one dense line (a list row's status tags); `xs` beside a name inside
      // a 20px line (a 16px box, so the line never grows; `NameCell` uses it); `md` everywhere else.
      size: {
        md: 'gap-1.5 px-2.5 py-0.5 text-label leading-relaxed',
        sm: 'gap-1 px-1.5 py-0 text-[11px] leading-[1.35rem]',
        xs: 'h-4 gap-1 px-1.5 py-0 text-[10.5px] leading-none',
      },
    },
    defaultVariants: { variant: 'neutral', mono: false, size: 'md' },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Render a leading status dot in the current color. */
  dot?: boolean
}

/**
 * A pill naming a state or a kind ("Connected", "Admin", "Built in"), in sentence case.
 * Use it where the tone carries meaning: `success` healthy, `warning` needs attention, `neutral` a
 * kind, `accent` a role, `danger` failed, `info` queued or informational.
 * Not for a bare health light (`StatusDot`), a nav count (the sidebar item's `count`), or anything
 * pressable (`Button`; `SegmentedControl` for a choice).
 * `silk` is the brand gradient, at most once per surface. `size='sm'` for several badges on one dense
 * row; `dot` repeats the state without relying on colour alone; `mono` for identifiers.
 */
export const Badge: FunctionComponent<BadgeProps> = ({
  className,
  variant = 'neutral',
  mono,
  size,
  dot,
  children,
  style,
  ...props
}) => {
  return (
    <span
      data-slot='badge'
      className={cn(badgeVariants({ variant, mono, size, className }))}
      style={variant === 'silk' ? { background: 'var(--silk-gradient)', ...style } : style}
      {...props}>
      {dot && <span className='size-1.5 rounded-full bg-current' />}
      {children}
    </span>
  )
}

export { badgeVariants }
