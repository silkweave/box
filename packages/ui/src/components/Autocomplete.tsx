// A text input with a suggestion list: base-ui's Autocomplete, styled like the library's inputs
// and select popups. The value is free text (an event kind, a route, a channel) and the
// suggestions only help type it; a value outside them is fine. Use SelectField instead when the
// value must be one of a closed set.

import { useState, type ReactNode } from 'react'
import { Autocomplete as AutocompletePrimitive } from '@base-ui/react/autocomplete'
import { ChevronsUpDown } from 'lucide-react'
import { cn } from '../lib/utils.ts'

export interface AutocompleteSuggestion {
  value: string
  /** A quiet note beside the value, e.g. how often it occurred. */
  hint?: ReactNode
}

export function Autocomplete({
  value,
  onValueChange,
  suggestions,
  placeholder,
  mono = false,
  disabled,
  className,
  id,
  'aria-label': ariaLabel,
}: {
  value: string
  onValueChange: (value: string) => void
  suggestions: AutocompleteSuggestion[]
  placeholder?: string
  /** Monospace input and items, for identifiers. */
  mono?: boolean
  disabled?: boolean
  className?: string
  id?: string
  'aria-label'?: string
}) {
  // Opening on a filled field lists every suggestion; typing narrows it. Filtering by the value
  // already in the field would show only that value (or nothing) when you click to change it.
  const [typed, setTyped] = useState(false)
  return (
    <AutocompletePrimitive.Root
      items={suggestions}
      value={value}
      onValueChange={(next, details) => {
        if (details.reason === 'input-change') setTyped(true)
        onValueChange(next)
      }}
      onOpenChange={(open) => {
        if (open) setTyped(false)
      }}
      filter={typed ? undefined : () => true}
      itemToStringValue={(item: AutocompleteSuggestion) => item.value}
      openOnInputClick
      disabled={disabled}>
      <AutocompletePrimitive.InputGroup className={cn('relative flex w-full min-w-0 items-center', className)}>
        <AutocompletePrimitive.Input
          id={id}
          aria-label={ariaLabel}
          placeholder={placeholder}
          className={cn(
            'h-[34px] w-full min-w-0 rounded-md border border-border bg-bg py-1.5 pr-8 pl-2.5 text-body-sm text-text transition-colors outline-none',
            'hover:border-accent/40 focus:border-accent disabled:pointer-events-none disabled:opacity-50',
            mono && 'font-mono',
          )}
        />
        {suggestions.length > 0 && (
          <AutocompletePrimitive.Trigger
            aria-label='Show suggestions'
            className='absolute right-1.5 inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-text'>
            <ChevronsUpDown className='size-3.5' />
          </AutocompletePrimitive.Trigger>
        )}
      </AutocompletePrimitive.InputGroup>
      <AutocompletePrimitive.Portal>
        <AutocompletePrimitive.Positioner side='bottom' align='start' sideOffset={6} className='isolate z-60 outline-none'>
          <AutocompletePrimitive.Popup
            className={cn(
              'max-h-[min(20rem,var(--available-height))] w-[var(--anchor-width)] origin-(--transform-origin) overflow-y-auto',
              'rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none',
              'duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
              'data-[empty]:hidden',
            )}>
            <AutocompletePrimitive.List>
              {(item: AutocompleteSuggestion) => (
                <AutocompletePrimitive.Item
                  key={item.value}
                  value={item}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-body-sm text-text outline-none select-none',
                    'data-highlighted:bg-accent-tint',
                  )}>
                  <span className={cn('min-w-0 truncate', mono && 'font-mono text-label')}>{item.value}</span>
                  {item.hint && <span className='shrink-0 text-label text-muted-foreground'>{item.hint}</span>}
                </AutocompletePrimitive.Item>
              )}
            </AutocompletePrimitive.List>
          </AutocompletePrimitive.Popup>
        </AutocompletePrimitive.Positioner>
      </AutocompletePrimitive.Portal>
    </AutocompletePrimitive.Root>
  )
}
