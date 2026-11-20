// A ruled group of a section.

import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { SETTINGS_GUTTER } from './SettingsPane.tsx'
import { SettingsCanvasContext, blockSpacing, onCanvas, useCanvasMode } from './internal.tsx'

/**
 * A group inside a section: a hairline rule, an uppercase label, an optional one-line description
 * and an optional aside, then the group's content.
 *
 * Use it for: the parts of a form, the blocks of an overview (facts, a list with its actions).
 * Not for: the title over a second list (a `section` `DataGrid` has its own), a contained callout
 * (use `SettingsNotice`).
 * Props: `aside` sits right of the label (a count, a quiet button, an operational act like
 * Reconnect); `bleed` runs the rule edge to edge.
 * Rules: on a canvas (the pane, a `SettingsPage`, a `SettingsTabs` panel) it brings the gutter and
 * its top offset, the first group drops its rule, and a list inside (a `DataGrid`, a `SettingsControlList`) reaches the pane edge
 * by itself. In a section that still writes its own gutter it renders as before: inside that gutter,
 * or with `bleed` putting the label and content in the gutter.
 */
export function SettingsGroup({ title, description, aside, bleed = false, className, children }: {
  title: React.ReactNode
  /** One line under the label: what the group is for. */
  description?: React.ReactNode
  aside?: React.ReactNode
  /** Run the rule edge to edge; label and content stay in the gutter. */
  bleed?: boolean
  className?: string
  children: React.ReactNode
}) {
  const mode = useCanvasMode()
  const canvas = onCanvas(mode)
  // On a canvas the group owns the gutter: around the whole section when the rule is inset, around
  // its label and content when the rule is full-bleed.
  const outer = canvas && !bleed ? 'mx-4 md:mx-6' : undefined
  const inner = bleed ? SETTINGS_GUTTER : undefined
  const firstRule = mode === 'canvas' || mode === 'panel' ? 'first:border-t-0 first:pt-0 [form:not(:first-child)>&]:border-t [form:not(:first-child)>&]:pt-4' : undefined
  const content = <SettingsCanvasContext.Provider value={canvas ? 'group' : mode}>{children}</SettingsCanvasContext.Provider>
  return (
    <section
      aria-label={typeof title === 'string' ? title : undefined}
      className={cn('flex flex-col gap-4 border-t border-border pt-4', outer, blockSpacing(mode), firstRule, className)}>
      <div className={cn('flex min-h-4 flex-wrap items-start justify-between gap-x-3 gap-y-1', inner)}>
        <div className='min-w-0'>
          <h2 className='text-label uppercase tracking-[0.07em] text-muted-foreground'>{title}</h2>
          {description && <p className='mt-1 max-w-prose text-body-sm text-muted-foreground'>{description}</p>}
        </div>
        {aside && <div className='flex items-center gap-2'>{aside}</div>}
      </div>
      {bleed ? <div className={cn('flex flex-col gap-4', inner)}>{content}</div> : content}
    </section>
  )
}
