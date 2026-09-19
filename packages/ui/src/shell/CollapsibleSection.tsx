// A section that folds shut behind a caret.
//
// It was hand-rolled at least twice - a chart section with its headline in the header strip, and a
// card on a detail page - with the same three decisions made identically both times and nothing
// holding them together:
//
//   • THE WHOLE HEADING IS THE HIT TARGET, not the caret. A 14px chevron is a target you aim at; a
//     heading is one you throw the pointer at. `aria-expanded` goes on that button, so a screen
//     reader gets the disclosure without a `role` anywhere.
//   • THE CARET ROTATES, it does not swap glyph. One element that turns 90 degrees is a motion the
//     eye follows; two icons exchanged is a flicker.
//   • THE BODY IS UNMOUNTED WHEN SHUT, not hidden. A folded section should not be paying for a
//     chart's render, and a hidden subtree is still in the tab order unless you remember `inert`.
//
// CONTROLLED ONLY. Whether a fold survives a reload, and under what key, is the app's business - the
// library does not own storage keys (see the contract at the top of this package's README). Pair it
// with `usePersistedState` from `@silkweave/box-ui/lib` if the fold should stick.

import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils.ts'

export function CollapsibleSection({
  open,
  onOpenChange,
  title,
  heading,
  icon,
  aside,
  children,
  className,
  headerClassName,
  triggerClassName,
  bodyClassName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /**
   * Wrap the trigger in a heading of this level, so the section shows up in a document outline and
   * in a screen reader's heading list. This is the ARIA disclosure pattern: the HEADING contains the
   * button, never the other way round - a `<h2>` inside a `<button>` is invalid HTML, because a
   * button's content model is phrasing content only.
   */
  heading?: 2 | 3 | 4 | 5
  /** A glyph between the caret and the title. */
  icon?: ReactNode
  /**
   * The header's right-hand slot: a headline figure, an Add button, a count.
   *
   * Rendered exactly as given, in both states. Whether an action should survive the fold is a
   * judgement about that action - a figure that IS the section wants to stay, a button that operates
   * on rows you can no longer see is a trap - so the caller decides by passing `null` when shut.
   */
  aside?: ReactNode
  children: ReactNode
  className?: string
  headerClassName?: string
  triggerClassName?: string
  bodyClassName?: string
}) {
  const Heading = (heading ? `h${heading}` : 'div') as 'div'

  return (
    <section className={className}>
      <div className={cn('flex items-center gap-2', headerClassName)}>
        <Heading className='contents'>
          <button
            type='button'
            onClick={() => onOpenChange(!open)}
            aria-expanded={open}
            className={cn(
              'flex min-w-0 items-center gap-1.5 text-left text-body-sm font-medium text-text transition-colors hover:text-accent',
              triggerClassName,
            )}>
            <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
            {icon}
            <span className='truncate'>{title}</span>
          </button>
        </Heading>
        {aside != null && <span className='ml-auto flex min-w-0 shrink-0 items-center'>{aside}</span>}
      </div>
      {open && <div className={bodyClassName}>{children}</div>}
    </section>
  )
}
