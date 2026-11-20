// The controls a view bar is made of, used by `BoardViewBar` (boards and every `DataGrid`): sort (field and direction as one control) and filters (the
// funnel with its count, and the clear beside it). Search is the caller's field.

import { ArrowDownWideNarrow, ArrowUpNarrowWide, ListFilter, X } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { Popover, PopoverContent, PopoverTrigger } from '../components/Popover.tsx'
import { PopoverHeader } from '../components/PopoverHeader.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/Select.tsx'
import { FilterPanel } from './FilterPanel.tsx'
import type { FilterField, FilterOption, Filters, SortDir, SortOption } from './types.ts'

/**
 * Sort as one control: the field, and the direction beside it ("in what order?" is one question).
 * Switching the field also switches the direction, to the one that field reads naturally
 * (`defaultDir`). Use it in a view bar; `BoardViewBar` draws it for you.
 */
export function SortControl({ options, sort, dir = 'asc', onChange }: { options: SortOption[]; sort?: string; dir?: SortDir; onChange: (sort: string, dir: SortDir) => void }) {
  const current = options.find((o) => o.value === sort)
  return (
    <div className='inline-flex items-center'>
      <Select
        value={sort ?? ''}
        onValueChange={(next) => next != null && onChange(next, options.find((o) => o.value === next)?.defaultDir ?? 'asc')}
        items={options}>
        <SelectTrigger aria-label='Sort' className={cn('h-7 min-w-28', !current?.undirected && 'rounded-r-none border-r-0')}>
          <SelectValue>{(val) => <span>Sort: {options.find((o) => o.value === val)?.label}</span>}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!current?.undirected && (
        <button
          type='button'
          onClick={() => onChange(sort ?? '', dir === 'asc' ? 'desc' : 'asc')}
          aria-label={`Sort direction: ${dir === 'asc' ? 'ascending' : 'descending'}`}
          title={`${dir === 'asc' ? 'Ascending' : 'Descending'} - click to reverse`}
          className='inline-flex h-7 items-center rounded-r-md border border-border bg-bg px-1.5 text-muted-foreground transition-colors hover:border-accent/40 hover:text-text'>
          {dir === 'asc' ? <ArrowUpNarrowWide className='size-3.5' /> : <ArrowDownWideNarrow className='size-3.5' />}
        </button>
      )}
    </div>
  )
}

/**
 * Filters as one control: the funnel opens the `FilterPanel`, its count says how many fields (and
 * the search) narrow the view, and the × beside it, shown only while something narrows, clears them.
 * Use it in a view bar; `BoardViewBar` draws it for you.
 */
export function FilterControl({
  fields,
  value,
  onChange,
  active,
  onClear,
  pinned,
  onPinnedChange,
  today,
}: {
  fields: readonly FilterField[]
  value: Filters
  onChange: (next: Filters) => void
  /** How many fields narrow the view, search included. */
  active: number
  /** Empties the filters and the search. */
  onClear: () => void
  pinned?: readonly string[]
  onPinnedChange?: (next: string[]) => void
  today?: string
}) {
  return (
    <div className='inline-flex items-center'>
      <Popover>
        <PopoverTrigger
          aria-label={active > 0 ? `Filters (${active} active)` : 'Filters'}
          title={active > 0 ? `${active} active filter${active > 1 ? 's' : ''}` : 'Filter'}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-md border px-1.5 text-body-sm transition-colors',
            active > 0
              ? 'rounded-r-none border-r-0 border-accent/40 bg-accent-tint text-accent'
              : 'border-border bg-bg text-muted-foreground hover:border-accent/40 hover:text-text',
          )}>
          <ListFilter className='size-3.5' />
          {active > 0 && <span className='tabular-nums'>{active}</span>}
        </PopoverTrigger>
        <PopoverContent align='start' side='bottom' className='max-h-[75vh] w-[min(30rem,calc(100vw-1rem))] gap-0 overflow-y-auto p-0'>
          <PopoverHeader
            title='Filter'
            info={onPinnedChange ? 'Pick a field on the left and set what to show on the right. Star a field to pin it to the bar.' : 'Pick a field on the left and set what to show on the right.'}
          />
          <FilterPanel fields={fields} value={value} onChange={onChange} pinned={pinned} onPinnedChange={onPinnedChange} today={today} />
        </PopoverContent>
      </Popover>
      {active > 0 && (
        <button
          type='button'
          onClick={onClear}
          aria-label={`Clear ${active} filter${active > 1 ? 's' : ''}`}
          title='Clear the filters and the search'
          className='inline-flex h-7 items-center rounded-r-md border border-accent/40 bg-accent-tint px-1.5 text-accent transition-colors hover:bg-accent/20'>
          <X className='size-3.5' />
        </button>
      )}
    </div>
  )
}

/**
 * Group by: a select reading "Group: Channel". `none` (when offered) reads muted.
 * Use it in a view bar; `BoardViewBar` draws it for you.
 */
export function GroupControl({ options, value, onChange }: { options: FilterOption[]; value: string; onChange: (value: string) => void }) {
  return (
    <Select value={value} onValueChange={(next) => next != null && onChange(next)} items={options}>
      <SelectTrigger aria-label='Group by' className='h-7 min-w-32'>
        <SelectValue>
          {(val) => <span className={val === 'none' ? 'text-muted-foreground' : undefined}>Group: {options.find((o) => o.value === val)?.label}</span>}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
