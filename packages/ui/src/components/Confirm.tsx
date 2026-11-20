// A prettier, promise-based replacement for window.confirm: `await confirm({...})` from anywhere
// (no hook threading), rendered by the single <ConfirmHost/> mounted in App. Requests queue, so
// overlapping confirms resolve one at a time; Esc / backdrop / X all resolve `false`.

import * as React from 'react'
import { Button } from './Button.tsx'
import { InlineDialog, InlineDialogContent, InlineDialogTitle, InlineDialogDescription, useInlineDialogTarget } from './InlineDialog.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './Dialog.tsx'
import { Field } from './Field.tsx'
import { Input } from './Input.tsx'
import { SettingsActions } from '../settings/slots.tsx'

export interface ConfirmOptions {
  /** Short question, e.g. "Delete this rule?". Defaults to "Are you sure?". */
  title?: string
  /** Supporting detail under the title; `\n` line breaks are preserved. */
  message?: React.ReactNode
  confirmLabel?: string
  /** `false` leaves only the confirm button (see `notice`). */
  cancelLabel?: string | false
  /** Destructive styling on the confirm button (deletes, revokes, removals). */
  danger?: boolean
  /** A word the person types back before the confirm button works (a room's address before it
   *  and its history are destroyed). For deletes that cannot be undone and take others' work. */
  typed?: string
}

interface PendingConfirm {
  options: ConfirmOptions
  resolve: (ok: boolean) => void
  /** Asked while a modal dialog was open: confirm on top of it, not in the pane behind it. */
  overModal: boolean
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
    const overModal = typeof document !== 'undefined' && document.querySelector('[data-slot="dialog-content"]') != null
    queue.push({ options: opts, resolve, overModal })
    notify?.()
  })
}

/**
 * Tell the person something they must read before going on, with one OK: a write that succeeded
 * with warnings ("2 rows were skipped: ..."). Resolves when dismissed.
 * Not for: a failed write with nothing more to read (`notify`), a question (`confirm`).
 */
export function notice(options: { title: string; message?: React.ReactNode }): Promise<void> {
  return confirm({ ...options, cancelLabel: false, confirmLabel: 'OK' }).then(() => undefined)
}

/**
 * Mount one host at a time. In an InlineDialogScope, confirmations occupy the pane, except one
 * asked from a modal dialog, which opens as a modal on top of it.
 */
export function ConfirmHost() {
  const target = useInlineDialogTarget()
  const [, force] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    notify = force
    return () => {
      notify = null
      for (const pending of queue.splice(0)) pending.resolve(false)
    }
  }, [])

  const current = queue[0] ?? null
  const [typed, setTyped] = React.useState('')
  if (!current) return null
  const o = current.options
  const inline = !!target && !current.overModal
  const Root = inline ? InlineDialog : Dialog
  const Content = inline ? InlineDialogContent : DialogContent
  const Title = inline ? InlineDialogTitle : DialogTitle
  const Description = inline ? InlineDialogDescription : DialogDescription
  const Actions = inline ? SettingsActions : ModalActions
  const locked = o.typed != null && typed !== o.typed
  const answer = (ok: boolean) => {
    if (ok && locked) return
    queue.shift()?.resolve(ok)
    setTyped('')
    force()
  }

  return (
    <Root open onOpenChange={(open) => !open && answer(false)}>
      {/* A long message (an import's warnings) scrolls; the title and the buttons stay in view. */}
      <Content className='max-h-[calc(100dvh-2rem)] max-w-sm' showClose={false} {...(inline ? { fill: false } : {})}>
        <Title className='pr-0 text-body font-medium font-sans' {...(inline ? { crumb: false } : {})}>{o.title ?? 'Are you sure?'}</Title>
        {o.message != null && (
          <Description className='min-h-0 overflow-y-auto whitespace-pre-wrap break-words'>{o.message}</Description>
        )}
        {o.typed != null && (
          <Field label={<>Type <span className='font-mono text-text'>{o.typed}</span> to confirm</>}>
            <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={o.typed} onKeyDown={(e) => { if (e.key === 'Enter') answer(true) }} />
          </Field>
        )}
        <Actions>
          {o.cancelLabel !== false && (
            <Button variant='ghost' size={inline ? 'sm' : 'default'} onClick={() => answer(false)}>
              {o.cancelLabel ?? 'Cancel'}
            </Button>
          )}
          <Button variant={o.danger ? 'destructive' : 'default'} size={inline ? 'sm' : 'default'} autoFocus={o.typed == null} disabled={locked} onClick={() => answer(true)}>
            {o.confirmLabel ?? 'Confirm'}
          </Button>
        </Actions>
      </Content>
    </Root>
  )
}

function ModalActions({ children }: { children: React.ReactNode }) {
  return <div className='mt-2 flex justify-end gap-2'>{children}</div>
}
