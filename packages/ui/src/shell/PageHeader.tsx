import { cn } from '../lib/utils.ts'

/**
 * The one page heading: serif display title, optional description line, optional right-aligned
 * actions. Every section canvas opens with this - item-detail views (a task, a content piece)
 * keep their own richer title blocks, but anything that is "an h1 + a blurb (+ buttons)" uses
 * this instead of hand-rolled markup.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-6', actions ? 'flex items-start justify-between gap-3' : undefined, className)}>
      <div className='min-w-0'>
        <h1 className='font-serif text-display-md text-text'>{title}</h1>
        {description && <p className='mt-1 text-body-sm text-muted-foreground'>{description}</p>}
      </div>
      {actions && <div className='flex shrink-0 items-center gap-2'>{actions}</div>}
    </header>
  )
}
