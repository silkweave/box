import * as React from 'react'
import { Collapsible } from '@base-ui/react/collapsible'
import { ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils.ts'

/**
 * A small fold inside a form: a quiet title with a chevron that shows or hides a few more fields.
 *
 * Use it for: "Advanced" options under a form, rarely needed fields, a long explanation the reader
 * may want.
 * Not for: a page-level section (use `SettingsGroup`), switching between views (use `SettingsTabs`
 * or `SegmentedControl`), hiding a field the task needs.
 * Props: uncontrolled with `defaultOpen`, or controlled with `open` and `onOpenChange`.
 * Rules: starts closed. The content stays mounted (hidden) while closed, so fields inside keep
 * their values and still belong to the form; an invalid field must not hide in a closed fold, so
 * open it when validation fails there.
 */
export function Disclosure({
  title,
  defaultOpen,
  open,
  onOpenChange,
  className,
  children,
}: {
  /** The fold's name, sentence case: "Advanced". */
  title: React.ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <Collapsible.Root
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}
      className={cn('min-w-0', className)}>
      <Collapsible.Trigger
        className={cn(
          'group/disclosure -ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-label font-medium text-muted-foreground',
          'transition-colors outline-none hover:text-text focus-visible:ring-3 focus-visible:ring-ring/50',
        )}>
        <ChevronRight className='size-3.5 transition-transform group-data-[panel-open]/disclosure:rotate-90' />
        {title}
      </Collapsible.Trigger>
      <Collapsible.Panel keepMounted className='pt-3'>{children}</Collapsible.Panel>
    </Collapsible.Root>
  )
}
