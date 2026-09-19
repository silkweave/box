import { useState } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Check, X } from 'lucide-react'

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

export function ChipList({
  values,
  placeholder,
  labelOf,
  onInputKeyDown,
}: {
  values: string[]
  placeholder: string
  labelOf: (v: string) => string
  onInputKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
}) {
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
      <Combobox.Input placeholder={values.length ? '' : placeholder} className={inputCls} onKeyDown={onInputKeyDown} />
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

interface TokenPickerProps {
  value: string[]
  onChange: (values: string[]) => void
  /** What to offer in the list. Whatever is already in `value` is merged in, so it always round-trips. */
  options: string[]
  placeholder?: string
  /** Shown when the list is empty and the query matches nothing to create. */
  emptyLabel?: string
  /** Let an unmatched query become a new token on Enter. Off means the caller owns the vocabulary. */
  allowCreate?: boolean
  /** Applied to every value leaving the picker. Identity by default - see `lowercaseUniqueSorted`. */
  normalize?: (values: string[]) => string[]
}

/**
 * Free-form multi-select: suggests what already exists, and (with `allowCreate`) makes a new token
 * on Enter.
 *
 * base-ui has no `creatable` mode, so creation is explicit - and deliberately only offered while NO
 * suggestion matches (the Empty state). That way Enter never has two meanings at once: with matches
 * on screen it selects the highlighted one, with none it creates what you typed.
 */
export function TokenPicker({
  value,
  onChange,
  options: supplied,
  placeholder = 'add…',
  emptyLabel = 'Nothing to choose from.',
  allowCreate = true,
  normalize = (v) => v,
}: TokenPickerProps) {
  const { contains } = Combobox.useFilter()
  const [query, setQuery] = useState('')
  const options = [...new Set([...supplied, ...value])].sort()
  const noMatches = query.trim().length > 0 && !options.some((o) => contains(o, query))
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
      filter={(item: string, q) => contains(item, q)}>
      <Combobox.Chips className={groupCls}>
        <Combobox.Value>
          {(vals: string[]) => (
            <ChipList values={vals} placeholder={placeholder} labelOf={(v) => v} onInputKeyDown={createFromQuery} />
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
                  <span className='col-start-2 truncate'>{option}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
