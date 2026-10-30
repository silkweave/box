// The filter view: what the funnel opens. The fields down the left - each with a dot while it is
// narrowing and, where the host offers pinning, a star that puts it in the top bar - and the selected
// field's editor on the right, the editor being whatever its type calls for. Under both, the two ways
// out: clear this field, or clear them all.
//
// It opens on the first active field (the one you most likely came to change), else the first. On a
// narrow screen the two halves stack, the field list becoming a wrapping row of names.
//
// Controlled, like the bar around it: `value` in, the whole next filters record out. It never
// decides what a field means; the editors only know the field's TYPE.

import { useState } from 'react'
import { Star } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { FilterEditor } from './editors.tsx'
import { isActive } from './match.ts'
import type { FilterField, FilterValue, Filters } from './types.ts'

/** A field worth offering: a list field with nothing to list is noise (Me and Nobody still count). */
export const offered = (f: FilterField): boolean =>
  f.type === 'options' ? f.options.length > 0 : f.type === 'person' ? f.options.length > 0 || f.meLabel !== false || f.noneLabel !== false : true

export function FilterPanel({
  fields,
  value,
  onChange,
  pinned,
  onPinnedChange,
  today,
  className,
}: {
  fields: readonly FilterField[]
  value: Filters
  onChange: (next: Filters) => void
  /** Field keys in the bar, in bar order. */
  pinned?: readonly string[]
  /** Offers the star; omit and pinning is not on offer. */
  onPinnedChange?: (next: string[]) => void
  /** The date editors' "today" (the default clock when absent). */
  today?: string
  className?: string
}) {
  const shown = fields.filter(offered)
  const activeOf = (f: FilterField): boolean => isActive(f.type, value[f.key])
  const [selectedKey, setSelectedKey] = useState(() => (shown.find(activeOf) ?? shown[0])?.key)
  const field = shown.find((f) => f.key === selectedKey) ?? shown[0]
  if (!field) return null

  const set = (key: string, next: FilterValue | null): void => {
    const rest = Object.fromEntries(Object.entries(value).filter(([k]) => k !== key))
    onChange(next === null ? rest : { ...rest, [key]: next })
  }
  const anyActive = shown.some(activeOf)
  const pins = pinned ?? []
  const togglePin = (key: string): void => onPinnedChange?.(pins.includes(key) ? pins.filter((k) => k !== key) : [...pins, key])

  return (
    <div className={cn('flex flex-col', className)}>
      <div className='flex min-h-0 flex-col sm:flex-row'>
        {/* The field list. A row is the name (select it) and, beside it, the star (pin it) - two
            buttons, so the star never selects and the name never pins. */}
        <div
          role='tablist'
          aria-label='Filter fields'
          aria-orientation='vertical'
          className='flex shrink-0 flex-wrap gap-0.5 border-b border-border p-1.5 sm:w-44 sm:flex-col sm:flex-nowrap sm:overflow-y-auto sm:border-r sm:border-b-0'>
          {shown.map((f) => {
            const on = f.key === field.key
            const isPinned = pins.includes(f.key)
            return (
              <div key={f.key} className={cn('group flex items-center rounded', on ? 'bg-accent-tint' : 'hover:bg-surface-hover')}>
                <button
                  type='button'
                  role='tab'
                  aria-selected={on}
                  onClick={() => setSelectedKey(f.key)}
                  className={cn(
                    'flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-body-sm transition-colors',
                    on ? 'text-accent' : 'text-text',
                  )}>
                  <span className='truncate'>{f.title}</span>
                  {activeOf(f) && <span aria-label='active' className='size-1.5 shrink-0 rounded-full bg-accent' />}
                </button>
                {onPinnedChange && (
                  <button
                    type='button'
                    onClick={() => togglePin(f.key)}
                    aria-pressed={isPinned}
                    aria-label={isPinned ? `Unpin ${f.title} from the bar` : `Pin ${f.title} to the bar`}
                    title={isPinned ? 'Pinned to the bar - click to unpin' : 'Pin to the bar'}
                    className={cn(
                      'mr-0.5 shrink-0 rounded p-1 transition-colors',
                      isPinned ? 'text-accent' : 'text-fg-4 opacity-0 group-hover:opacity-100 hover:text-muted-foreground focus-visible:opacity-100',
                    )}>
                    <Star className={cn('size-3.5', isPinned && 'fill-current')} />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* The selected field's editor. Keyed by field so a half-typed draft never leaks across. */}
        <div role='tabpanel' aria-label={field.title} className='flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto p-1.5 sm:max-h-[60vh] sm:min-w-60'>
          <span className='px-1.5 pt-0.5 text-label font-medium text-muted-foreground'>{field.title}</span>
          <FilterEditor key={field.key} field={field} value={value[field.key]} onChange={(next) => set(field.key, next)} today={today} />
          {field.note && <span className='px-1.5 pt-1 text-label text-muted-foreground'>{field.note}</span>}
        </div>
      </div>

      <div className='flex items-center justify-between gap-2 border-t border-border px-2 py-1.5'>
        <button
          type='button'
          onClick={() => set(field.key, null)}
          disabled={!activeOf(field)}
          className='rounded px-1.5 py-0.5 text-label text-muted-foreground transition-colors hover:bg-accent-tint hover:text-text disabled:pointer-events-none disabled:opacity-40'>
          Clear {field.title}
        </button>
        <button
          type='button'
          onClick={() => onChange({})}
          disabled={!anyActive}
          className='rounded px-1.5 py-0.5 text-label text-muted-foreground transition-colors hover:bg-accent-tint hover:text-danger disabled:pointer-events-none disabled:opacity-40'>
          Clear all
        </button>
      </div>
    </div>
  )
}
