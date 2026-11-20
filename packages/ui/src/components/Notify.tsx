// A short notice at the bottom of the window for what has nowhere else to say it: a write fired from
// a cell, a rename in the top bar, a drag. `notify(...)` from anywhere (no hook threading), drawn by
// the one <NotifyHost/> the app mounts. Replaces `window.alert`.

import * as React from 'react'
import { TriangleAlert, X } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { errorMessage } from '../lib/errorMessage.ts'

export interface NotifyOptions {
  /** `danger` for a failure (the default), `neutral` for a plain fact ("Copied to 3 tickets"). */
  tone?: 'danger' | 'neutral'
}

interface Entry {
  id: number
  message: string
  tone: 'danger' | 'neutral'
}

const SHOWN = 3
const LIFETIME = { danger: 8000, neutral: 4000 }
let entries: Entry[] = []
let nextId = 1
let render: (() => void) | null = null

function dismiss(id: number): void {
  entries = entries.filter((e) => e.id !== id)
  render?.()
}

/**
 * Show a short notice at the bottom of the window.
 *
 * Use it for: a write that failed where the person acted and no form can hold the message (a status
 * picked in a row, a crumb renamed, a card dropped), as "Could not save the status: <reason>".
 * Not for: a form's save (its `SettingsSaveBar` note says it), a question (`confirm`), something the
 * person must read before going on (`notice`), success of an act the screen already shows.
 * Rules: one sentence, sentence case; danger notices stay 8 s, neutral 4 s; at most three show.
 */
export function notify(message: string, options: NotifyOptions = {}): void {
  const entry: Entry = { id: nextId++, message, tone: options.tone ?? 'danger' }
  entries = [...entries, entry].slice(-SHOWN)
  render?.()
  setTimeout(() => dismiss(entry.id), LIFETIME[entry.tone])
}

/** `notify` for a failed write: "<what>: <readable reason>" ("Could not save the status: ..."). */
export function notifyError(what: string, err: unknown): void {
  notify(`${what}: ${errorMessage(err)}`)
}

/** Mount once, at the app's root. */
export function NotifyHost() {
  const [, force] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    render = force
    return () => {
      render = null
    }
  }, [])
  return (
    <div aria-live='polite' className='pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4'>
      {entries.map((e) => (
        <div
          key={e.id}
          role={e.tone === 'danger' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex max-w-lg items-start gap-2 rounded-lg border bg-surface px-3 py-2 text-body-sm text-text shadow-(--shadow-md)',
            e.tone === 'danger' ? 'border-danger/40' : 'border-border',
          )}>
          {e.tone === 'danger' && <TriangleAlert aria-hidden className='mt-0.5 size-4 shrink-0 text-danger' />}
          <span className='min-w-0 flex-1 break-words'>{e.message}</span>
          <button
            type='button'
            aria-label='Dismiss'
            onClick={() => dismiss(e.id)}
            className='-mr-1 grid size-5 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-surface-hover hover:text-text'>
            <X className='size-3.5' />
          </button>
        </div>
      ))}
    </div>
  )
}
