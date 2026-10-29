import type * as React from 'react'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { Ellipsis } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { Button } from './Button.tsx'

export interface ActionMenuItem {
  label: string
  icon?: React.ReactNode
  onSelect: () => void
  /** Drawn in the danger tone, below a separator. */
  danger?: boolean
  disabled?: boolean
}

/**
 * A record's secondary actions behind one icon button ("..."), for the right-most slot of a detail
 * header. Danger items (delete) sit last, below a separator. Keyboard and focus handling come from
 * the menu primitive.
 */
export function ActionMenu({
  items,
  label = 'More actions',
  triggerIcon,
  className,
}: {
  items: ActionMenuItem[]
  label?: string
  /** Replaces the ellipsis for a moment, e.g. a tick after a copy item ran. */
  triggerIcon?: React.ReactNode
  className?: string
}) {
  const plain = items.filter((i) => !i.danger)
  const danger = items.filter((i) => i.danger)
  const row = (i: ActionMenuItem) => (
    <MenuPrimitive.Item
      key={i.label}
      disabled={i.disabled}
      onClick={i.onSelect}
      className={cn(
        'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-body-sm outline-none select-none data-disabled:opacity-50 data-highlighted:bg-accent-tint [&_svg]:size-4 [&_svg]:shrink-0',
        i.danger ? 'text-danger' : 'text-text [&_svg]:text-muted-foreground',
      )}>
      {i.icon}
      {i.label}
    </MenuPrimitive.Item>
  )
  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger
        render={
          <Button variant='outline' size='icon-sm' title={label} aria-label={label} className={className}>
            {triggerIcon ?? <Ellipsis />}
          </Button>
        }
      />
      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner align='end' sideOffset={4} className='isolate z-50'>
          <MenuPrimitive.Popup
            data-slot='action-menu'
            className='z-50 flex min-w-48 origin-(--transform-origin) flex-col rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95'>
            {plain.map(row)}
            {plain.length > 0 && danger.length > 0 && <MenuPrimitive.Separator className='my-1 h-px bg-border' />}
            {danger.map(row)}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  )
}
