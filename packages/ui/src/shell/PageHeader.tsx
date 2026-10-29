import { cn } from '../lib/utils.ts'

/**
 * The one page heading: serif display title, optional description line, optional right-aligned
 * actions, and an optional `leading` control left of the title (an icon button, centred on the
 * title line). Every section canvas opens with this - item-detail views (a task, a ticket)
 * keep their own richer title blocks, but anything that is "an h1 + a blurb (+ buttons)" uses
 * this instead of hand-rolled markup.
 */
export function PageHeader({
  title,
  description,
  actions,
  leading,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  leading?: React.ReactNode
  className?: string
}) {
  return (
    <header data-page-header className={cn('mb-6', actions ? 'flex items-start justify-between gap-3' : undefined, className)}>
      <div className='min-w-0'>
        {leading ? (
          <div className='flex items-center gap-3'>
            <div data-page-leading className='flex shrink-0'>
              {leading}
            </div>
            <h1 data-page-title className='min-w-0 font-serif text-display-md text-text'>
              {title}
            </h1>
          </div>
        ) : (
          <h1 data-page-title className='font-serif text-display-md text-text'>{title}</h1>
        )}
        {description && <p data-page-description className='mt-1 text-body-sm text-muted-foreground'>{description}</p>}
      </div>
      {actions && <div data-page-actions className='flex shrink-0 items-center gap-2'>{actions}</div>}
    </header>
  )
}
