import { cn } from '../lib/utils.ts'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { useRef, type FunctionComponent } from 'react'

/**
 * A floating panel anchored to a trigger (base-ui): `Popover`, `PopoverTrigger`, `PopoverContent`
 * (portal, 288px wide by default; `side`, `align` and offsets place it).
 * Use it for a small editor or detail one click away: a filter chip, a calendar, a picker list.
 * Not for a list of actions (`ActionMenu`), one value from a list (`SelectField`), or anything that
 * needs a page (`InlineDialog`, `SettingsPage`).
 */
export const Popover: FunctionComponent<PopoverPrimitive.Root.Props> = ({ ...props }) => {
  return <PopoverPrimitive.Root data-slot='popover' {...props} />
}

export const PopoverTrigger: FunctionComponent<PopoverPrimitive.Trigger.Props> = ({ ...props }) => {
  return <PopoverPrimitive.Trigger data-slot='popover-trigger' {...props} />
}

export const PopoverContent: FunctionComponent<
  PopoverPrimitive.Popup.Props &
    Pick<PopoverPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>
> = ({ className, align = 'center', alignOffset = 0, side = 'bottom', sideOffset = 4, initialFocus, ...props }) => {
  const popup = useRef<HTMLDivElement>(null)
  // The first control gets focus on open, skipping a `PopoverHeader`'s info icon: focusing it would
  // pop its tooltip over the panel the moment it opens.
  const firstControl = (): HTMLElement | true =>
    popup.current?.querySelector<HTMLElement>(
      'button:not([disabled]):not([data-skip-initial-focus]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex="-1"]):not([data-skip-initial-focus])',
    ) ?? true
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className='isolate z-50'>
        <PopoverPrimitive.Popup
          ref={popup}
          initialFocus={initialFocus ?? firstControl}
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
