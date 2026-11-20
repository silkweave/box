import { cn } from '../lib/utils.ts'

const TONE = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-fg-4',
  accent: 'bg-accent',
} as const

/**
 * A small coloured dot that states health: connected, needs attention, failing, idle.
 *
 * Use it for: the state of a server, channel, job or mailbox beside its name, in rows and headers.
 * Not for: a state with words of its own in a pill (use `Badge` with `dot`), progress, or decoration.
 * Props: `tone` success healthy, warning needs attention, danger failing, neutral off or unknown,
 * accent active; `pulse` for running or connecting.
 * Rules: colour alone is not a label. Pass `label` (sr-only text and title) unless visible text
 * beside the dot already says the state; without it the dot is hidden from assistive tech.
 */
export function StatusDot({
  tone,
  label,
  pulse,
  className,
}: {
  tone: 'success' | 'warning' | 'danger' | 'neutral' | 'accent'
  /** sr-only text and title; omit only beside visible text that says the same. */
  label?: string
  /** A soft ping for running or connecting; still under reduced motion. */
  pulse?: boolean
  className?: string
}) {
  return (
    <span
      title={label}
      aria-hidden={label ? undefined : true}
      className={cn('relative inline-flex size-2 shrink-0', className)}>
      {pulse && <span className={cn('absolute inset-0 rounded-full opacity-60 motion-safe:animate-ping', TONE[tone])} />}
      <span className={cn('relative inline-flex size-full rounded-full', TONE[tone])} />
      {label && <span className='sr-only'>{label}</span>}
    </span>
  )
}
