import { cn } from '../lib/utils.ts'
import { useFieldControl } from './Field.tsx'
import { Input } from './Input.tsx'

const HEX = /^#[0-9a-f]{6}$/i

/**
 * A colour as a swatch that opens the system picker beside its hex value, which can be typed.
 *
 * Use it for: a brand or accent colour in a form (a Help Center's accent, a label's colour).
 * Not for: picking from a fixed palette (use `SegmentedControl` or `SelectField` with the names).
 * Props: `value` is a `#rrggbb` string (or anything typed so far); `fallback` is the swatch's colour
 * while the text is not a full hex value.
 * Rules: inside a `Field` the text input takes the field's id, so the label names it; the swatch is
 * named "Pick <label>" through `pickLabel`. Typed text is passed on trimmed, even when incomplete:
 * the caller validates on save.
 */
export function ColorInput({ value, onChange, fallback = '#7b7ef5', pickLabel = 'Pick a colour', disabled, className }: {
  value: string
  onChange: (value: string) => void
  /** The swatch while `value` is not `#rrggbb`. */
  fallback?: string
  /** The swatch button's accessible name. */
  pickLabel?: string
  disabled?: boolean
  className?: string
}) {
  const field = useFieldControl()
  const hex = HEX.test(value) ? value : fallback
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <input
        type='color'
        aria-label={pickLabel}
        aria-describedby={field?.describedBy}
        value={hex.toLowerCase()}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className='h-9 w-11 shrink-0 cursor-pointer rounded-md border border-border bg-bg p-1 disabled:cursor-not-allowed disabled:opacity-50'
      />
      <Input mono className='w-28' value={value} disabled={disabled} spellCheck={false} onChange={(e) => onChange(e.target.value.trim())} />
    </div>
  )
}
