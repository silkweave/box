import { useState } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Check, X } from 'lucide-react'
import { useFieldControl } from './Field.tsx'

// A free-form multi-select over base-ui's Combobox, and the chip-list primitives other pickers
// build on. Design-system level: no feature vocabulary here - a token is whatever the caller says
// it is (a tag, a category, a dependency, an owner).

export const groupCls =
  'flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-md border border-border bg-bg px-2 py-1 text-body-sm transition-colors hover:border-accent/40 focus-within:border-accent/60'
export const inputCls = 'h-6 min-w-20 flex-1 border-0 bg-transparent p-0 text-body-sm text-text outline-none placeholder:text-fg-4'
export const popupCls =
  'max-h-[min(24rem,var(--available-height))] w-[var(--anchor-width)] origin-(--transform-origin) overflow-y-auto rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0'
export const itemCls =
  'grid cursor-pointer grid-cols-[1rem_1fr] items-center gap-2 rounded-sm px-2 py-1.5 text-body-sm text-text outline-none select-none data-highlighted:bg-accent-tint data-highlighted:text-text'

/**
 * The chips and the text input of a chip picker, shared by the pickers built on base-ui's Combobox.
 * Use it inside a `Combobox.Root` with `multiple`; on its own it renders nothing useful.
 */
export function ChipList({
  values,
  placeholder,
  labelOf,
  onInputKeyDown,
  'aria-label': ariaLabel,
}: {
  values: string[]
  placeholder: string
  labelOf: (v: string) => string
  onInputKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  /** The input's name outside a `Field`; inside one the field's label names it. */
  'aria-label'?: string
}) {
  const field = useFieldControl()
  return (
    <>
      {values.map((v) => (
        <Combobox.Chip
          key={v}
          aria-label={labelOf(v)}
          className='group flex items-center gap-1 rounded bg-accent-tint py-0.5 pr-1 pl-1.5 text-label text-accent'>
          {labelOf(v)}
          <Combobox.ChipRemove
            aria-label={`Remove ${labelOf(v)}`}
            className='flex size-4 items-center justify-center rounded text-accent/70 hover:bg-accent/20 hover:text-accent'>
            <X className='size-3' />
          </Combobox.ChipRemove>
        </Combobox.Chip>
      ))}
      <Combobox.Input
        id={field?.id}
        aria-label={ariaLabel}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        placeholder={values.length ? '' : placeholder}
        className={inputCls}
        onKeyDown={onInputKeyDown}
      />
    </>
  )
}

/**
 * Lowercase, trim, drop blanks, dedupe, sort - the conventional shape for a free tag vocabulary.
 *
 * Exported as a ready-made `normalize` for callers who want it, NOT applied by default: whether
 * `Backend` and `backend` are the same token is a decision about the caller's vocabulary, not about
 * the widget. A picker over user ids or slugs would be corrupted by it.
 */
export const lowercaseUniqueSorted = (values: string[]): string[] =>
  [...new Set(values.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort()

/** An option whose shown label differs from its stored value (an id behind a name). */
export interface TokenOption {
  value: string
  label: string
}

interface TokenPickerProps {
  value: string[]
  onChange: (values: string[]) => void
  /**
   * What to offer in the list: plain strings, or `{ value, label }` when the stored value is an id.
   * Whatever is already in `value` is merged in (shown as itself when no option names it), so it
   * always round-trips. Search, sort and chips use the label.
   */
  options: (string | TokenOption)[]
  placeholder?: string
  /** Shown when the list is empty and the query matches nothing to create. */
  emptyLabel?: string
  /** Let an unmatched query become a new token on Enter. Off means the caller owns the vocabulary. */
  allowCreate?: boolean
  /** Applied to every value leaving the picker. Identity by default - see `lowercaseUniqueSorted`. */
  normalize?: (values: string[]) => string[]
  /** The input's name outside a `Field`; inside one the field's label names it. */
  'aria-label'?: string
}

/**
 * Free-form multi-select: suggests what already exists, and (with `allowCreate`) makes a new token
 * on Enter. Use it for a free vocabulary of several values (tags, categories, dependencies), and,
 * with `TokenOption`s and `allowCreate={false}`, for several records picked by name (signals, kinds).
 * Not for one value from a closed set (`SelectField`), people (`UserPicker`) or one free value
 * (`Autocomplete`). `normalize` is identity by default; `lowercaseUniqueSorted` suits tags only.
 * Creation is offered only while NO suggestion matches, so Enter never has two meanings: with
 * matches on screen it selects the highlighted one, with none it creates what you typed.
 */
export function TokenPicker({
  value,
  onChange,
  options: supplied,
  placeholder = 'add…',
  emptyLabel = 'Nothing to choose from.',
  allowCreate = true,
  normalize = (v) => v,
  'aria-label': ariaLabel,
}: TokenPickerProps) {
  const { contains } = Combobox.useFilter()
  const [query, setQuery] = useState('')
  const labels = new Map<string, string>()
  for (const o of supplied) {
    if (typeof o === 'string') labels.set(o, o)
    else labels.set(o.value, o.label)
  }
  const labelOf = (v: string) => labels.get(v) ?? v
  const options = [...new Set([...labels.keys(), ...value])].sort((a, b) => labelOf(a).localeCompare(labelOf(b)))
  const noMatches = query.trim().length > 0 && !options.some((o) => contains(labelOf(o), query))
  const canCreate = allowCreate && noMatches

  const createFromQuery: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key !== 'Enter' || !canCreate) return
    e.preventDefault()
    onChange(normalize([...value, query.trim()]))
    setQuery('')
  }

  return (
    <Combobox.Root
      items={options}
      multiple
      value={value}
      inputValue={query}
      onInputValueChange={(next: string) => setQuery(next)}
      onValueChange={(next: string[]) => onChange(normalize(next))}
      itemToStringLabel={labelOf}
      filter={(item: string, q) => contains(labelOf(item), q)}>
      <Combobox.Chips className={groupCls}>
        <Combobox.Value>
          {(vals: string[]) => (
            <ChipList values={vals} placeholder={placeholder} labelOf={labelOf} onInputKeyDown={createFromQuery} aria-label={ariaLabel} />
          )}
        </Combobox.Value>
      </Combobox.Chips>
      <Combobox.Portal>
        <Combobox.Positioner className='isolate z-60 outline-none' sideOffset={6}>
          <Combobox.Popup className={popupCls}>
            <Combobox.Empty className='px-2 py-2 text-body-sm text-muted-foreground'>
              {canCreate ? `Press Enter to create "${query.trim()}".` : emptyLabel}
            </Combobox.Empty>
            <Combobox.List>
              {(option: string) => (
                <Combobox.Item key={option} value={option} className={itemCls}>
                  <Combobox.ItemIndicator className='col-start-1 text-accent'>
                    <Check className='size-3.5' />
                  </Combobox.ItemIndicator>
                  <span className='col-start-2 truncate'>{labelOf(option)}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
