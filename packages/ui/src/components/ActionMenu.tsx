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
  /** Changes nothing (open, copy, view the log): kept in a settings piece's menu under an active
   *  `SettingsReadOnly`, where every other item is left out. */
  reader?: boolean
}

/**
 * A record's secondary actions behind one "..." icon button. Danger items (delete) sit last, below a
 * separator; keyboard and focus handling come from the menu primitive.
 * Use it for the trailing slot of a list row or a detail header (`SettingsDetailHeader` and
 * `SettingsControlRow` take its items as `actions`).
 * Not for a single act (`IconButton` or `Button`), a page's create action (the title bar), or as the
 * only Delete on a detail page (`SettingsDeleteButton` in the footer; the row menu may repeat it).
 * The trigger is the `icon-sm` outline button (32px) for a header; `size='sm'` is the quiet 28px
 * ghost trigger rows use, matching `IconButton`. In a list, name each row's menu after its row
 * (`label={\`More for ${name}\`}`) so a screen reader hears which row it opens; a header's menu
 * keeps the default "More actions".
 * Clicks on the trigger and the items stop propagating (React events bubble through the portal),
 * so the menu is safe inside a row with `onOpen`. With no items it renders nothing, so a caller may
 * pass a list that is empty for some people (a member's row).
 */
export function ActionMenu({
  items,
  label = 'More actions',
  triggerIcon,
  size = 'md',
  className,
}: {
  items: ActionMenuItem[]
  label?: string
  /** Replaces the ellipsis for a moment, e.g. a tick after a copy item ran. */
  triggerIcon?: React.ReactNode
  /** `md`: outline 32px trigger for a detail header. `sm`: ghost 28px trigger for a list row. */
  size?: 'sm' | 'md'
  className?: string
}) {
  if (items.length === 0) return null
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
    // The wrapper only stops clicks from reaching an enclosing row; it adds no layout.
    <span className='contents' onClick={(e) => e.stopPropagation()}>
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger
        render={
          <Button
            variant={size === 'sm' ? 'ghost' : 'outline'}
            size='icon-sm'
            title={label}
            aria-label={label}
            className={cn(size === 'sm' && 'size-7 text-muted-foreground hover:bg-accent-tint hover:text-accent', className)}>
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
    </span>
  )
}
