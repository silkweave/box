import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { CopyButton } from './CopyButton.tsx'
import { Field } from './Field.tsx'
import { IconButton } from './IconButton.tsx'
import { Input } from './Input.tsx'

/**
 * A read-only value in an input box with its copy button; a labelled `Field` when `label` is given.
 *
 * Use it for: a webhook URL, a client id, a redirect URI, a command to paste, a token shown once.
 * Not for: an editable value (use `Input` with a `CopyButton` in `trailing`), a value in a list of
 * label and value facts (use `SettingsFact` with `copy`).
 * Props: `mono` (default true) for ids and URLs, false for prose; `secret` masks the value with a
 * show toggle; the copy button always copies the real value.
 * Rules: focusing the box selects the whole value, so a manual copy takes all of it.
 */
export function CopyField({
  value,
  label,
  hint,
  mono = true,
  secret,
  className,
  'aria-label': ariaLabel,
}: {
  value: string
  /** Wraps the box in a `Field` with this label. Without it, pass `aria-label`. */
  label?: React.ReactNode
  /** One line under the box; needs `label`. */
  hint?: React.ReactNode
  /** Monospace (default true); pass false for prose. */
  mono?: boolean
  /** Masked until the eye is pressed, for tokens and keys shown once. */
  secret?: boolean
  className?: string
  /** The box's name when there is no `label` ("Webhook URL"). */
  'aria-label'?: string
}) {
  const [shown, setShown] = React.useState(false)
  const masked = secret && !shown
  const box = (
    <Input
      readOnly
      aria-label={label ? undefined : ariaLabel}
      mono={mono}
      value={masked ? '•'.repeat(Math.min(Math.max(value.length, 8), 32)) : value}
      onFocus={(e) => {
        if (!masked) e.currentTarget.select()
      }}
      className={label ? undefined : className}
      trailing={
        <>
          {secret && (
            <IconButton
              label={shown ? 'Hide' : 'Show'}
              icon={shown ? <EyeOff /> : <Eye />}
              aria-pressed={shown}
              onClick={() => setShown((s) => !s)}
            />
          )}
          <CopyButton value={value} />
        </>
      }
    />
  )
  if (!label) return box
  return (
    <Field label={label} hint={hint} className={className}>
      {box}
    </Field>
  )
}
