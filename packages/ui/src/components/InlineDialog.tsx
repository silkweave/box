import { createContext, useContext, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './Dialog.tsx'
import { cn } from '../lib/utils.ts'

const InlineTarget = createContext<{ target: HTMLDivElement | null; enter: () => () => void } | null>(null)
const InlineClose = createContext<(() => void) | null>(null)
export function useInlineDialogTarget() { return useContext(InlineTarget) }

/** Editors occupy the current pane. The underlying list keeps its state and becomes inert. */
export function InlineDialogScope({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null)
  const [editors, setEditors] = useState(0)
  const enter = useRef(() => {
    setEditors((n) => n + 1)
    return () => setEditors((n) => n - 1)
  }).current
  return <InlineTarget.Provider value={{ target, enter }}>
    <div className='relative h-full min-h-0'>
      <div className={cn('h-full', scroll ? 'overflow-auto' : 'overflow-visible', editors > 0 && 'invisible')} inert={editors > 0 || undefined}>{children}</div>
      <div ref={setTarget} className={cn('absolute inset-0 bg-surface', scroll ? 'overflow-auto' : 'overflow-visible', editors === 0 && 'hidden')} />
    </div>
  </InlineTarget.Provider>
}

export function InlineDialog({ open, onOpenChange, children }: { open?: boolean; onOpenChange?: (open: boolean) => void; children: ReactNode }) {
  const scope = useInlineDialogTarget()
  if (!scope) return <Dialog open={open} onOpenChange={onOpenChange}>{children}</Dialog>
  return open ? <InlineClose.Provider value={() => onOpenChange?.(false)}>{children}</InlineClose.Provider> : null
}

export function InlineDialogContent({ children, className, showClose = true }: HTMLAttributes<HTMLDivElement> & { showClose?: boolean }) {
  const scope = useInlineDialogTarget()
  const close = useContext(InlineClose)
  const panel = useRef<HTMLDivElement>(null)
  const enter = scope?.enter
  useLayoutEffect(() => enter?.(), [enter])
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [scope?.target])
  if (!scope) return <DialogContent className={className} showClose={showClose}>{children}</DialogContent>
  const content = <div ref={panel} tabIndex={-1} className={cn('mx-auto flex w-full flex-col gap-4 p-5 outline-none sm:p-8', className)}>
    {showClose && <button type='button' onClick={close ?? undefined} className='flex w-fit items-center gap-2 text-body-sm text-muted-foreground hover:text-text'><ArrowLeft className='size-4' /> Back</button>}
    {children}
  </div>
  return scope?.target ? createPortal(content, scope.target) : content
}

export function InlineDialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const scope = useInlineDialogTarget()
  if (!scope) return <DialogTitle className={className} {...props} />
  return <h2 className={cn('font-serif text-display-sm leading-tight text-text', className)} {...props} />
}
export function InlineDialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const scope = useInlineDialogTarget()
  if (!scope) return <DialogDescription className={className} {...props} />
  return <p className={cn('text-body-sm text-muted-foreground', className)} {...props} />
}
