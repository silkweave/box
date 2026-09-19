import { cn } from '../lib/utils.ts'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { type FunctionComponent } from 'react'

export const Popover: FunctionComponent<PopoverPrimitive.Root.Props> = ({ ...props }) => {
  return <PopoverPrimitive.Root data-slot='popover' {...props} />
}

export const PopoverTrigger: FunctionComponent<PopoverPrimitive.Trigger.Props> = ({ ...props }) => {
  return <PopoverPrimitive.Trigger data-slot='popover-trigger' {...props} />
}

export const PopoverContent: FunctionComponent<
  PopoverPrimitive.Popup.Props &
    Pick<PopoverPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>
> = ({ className, align = 'center', alignOffset = 0, side = 'bottom', sideOffset = 4, ...props }) => {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className='isolate z-50'>
        <PopoverPrimitive.Popup
          data-slot='popover-content'
          className={cn(
            'z-50 flex w-72 origin-(--transform-origin) flex-col gap-4 rounded-md bg-popover p-4 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}
