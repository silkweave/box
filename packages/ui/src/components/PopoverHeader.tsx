import type { ReactNode } from 'react'
import { Tooltip } from '@base-ui/react/tooltip'
import { Info } from 'lucide-react'
import { cn } from '../lib/utils.ts'

/**
 * The title bar of a tool popover: its name on the left and, on the right, an info icon whose
 * tooltip explains it. The explanation lives in the tooltip, never as text in the panel.
 * Use it at the top of a popover that is a small tool of its own (a grid's Filter, Columns).
 * Not for a picker's list (`OptionList`) or a one-line popover. Pass `className` only for placement
 * (a panel with no padding gives it its own).
 */
export function PopoverHeader({ title, info, className }: { title: ReactNode; info?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border pr-1.5 pl-3', className)}>
      <span className='truncate text-body-sm font-medium text-text'>{title}</span>
      {info != null && (
        <Tooltip.Provider delay={150}>
          <Tooltip.Root>
            <Tooltip.Trigger
              data-skip-initial-focus=''
              aria-label={typeof title === 'string' ? `About ${title}` : 'About'}
              className='inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent-tint hover:text-accent focus-visible:ring-2 focus-visible:ring-accent'>
              <Info className='size-3.5' />
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Positioner side='bottom' align='end' sideOffset={6} className='isolate z-70'>
                <Tooltip.Popup className='max-w-64 rounded-md bg-popover px-2.5 py-1.5 text-label text-popover-foreground shadow-md ring-1 ring-foreground/10'>
                  {info}
                </Tooltip.Popup>
              </Tooltip.Positioner>
            </Tooltip.Portal>
          </Tooltip.Root>
        </Tooltip.Provider>
      )}
    </div>
  )
}
