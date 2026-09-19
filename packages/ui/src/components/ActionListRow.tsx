// A row in a list of things that want doing: a leading glyph, a meta line, a headline, a body, and a
// row of actions along the bottom. The tactical inbox was the first list built this way and not the
// last - a review queue, a run list and a notification feed are the same object - so the FRAME came
// into the library on 2026-09-14 and the vocabulary stayed behind.
//
// Everything is a slot. It does not know what kind the item is, what the meta line says, whether the
// actions are "Mark done" or "Retry", or that a handled row is called done - only that a row can be
// dimmed, that its headline can be clickable, and where each part goes.
//
// `group/row` is exposed on the wrapper so an action can fade in on hover with `group-hover/row:`,
// which is how the actions stay quiet in a list of forty.

import type { ReactNode } from 'react'
import { cn } from '../lib/utils.ts'

export function ActionListRow({
  icon,
  meta,
  aside,
  title,
  onTitleClick,
  body,
  actions,
  muted,
  className,
}: {
  /** Sized by the caller; it sits on the headline's baseline-ish line at the row's left edge. */
  icon?: ReactNode
  /** The small line above the headline - a kind, a target, a source. */
  meta?: ReactNode
  /** Pushed to the right end of the meta line: a date, a count. */
  aside?: ReactNode
  title: ReactNode
  /** Makes the headline the row's affordance. Omit it and the headline is text. */
  onTitleClick?: () => void
  /** A snippet, an excerpt, a reason. Clamped by the caller if it needs to be. */
  body?: ReactNode
  /** The bottom strip. A `<span className='flex-1' />` between two groups splits it left and right. */
  actions?: ReactNode
  /** Dimmed - the row is handled, dismissed, archived. What that MEANS is the caller's word. */
  muted?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'group/row flex gap-3 rounded-lg border border-border bg-surface p-4 shadow-(--shadow-sm)',
        'transition-colors hover:border-accent/40',
        muted && 'opacity-60',
        className,
      )}>
      {icon && <span className='mt-0.5 shrink-0 text-muted-foreground'>{icon}</span>}

      <div className='min-w-0 flex-1'>
        {(meta || aside) && (
          <div className='flex items-center gap-2 text-label uppercase tracking-[0.04em] text-muted-foreground'>
            {meta}
            {aside && <span className='ml-auto shrink-0 tabular-nums'>{aside}</span>}
          </div>
        )}

        <p
          className={cn('mt-1.5 text-body-sm font-medium text-text', onTitleClick && 'cursor-pointer hover:underline')}
          onClick={onTitleClick}>
          {title}
        </p>

        {body && <div className='mt-1 text-body-sm leading-relaxed text-muted-foreground'>{body}</div>}

        {actions && <div className='mt-3 flex items-center gap-2'>{actions}</div>}
      </div>
    </div>
  )
}
