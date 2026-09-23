import { cn } from '../lib/utils.ts'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { type FunctionComponent } from 'react'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export const DialogContent: FunctionComponent<DialogPrimitive.Popup.Props & { showClose?: boolean }> = ({
  className,
  children,
  showClose = true,
  ...props
}) => {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot='dialog-backdrop'
        className='fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px] duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0'
      />
      <DialogPrimitive.Popup
        data-slot='dialog-content'
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4',
          'rounded-xl border border-border bg-surface p-5 shadow-(--shadow-md) outline-none',
          'duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
          className,
        )}
        {...props}>
        {children}
        {showClose && (
          <DialogPrimitive.Close
            className='absolute top-3.5 right-3.5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-bg hover:text-text'
            aria-label='Close'>
            <X className='size-4' />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

export const DialogTitle: FunctionComponent<DialogPrimitive.Title.Props> = ({ className, ...props }) => {
  return (
    <DialogPrimitive.Title
      data-slot='dialog-title'
      // pr-10 keeps a long title from running under the absolutely-positioned close X (top-right).
      className={cn('pr-10 font-serif text-display-sm leading-tight text-text', className)}
      {...props}
    />
  )
}

export const DialogDescription: FunctionComponent<DialogPrimitive.Description.Props> = ({ className, ...props }) => {
  return (
    <DialogPrimitive.Description
      data-slot='dialog-description'
      className={cn('text-body-sm text-muted-foreground', className)}
      {...props}
    />
  )
}
