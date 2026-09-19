// The "there is nothing here" page: a glyph in a tinted disc, a headline, a line of explanation and
// an optional action. The LAYOUT is library material - the disc's size, the serif headline, the
// measure the paragraph is held to - and the SENTENCES are not. It was lifted out of one feature's
// Inbox Zero screen on 2026-09-14, which had all four welded together.
//
// It claims 60vh and centres in it, so it reads as a state of the page rather than a note at the top
// of an empty list. Give it the same box the list would have had.

import type { ReactNode } from 'react'
import { cn } from '../lib/utils.ts'

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  /** A glyph, sized by the caller. Sits in a tinted disc; omit it and the disc goes too. */
  icon?: ReactNode
  title: ReactNode
  /** One or two sentences. Anything longer belongs on a page, not in an empty state. */
  description?: ReactNode
  /** The one thing to do about it. */
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('grid min-h-[60vh] place-items-center px-6 text-center', className)}>
      <div className='max-w-md'>
        {icon && (
          <div className='mx-auto grid size-14 place-items-center rounded-full bg-accent-tint text-accent'>{icon}</div>
        )}
        <h2 className={cn('font-serif text-display-lg leading-none text-text', icon && 'mt-5')}>{title}</h2>
        {description && <p className='mt-3 text-body-sm leading-relaxed text-muted-foreground'>{description}</p>}
        {action && <div className='mt-6 flex justify-center'>{action}</div>}
      </div>
    </div>
  )
}
