import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { SearchInput } from './SearchInput.tsx'

/** Above this many options a picker shows a search box: a short list is read, a long one is typed. */
export const OPTION_SEARCH_THRESHOLD = 5

export interface OptionListItem {
  value: string
  /** What the row shows: text, or an avatar or chip with text. */
  label: ReactNode
  /** What the search matches; defaults to `label` when that is a string. */
  text?: string
  /** A heading the item sits under; consecutive items with the same group share one heading. */
  group?: string
  disabled?: boolean
}

/**
 * The list inside a picker's popover: one value from many. Its height is capped and it scrolls, so a
 * long list never runs off the screen, and past `OPTION_SEARCH_THRESHOLD` options it adds a search
 * box (focused on open) that narrows the list as you type. Arrow keys move, Enter picks.
 * Use it inside `PopoverContent` (`UserPicker`, the searchable `SelectField` and `SelectCell`).
 * Not on its own: a picker owns the trigger and the popover. Not for several values (`TokenPicker`).
 */
export function OptionList({
  items,
  value,
  onPick,
  search,
  searchLabel = 'Search',
  placeholder = 'Search…',
  emptyLabel = 'Nothing matches.',
}: {
  items: OptionListItem[]
  value: string | null
  onPick: (value: string) => void
  /** Force the search box on or off; by default it shows past `OPTION_SEARCH_THRESHOLD` items. */
  search?: boolean
  searchLabel?: string
  placeholder?: string
  emptyLabel?: ReactNode
}) {
  const searchable = search ?? items.length > OPTION_SEARCH_THRESHOLD
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => (i.text ?? (typeof i.label === 'string' ? i.label : i.value)).toLowerCase().includes(q))
  }, [items, query])
  const [active, setActive] = useState(() => Math.max(0, shown.findIndex((i) => i.value === value)))
  useEffect(() => setActive(query ? 0 : Math.max(0, items.findIndex((i) => i.value === value))), [query, items, value])
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const move = (by: number) => {
    if (shown.length === 0) return
    let next = active
    for (let step = 0; step < shown.length; step++) {
      next = (next + by + shown.length) % shown.length
      if (!shown[next]!.disabled) break
    }
    setActive(next)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter') {
      const item = shown[active]
      if (item && !item.disabled) { e.preventDefault(); onPick(item.value) }
    }
  }

  return (
    <div className='flex min-h-0 flex-col gap-1' onKeyDown={onKeyDown}>
      {searchable && <SearchInput value={query} onChange={setQuery} label={searchLabel} placeholder={placeholder} autoFocus size='sm' className='shrink-0' />}
      <div ref={list} role='listbox' aria-label={searchLabel} tabIndex={searchable ? -1 : 0} autoFocus={!searchable} className='max-h-[min(20rem,calc(var(--available-height,24rem)-3.5rem))] overflow-y-auto outline-none'>
        {shown.length === 0 && <p className='px-2 py-1.5 text-label text-muted-foreground'>{emptyLabel}</p>}
        {shown.map((item, i) => (
          <div key={item.value}>
            {item.group && item.group !== shown[i - 1]?.group && <p className='px-2 pt-1.5 pb-1 text-label font-medium text-muted-foreground'>{item.group}</p>}
            <button
              type='button'
              role='option'
              data-index={i}
              aria-selected={item.value === value}
              disabled={item.disabled}
              tabIndex={-1}
              onMouseMove={() => setActive(i)}
              onClick={() => onPick(item.value)}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-body-sm text-text outline-none select-none disabled:opacity-50',
                i === active && 'bg-accent-tint',
              )}>
              <span className='flex min-w-0 flex-1 items-center gap-2'>{item.label}</span>
              {item.value === value && <Check className='size-3.5 shrink-0 text-accent' />}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
