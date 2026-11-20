import { cn } from '../lib/utils.ts'
import { useFieldControl } from './Field.tsx'

const SIZE = {
  md: { track: 'h-[18px] w-8', thumb: 'size-3.5 peer-checked:translate-x-[14px]' },
  sm: { track: 'h-4 w-7', thumb: 'size-3 peer-checked:translate-x-3' },
} as const

/**
 * An on and off switch for a setting that takes effect as a state: enabled, armed, paused.
 *
 * Use it for: turning a trigger, a source, a pod or a tool on or off, usually at the right of a
 * `SettingsControlRow` or inside a `Field`.
 * Not for: picking items in a set or agreeing to something (use `Checkbox`), choosing between named
 * options (use `SegmentedControl` or `SelectField`).
 * Props: controlled only (`checked`, `onCheckedChange`); `size` md (default) or sm for dense rows.
 * Rules: a native `<input type='checkbox' role='switch'>`, so a surrounding `<fieldset disabled>`
 * (read-only views) disables it without a prop. Needs a name: a `Field` label, a visible label
 * pointing at its `id`, or `aria-label`.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  size = 'md',
  'aria-label': ariaLabel,
  id,
  className,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  /** md (default) or sm for dense rows. */
  size?: 'sm' | 'md'
  /** Required when not inside a `Field` or beside a visible label. */
  'aria-label'?: string
  id?: string
  className?: string
}) {
  const field = useFieldControl()
  const s = SIZE[size]
  return (
    <span className={cn('relative inline-flex shrink-0 items-center', s.track, className)}>
      <input
        type='checkbox'
        role='switch'
        id={id ?? field?.id}
        aria-label={ariaLabel}
        aria-checked={checked}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.currentTarget.checked)}
        className={cn(
          'peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-full border border-border-strong bg-border-light',
          'transition-colors outline-none hover:border-accent checked:border-accent checked:bg-accent',
          'focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
      <span
        aria-hidden='true'
        className={cn(
          'pointer-events-none relative ml-[2px] rounded-full bg-bg shadow-xs transition-transform',
          'peer-disabled:opacity-70',
          s.thumb,
        )}
      />
    </span>
  )
}
