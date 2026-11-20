// The identity of the thing a detail page shows, and the gradient banner it replaces.

import * as React from 'react'
import { cn } from '../lib/utils.ts'
import { ActionMenu, type ActionMenuItem } from '../components/ActionMenu.tsx'
import { SETTINGS_GUTTER } from './SettingsPane.tsx'
import { SettingsReadOnlyContext, blockSpacing, useCanvasMode, visibleMenuItems } from './internal.tsx'

/**
 * The head of a detail page whose thing has more identity than its name: media, the name, status
 * badges, one meta line and a "..." menu of secondary acts.
 *
 * Use it for: a person, a server, a channel, a pod: first on the page's canvas, before any notice
 * and the detail tabs.
 * Not for: a thing whose name is all its identity (a role, a toolset): the breadcrumb is its title,
 * and the page has no header.
 * Props: `media` fills a 48px slot (an `Avatar`, a letter or icon tile); `badges` sit right of the
 * name; `meta` is one muted line (address, id, "Connected by Toby 2d ago"); `actions` are secondary
 * acts (Check now, Copy id); `children` is a warning or error line under the meta.
 * Rules: Delete is not in `actions`: it lives in the page footer (`SettingsDeleteButton`). Under an
 * active `SettingsReadOnly` only items marked `reader` stay.
 */
export function SettingsDetailHeader({ title, media, badges, meta, actions, children }: {
  /** The entity name, serif display size. */
  title: React.ReactNode
  media?: React.ReactNode
  badges?: React.ReactNode
  meta?: React.ReactNode
  actions?: ActionMenuItem[]
  children?: React.ReactNode
}) {
  const mode = useCanvasMode()
  const readOnly = React.useContext(SettingsReadOnlyContext)
  const items = visibleMenuItems(actions, readOnly)
  return (
    <header className={cn('flex items-start gap-4', mode !== 'group' && SETTINGS_GUTTER, blockSpacing(mode))}>
      {media && <div className='flex size-12 shrink-0 items-center justify-center'>{media}</div>}
      <div className='flex min-h-12 min-w-0 flex-1 flex-col justify-center'>
        <div className='flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1'>
          <h2 className='min-w-0 truncate font-serif text-display-sm leading-tight text-text'>{title}</h2>
          {badges && <div className='flex flex-wrap items-center gap-1.5'>{badges}</div>}
        </div>
        {meta && <div className='mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-body-sm text-muted-foreground'>{meta}</div>}
        {children && <div className='mt-2 text-body-sm'>{children}</div>}
      </div>
      {items.length > 0 && <ActionMenu items={items} className='mt-2 shrink-0' />}
    </header>
  )
}

