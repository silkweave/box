// A complete select from a list of options: the base Select (base-ui, shadcn styling) sized and
// styled like the library's text inputs, so a form row of inputs and selects lines up. Reach for
// it instead of a native <select>: the native control draws its own caret, popup and padding per
// browser and never matches the rest of a form.
//
// Options are data, not children, so the trigger can show the selected option's label and a
// grouped list (an <optgroup>) needs no extra markup. An empty-string value is an ordinary option
// ('(none)', 'Default'); `placeholder` shows when the value matches no option.

import type { ReactNode } from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { cn } from '../lib/utils.ts'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './Select.tsx'

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
  const flat = options.flatMap((o) => (isGroup(o) ? o.options : [o]))
  const known = flat.some((o) => o.value === value)
  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange((next ?? '') as T)}
      items={flat.map((o) => ({ value: o.value, label: o.label }))}
      disabled={disabled}>
      <SelectTrigger id={id} title={title} aria-label={ariaLabel} className={cn('h-[34px] w-full min-w-0', className)}>
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
