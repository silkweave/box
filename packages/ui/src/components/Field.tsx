import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { SettingsReadOnlyContext } from '../lib/readOnly.ts'

interface FieldControl {
  id: string
  /** The label element's id, for a control that is a group, not a labelable element. */
  labelId: string
  describedBy?: string
  invalid: boolean
}

const FieldControlContext = React.createContext<FieldControl | null>(null)
const FieldGridContext = React.createContext<1 | 2 | 3>(1)

/**
 * The id and aria wiring a `Field` hands its control, or `null` outside a `Field`.
 *
 * Use it for: a control that is not one of the kit's (`Input`, `Textarea`, `SelectField`, `Switch`,
 * `Checkbox` already read it), so its label, hint and error reach assistive tech.
 * Rules: an explicit `id` or `aria-describedby` on the control wins over the context, but then the
 * label no longer points at it; let the `Field` own the id. A control that is a group of buttons
 * (`SegmentedControl`) takes `role='group'` and `aria-labelledby={labelId}` instead.
 */
export function useFieldControl(): FieldControl | null {
  return React.useContext(FieldControlContext)
}

// Literal class strings per (grid columns, span), so Tailwind sees every one of them. Under the
// grid's breakpoint it is one column and every field takes the row.
const SPAN: Record<1 | 2 | 3, Record<1 | 2 | 3, string>> = {
  1: { 1: '', 2: 'col-span-full', 3: 'col-span-full' },
  2: { 1: '', 2: 'col-span-full', 3: 'col-span-full' },
  3: { 1: '', 2: '@xl:col-span-2', 3: 'col-span-full' },
}

/**
 * A labelled form control: label (with an optional aside), the control, then one line of hint or
 * error.
 *
 * Use it for: every text input, select, switch or picker in a form; no unlabelled control in a form.
 * Not for: a label and a read-only value (use `SettingsFact`), or a setting row with its control on
 * the right (use `SettingsControlRow`).
 * Rules: renders a `<div>` with `<label htmlFor>`, not a wrapping label, so non-native controls work.
 * It supplies the control's `id`, `aria-describedby` (the hint or error) and `aria-invalid` (when
 * `error` is set) through `useFieldControl()`; pass exactly one control as children. Under an active
 * `SettingsReadOnly` the control is disabled (the member view); the label and hint stay readable.
 */
export function Field({
  label,
  hint,
  error,
  aside,
  span = 1,
  className,
  children,
}: {
  /** Required: what the value is, in sentence case. "Optional" is never written here. */
  label: React.ReactNode
  /** One line: what the value does or its format. */
  hint?: React.ReactNode
  /** Replaces the hint in the danger tone and marks the control invalid. */
  error?: React.ReactNode
  /** Right of the label: a link, a count. */
  aside?: React.ReactNode
  /** Columns taken inside a `FieldGrid`; `full` takes the whole row. */
  span?: 1 | 2 | 3 | 'full'
  className?: string
  children: React.ReactNode
}) {
  const id = React.useId()
  const columns = React.useContext(FieldGridContext)
  const note = error ?? hint
  const noteId = note ? `${id}-note` : undefined
  const control = React.useMemo(() => ({ id, labelId: `${id}-label`, describedBy: noteId, invalid: Boolean(error) }), [id, noteId, error])
  const spanCls = span === 'full' ? 'col-span-full' : SPAN[columns][span]
  const readOnly = React.useContext(SettingsReadOnlyContext)
  return (
    <div className={cn('flex min-w-0 flex-col gap-1 text-label text-muted-foreground', spanCls, className)}>
      <div className='flex items-baseline justify-between gap-2'>
        <label id={`${id}-label`} htmlFor={id} className='flex min-w-0 flex-wrap items-baseline gap-x-2'>
          {label}
        </label>
        {aside && <div className='shrink-0 text-fg-4'>{aside}</div>}
      </div>
      <FieldControlContext.Provider value={control}>
        {readOnly ? <fieldset disabled className='contents'>{children}</fieldset> : children}
      </FieldControlContext.Provider>
      {note && (
        <span id={noteId} className={error ? 'text-danger' : 'text-fg-4'}>
          {note}
        </span>
      )}
    </div>
  )
}

const GRID: Record<1 | 2 | 3, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 @md:grid-cols-2',
  3: 'grid-cols-1 @xl:grid-cols-3',
}

/**
 * The form grid `Field`s sit in: 3 columns for short values, 2 for medium, 1 for long text and code.
 *
 * Use it for: every group of fields in a form, a create page and its detail page alike.
 * Not for: label and value facts (use `SettingsFacts`), or laying out non-form content.
 * Props: `columns` is the count at full width; the grid answers its container's width, not the
 * viewport's, so it collapses to one column in a narrow pane as well as on a small screen.
 * Rules: a `Field`'s `span` is resolved against these columns; a span wider than the grid takes the row.
 */
export function FieldGrid({ columns = 1, className, children }: { columns?: 1 | 2 | 3; className?: string; children: React.ReactNode }) {
  return (
    <div className='@container min-w-0'>
      <div className={cn('grid gap-x-4 gap-y-4', GRID[columns], className)}>
        <FieldGridContext.Provider value={columns}>{children}</FieldGridContext.Provider>
      </div>
    </div>
  )
}

/**
 * A titled, ruled group of fields inside a dialog form: a small uppercase title, a rule above every
 * section but the first, then its fields (usually a `FieldGrid`).
 *
 * Use it for: splitting a dialog form into named parts ("Data", "Details").
 * Not for: a Settings page or a routed create page (use `SettingsGroup`, which draws the canvas
 * gutter), or a single block of fields (a bare `FieldGrid` is enough).
 * Rules: renders `role='group'` named by its title, so a screen reader announces the part on entry.
 * Put the sections as siblings in one column; the first one drops its rule.
 */
export function FieldSection({
  title,
  aside,
  className,
  children,
}: {
  /** The part's name, in sentence case. */
  title: React.ReactNode
  /** Right of the title: a count, a small action. */
  aside?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  const id = React.useId()
  return (
    <div role='group' aria-labelledby={id} className={cn('flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0', className)}>
      <div className='flex items-baseline justify-between gap-2'>
        <h3 id={id} className='text-label tracking-[0.07em] text-muted-foreground uppercase'>
          {title}
        </h3>
        {aside && <div className='shrink-0 text-label text-fg-4'>{aside}</div>}
      </div>
      {children}
    </div>
  )
}
