// A prettier, promise-based replacement for window.confirm: `await confirm({...})` from anywhere
// (no hook threading), rendered by the single <ConfirmHost/> mounted in App. Requests queue, so
// overlapping confirms resolve one at a time; Esc / backdrop / X all resolve `false`.

import * as React from 'react'
import { Button } from './Button.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './Dialog.tsx'

export interface ConfirmOptions {
  /** Short question, e.g. "Delete this rule?". Defaults to "Are you sure?". */
  title?: string
  /** Supporting detail under the title; `\n` line breaks are preserved. */
  message?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive styling on the confirm button (deletes, revokes, removals). */
  danger?: boolean
}

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (ok: boolean) => void
}

const queue: PendingConfirm[] = []
let notify: (() => void) | null = null

/**
 * Ask the user to confirm. Accepts a bare string (as the message) or full options. Resolves
 * `true` on confirm, `false` on cancel/dismiss - never rejects.
 */
export function confirm(options: string | ConfirmOptions): Promise<boolean> {
  const opts = typeof options === 'string' ? { message: options } : options
  return new Promise((resolve) => {
    queue.push({ options: opts, resolve })
    notify?.()
  })
}

/** Mount ONCE at the app root. Renders the head of the confirm queue as a small dialog. */
export function ConfirmHost() {
  const [, force] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    notify = force
    return () => {
      notify = null
    }
  }, [])

  const current = queue[0] ?? null
  if (!current) return null
  const o = current.options
  const answer = (ok: boolean) => {
    queue.shift()?.resolve(ok)
    force()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && answer(false)}>
      <DialogContent className='max-w-sm' showClose={false}>
        <DialogTitle className='pr-0 text-body font-medium font-sans'>{o.title ?? 'Are you sure?'}</DialogTitle>
        {o.message != null && (
          <DialogDescription className='whitespace-pre-wrap'>{o.message}</DialogDescription>
        )}
        <div className='flex items-center justify-end gap-2'>
          <Button variant='ghost' onClick={() => answer(false)}>
            {o.cancelLabel ?? 'Cancel'}
          </Button>
          <Button variant={o.danger ? 'destructive' : 'default'} autoFocus onClick={() => answer(true)}>
            {o.confirmLabel ?? 'Confirm'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
