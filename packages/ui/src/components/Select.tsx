import { cn } from '../lib/utils.ts'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { Check, ChevronsUpDown } from 'lucide-react'
import { type FunctionComponent } from 'react'

export const Select = SelectPrimitive.Root
/** The trigger's value, centred on the trigger's line: a block wrapper would leave room below the
 *  baseline and sit an icon-and-label value a pixel high. */
export const SelectValue: FunctionComponent<SelectPrimitive.Value.Props> = ({ className, ...props }) => (
  <SelectPrimitive.Value className={(state) => cn('flex min-w-0 items-center', typeof className === 'function' ? className(state) : className)} {...props} />
)

export const SelectTrigger: FunctionComponent<SelectPrimitive.Trigger.Props> = ({ className, children, ...props }) => {
  return (
    <SelectPrimitive.Trigger
      data-slot='select-trigger'
      className={cn(
        'inline-flex h-8 items-center justify-between gap-1.5 rounded-md border border-border bg-bg px-2.5 text-body-sm text-text',
        'transition-colors outline-none hover:border-accent/40 focus-visible:border-ring data-popup-open:border-accent/60',
        'disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}>
      {children}
      <SelectPrimitive.Icon className='text-muted-foreground'>
        <ChevronsUpDown className='size-3.5' />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export const SelectContent: FunctionComponent<
  SelectPrimitive.Popup.Props &
    Pick<SelectPrimitive.Positioner.Props, 'align' | 'alignItemWithTrigger' | 'side' | 'sideOffset'>
> = ({ className, align = 'start', alignItemWithTrigger = false, side = 'bottom', sideOffset = 6, ...props }) => {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align={align}
        alignItemWithTrigger={alignItemWithTrigger}
        side={side}
        sideOffset={sideOffset}
        className='isolate z-60 outline-none'>
        <SelectPrimitive.Popup
          data-slot='select-content'
          className={cn(
            'max-h-[min(24rem,var(--available-height))] min-w-[var(--anchor-width)] origin-(--transform-origin) overflow-y-auto',
            'rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none',
            'duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        />
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

export const SelectItem: FunctionComponent<SelectPrimitive.Item.Props> = ({ className, children, ...props }) => {
  return (
    <SelectPrimitive.Item
      data-slot='select-item'
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-2 pl-2 text-body-sm text-text outline-none select-none',
        'data-highlighted:bg-accent-tint data-highlighted:text-text',
        className,
      )}
      {...props}>
      <span className='flex min-w-0 flex-1 items-center gap-2'>{children}</span>
      <SelectPrimitive.ItemIndicator className='text-accent'>
        <Check className='size-3.5' />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

export const SelectItemText = SelectPrimitive.ItemText
