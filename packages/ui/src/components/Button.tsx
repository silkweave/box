import { cn } from '../lib/utils.ts'
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { type VariantProps, cva } from 'class-variance-authority'
import { type FunctionComponent } from 'react'

/**
 * `aria-pressed` is styled, not propped. A two-state button (show/hide, pin/unpin, mute/unmute) is
 * this component with the ARIA attribute set - it was never a component of its own, which is what
 * `ShowAllToggle` had to learn the hard way (it hand-rolled these exact class strings twice, once
 * for a ghost icon and once for an outlined one, and bolted a localStorage key onto the result).
 */
const buttonVariants = cva(
  'group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
  {
    variants: {
      variant: {
        // Primary CTA carries the only flourish the brand allows: the indigo glow
        // (accent-ring + soft halo). Hover lifts toward accent-hover, never darker.
        default: 'bg-primary text-primary-foreground shadow-(--shadow-glow) hover:bg-(--accent-solid-hover)',
        outline:
          'border-border bg-background shadow-xs hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:text-accent aria-pressed:border-accent/40',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground aria-pressed:text-accent',
        destructive: 'bg-destructive/10 text-destructive hover:bg-destructive/20',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        'default': 'h-9 gap-1.5 px-2.5',
        'xs': 'h-6 gap-1 rounded-[min(var(--radius-md),8px)] px-2 text-xs [&_svg:not([class*=\'size-\'])]:size-3',
        'sm': 'h-8 gap-1 rounded-[min(var(--radius-md),10px)] px-2.5',
        'lg': 'h-10 gap-1.5 px-2.5',
        'icon': 'size-9',
        'icon-xs': 'size-6 rounded-[min(var(--radius-md),8px)] [&_svg:not([class*=\'size-\'])]:size-3',
        'icon-sm': 'size-8 rounded-[min(var(--radius-md),10px)]',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

/**
 * The house button, for every act a person presses.
 * `variant`: `default` (primary) for the one main act, `outline` for the second, `ghost` for Cancel and
 * quiet row or group actions, `destructive` for a confirmed delete, `link` inline in prose.
 * `size`: `sm` in Settings and toolbars; the `icon*` sizes for an icon-only button.
 * Not for an icon-only row action (`IconButton`: required label, row sizing), copying a value
 * (`CopyButton`), or navigation that must stay a link (`NavAnchor`).
 * A two-state button is this with `aria-pressed` set; the pressed style is built in.
 * Rule: an icon-only Button needs `aria-label` (and `title`); no icon on Save or Cancel.
 */
export const Button: FunctionComponent<
  ButtonPrimitive.Props & VariantProps<typeof buttonVariants>
> = ({ className, variant = 'default', size = 'default', ...props }) => {
  return (
    <ButtonPrimitive
      data-slot='button'
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { buttonVariants }
