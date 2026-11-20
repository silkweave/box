// A complete select from a list of options: the base Select (base-ui, shadcn styling) sized and
// styled like the library's text inputs, so a form row of inputs and selects lines up. Reach for
// it instead of a native <select>: the native control draws its own caret, popup and padding per
// browser and never matches the rest of a form.
//
// Options are data, not children, so the trigger can show the selected option's label and a
// grouped list (an <optgroup>) needs no extra markup. An empty-string value is an ordinary option
// ('(none)', 'Default'); `placeholder` shows when the value matches no option.
//
// Inside a `Field` the trigger takes its id, `aria-describedby` and invalid state from the field, so
// the field's label opens and names it.

import { useState, type ReactNode } from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { ChevronsUpDown } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { useFieldControl } from './Field.tsx'
import { OPTION_SEARCH_THRESHOLD, OptionList } from './OptionList.tsx'
import { Popover, PopoverContent, PopoverTrigger } from './Popover.tsx'
import { SELECT_TRIGGER, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './Select.tsx'

export interface SelectFieldOption<T extends string = string> {
  value: T
  label: ReactNode
  disabled?: boolean
}

export interface SelectFieldGroup<T extends string = string> {
  label: ReactNode
  options: SelectFieldOption<T>[]
}

const isGroup = <T extends string>(o: SelectFieldOption<T> | SelectFieldGroup<T>): o is SelectFieldGroup<T> => 'options' in o

/**
 * One value from a closed set of options, sized and styled like `Input` so a form row lines up.
 * Use it by default for every choice from a list: a level, a provider, a timezone. Options are data
 * (`{ value, label }`, or groups), so the trigger shows the picked label.
 * Not for custom trigger or item content (the `Select` parts), free text with suggestions
 * (`Autocomplete`), several values (`TokenPicker`), people (`UserPicker`) or 2 to 5 options shown at
 * once (`SegmentedControl`). Never a native `<select>`.
 * `''` is an ordinary option value; `placeholder` shows when the value matches no option.
 * Past `OPTION_SEARCH_THRESHOLD` options it opens a searchable list (`OptionList`) instead.
 * Rule: give it a label, a `Field` around it or `aria-label`.
 */
export function SelectField<T extends string = string>({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  id,
  title,
  'aria-label': ariaLabel,
}: {
  value: T
  onValueChange: (value: T) => void
  options: (SelectFieldOption<T> | SelectFieldGroup<T>)[]
  placeholder?: ReactNode
  disabled?: boolean
  className?: string
  id?: string
  title?: string
  'aria-label'?: string
}) {
  const field = useFieldControl()
  const invalid = Boolean(field?.invalid)
  const flat = options.flatMap((o) => (isGroup(o) ? o.options : [o]))
  const known = flat.some((o) => o.value === value)
  const triggerClass = cn('h-[34px] w-full min-w-0', invalid && 'border-danger hover:border-danger', className)
  if (flat.length > OPTION_SEARCH_THRESHOLD)
    return (
      <SearchableSelect
        value={value}
        onValueChange={onValueChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        className={triggerClass}
        id={id ?? field?.id}
        title={title}
        ariaLabel={ariaLabel}
        describedBy={field?.describedBy}
        invalid={invalid}
      />
    )
  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange((next ?? '') as T)}
      items={flat.map((o) => ({ value: o.value, label: o.label }))}
      disabled={disabled}>
      <SelectTrigger
        id={id ?? field?.id}
        title={title}
        aria-label={ariaLabel}
        aria-describedby={field?.describedBy}
        aria-invalid={invalid || undefined}
        className={triggerClass}>
        <span className={cn('min-w-0 flex-1 truncate text-left', !known && 'text-muted-foreground')}>
          {known ? <SelectValue /> : (placeholder ?? 'Select…')}
        </span>
      </SelectTrigger>
      <SelectContent>
        {options.map((o, i) =>
          isGroup(o) ? (
            <SelectPrimitive.Group key={i} className='py-0.5'>
              <SelectPrimitive.GroupLabel className='px-2 pt-1.5 pb-1 text-label font-medium text-muted-foreground'>{o.label}</SelectPrimitive.GroupLabel>
              {o.options.map((item) => (
                <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPrimitive.Group>
          ) : (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </SelectItem>
          ),
        )}
      </SelectContent>
    </Select>
  )
}

/** `SelectField` past the threshold: the same trigger, a popover with a searchable `OptionList`. */
function SearchableSelect<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  id,
  title,
  ariaLabel,
  describedBy,
  invalid,
}: {
  value: T
  onValueChange: (value: T) => void
  options: (SelectFieldOption<T> | SelectFieldGroup<T>)[]
  placeholder?: ReactNode
  disabled?: boolean
  className?: string
  id?: string
  title?: string
  ariaLabel?: string
  describedBy?: string
  invalid: boolean
}) {
  const [open, setOpen] = useState(false)
  const textOf = (label: ReactNode, v: string): string => (typeof label === 'string' ? label : v)
  const items = options.flatMap((o) =>
    isGroup(o)
      ? o.options.map((i) => ({ value: i.value, label: i.label, text: textOf(i.label, i.value), disabled: i.disabled, group: textOf(o.label, '') }))
      : [{ value: o.value, label: o.label, text: textOf(o.label, o.value), disabled: o.disabled }],
  )
  const current = items.find((i) => i.value === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        id={id}
        title={title}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={cn(SELECT_TRIGGER, className)}>
        <span className={cn('flex min-w-0 flex-1 items-center truncate text-left', !current && 'text-muted-foreground')}>{current ? current.label : (placeholder ?? 'Select…')}</span>
        <ChevronsUpDown className='size-3.5 shrink-0 text-muted-foreground' />
      </PopoverTrigger>
      <PopoverContent align='start' sideOffset={6} className='w-(--anchor-width) min-w-56 gap-1 p-1'>
        <OptionList
          items={items}
          value={value}
          onPick={(v) => {
            setOpen(false)
            if (v !== value) onValueChange(v as T)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
