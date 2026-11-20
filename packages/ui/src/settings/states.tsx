// The states a settings section can be in besides its content: empty, a notice that needs the
// owner, loading, failed to load, and the member view.

import * as React from 'react'
import { CircleAlert, Info } from 'lucide-react'
import { cn } from '../lib/utils.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { Button } from '../components/Button.tsx'
import { SETTINGS_GUTTER } from './SettingsPane.tsx'
import { SettingsCanvasContext, SettingsReadOnlyContext, blockSpacing, useCanvasMode } from './internal.tsx'

/**
 * What an empty list or section says: one sentence, what goes here and how to add the first.
 *
 * Use it for: a list with no rows ("No pods yet. Add the first with New pod.").
 * Not for: a whole view's empty state outside Settings (use `CenteredNote` or `EmptyState`), or a
 * condition the owner must fix (use `SettingsNotice`).
 * Rules: name the action, never its position ("below", "above"). Brings its own gutter; inside a
 * canvas `SettingsGroup` it drops it.
 */
export function SettingsEmpty({ children, className }: { children: React.ReactNode; className?: string }) {
  const mode = useCanvasMode()
  return <p className={cn('text-body-sm text-muted-foreground', mode === 'group' ? 'py-1' : cn('py-5', SETTINGS_GUTTER), className)}>{children}</p>
}

const NOTICE_TONE = {
  info: { box: 'border-border bg-bg', icon: 'text-muted-foreground' },
  warning: { box: 'border-warning/30 bg-warning/10', icon: 'text-warning' },
  danger: { box: 'border-danger/30 bg-danger/10', icon: 'text-danger' },
} as const

/**
 * A contained callout for a state that needs the owner: a title that states the condition, then one
 * sentence with the fix.
 *
 * Use it for: setup missing or attention needed (`warning`), a plain note (`info`), a failure
 * (`danger`, which `SettingsError` uses). At most one warning per page; several problems are a list
 * inside it.
 * Not for: an empty list (use `SettingsEmpty`) or a section's intro (use `SettingsIntro`).
 * Props: `items` lists several problems or steps under the sentence (one notice, not several).
 * Rules: sits in the gutter, above the content it concerns; inside a canvas `SettingsGroup` it drops
 * the gutter. Configuration keys appear only as `code` with the file they belong to.
 */
export function SettingsNotice({ tone = 'info', title, items, className, children }: {
  /** info: a plain note; warning: needs the owner; danger: something failed. */
  tone?: 'info' | 'warning' | 'danger'
  title: React.ReactNode
  /** Several problems or steps: a bulleted list under the sentence. */
  items?: React.ReactNode[]
  className?: string
  children?: React.ReactNode
}) {
  const mode = useCanvasMode()
  const t = NOTICE_TONE[tone]
  const Icon = tone === 'danger' ? CircleAlert : Info
  return (
    <div className={cn(mode !== 'group' && SETTINGS_GUTTER, blockSpacing(mode))}>
      <div
        role={tone === 'danger' ? 'alert' : tone === 'warning' ? 'status' : undefined}
        className={cn('flex gap-3 rounded-lg border px-4 py-3 text-body-sm', t.box, className)}>
        <Icon className={cn('mt-0.5 size-4 shrink-0', t.icon)} />
        <div className='min-w-0'>
          <p className='font-medium text-text'>{title}</p>
          {children && <div className='mt-0.5 text-muted-foreground'>{children}</div>}
          {items && items.length > 0 && (
            <ul className='mt-1 flex list-disc flex-col gap-0.5 pl-4 text-muted-foreground marker:text-fg-4'>
              {items.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * What a section shows while its first data arrives: nothing for 300 ms, then a few quiet skeleton
 * rows. The label is always there for screen readers.
 *
 * Use it for: the first load of a list, a form or a detail page.
 * Not for: a refetch with data on screen (keep the data), a whole view outside Settings (use
 * `CenteredNote`), a button's own busy state.
 */
export function SettingsLoading({ label = 'Loading' }: {
  /** Screen-reader text; the skeleton itself has no words. */
  label?: string
}) {
  const mode = useCanvasMode()
  const [shown, setShown] = React.useState(false)
  React.useEffect(() => {
    const timer = setTimeout(() => setShown(true), 300)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div role='status' aria-busy='true' className={cn('flex flex-col', mode !== 'group' && SETTINGS_GUTTER, blockSpacing(mode))}>
      <span className='sr-only'>{label}</span>
      {shown && (
        <div aria-hidden='true' className='flex flex-col'>
          {['w-2/5', 'w-1/2', 'w-1/3'].map((w) => (
            <div key={w} className='flex min-h-12 flex-col justify-center gap-2 border-b border-border px-[var(--grid-pad,0.5rem)] py-1.5'>
              <div className={cn('h-3 animate-pulse rounded bg-surface-hover', w)} />
              <div className='h-2.5 w-1/4 animate-pulse rounded bg-surface-hover' />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * What a section shows when its data failed to load: a danger notice with a readable sentence and
 * Retry.
 *
 * Use it for: a failed query of a list, a form or a detail page.
 * Not for: a failed save (the footer note of `SettingsSaveBar` reports it) or a row edit (the row
 * reports it).
 * Props: `error` is anything caught (shown through `errorMessage`); `title` replaces 'This could not
 * load.'; `onRetry` adds the Retry button (usually the query's `refetch`).
 */
export function SettingsError({ error, title = 'This could not load.', onRetry }: { error: unknown; title?: React.ReactNode; onRetry?: () => void }) {
  return (
    <SettingsNotice tone='danger' title={title}>
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <Button variant='outline' size='xs' className='mt-2' onClick={onRetry}>
          Retry
        </Button>
      )}
    </SettingsNotice>
  )
}

/** True under an active `SettingsReadOnly`: the member view, where change controls are left out. */
export function useSettingsReadOnly(): boolean {
  return React.useContext(SettingsReadOnlyContext)
}

/**
 * The member view of a page: the same page without the controls for changing it, and one sentence
 * saying who can.
 *
 * Use it for: a section or page someone may read but not change (`active={!admin}`).
 * Not for: a section a role cannot read at all (leave it out of the nav), or one control the server
 * refuses (disable that control and say why in its title).
 * Rules: with `active` it shows `note` as a notice at the top and tells the kit through context;
 * the write pieces read it: a `Field`'s control and a `SettingsControlRow`'s control are disabled,
 * `SettingsHeaderActions`, `SettingsSaveBar`, `SettingsDeleteButton`, a `DataGrid`'s in-place
 * editing and every "..." menu item not marked `reader` render nothing. What a reader uses
 * stays live: a list's search, filters and row opening, tabs, disclosures, copy buttons. A write
 * control that is none of these pieces (a loose button) checks `useSettingsReadOnly()` itself and
 * is left out. The server's answer stays authoritative. Put it inside a `SettingsTabs` panel.
 */
export function SettingsReadOnly({ active, note, children }: {
  /** Usually `!admin`. Inactive renders the children unchanged. */
  active: boolean
  /** The one sentence: "Only administrators can change this." */
  note: React.ReactNode
  children: React.ReactNode
}) {
  const mode = useCanvasMode()
  if (!active) return <SettingsReadOnlyContext.Provider value={false}>{children}</SettingsReadOnlyContext.Provider>
  // The note is the first piece now, so what follows it gets no first-child treatment.
  const inner = mode === 'canvas' || mode === 'panel' ? 'flow' : mode
  return (
    <SettingsReadOnlyContext.Provider value={true}>
      <SettingsNotice title={note} />
      <SettingsCanvasContext.Provider value={inner}>{children}</SettingsCanvasContext.Provider>
    </SettingsReadOnlyContext.Provider>
  )
}

/**
 * An inline note that a value changed outside the Box, with what it was and the act that accepts
 * the new one.
 *
 * Use it for: text an outside system rewrote that someone should look at before it takes effect
 * (an MCP tool's description, a provider's terms), under the current value.
 * Not for: a form's own unsaved changes (the save bar), a page-level condition (use
 * `SettingsNotice`).
 * Props: `title` says what changed ("The description changed. It was:"); `previous` is the old text,
 * kept with its line breaks; `action` is the accept button (a ghost `Button size='sm'`).
 * Rules: compact and warning-toned, inside the row or field it concerns; never a modal.
 */
export function SettingsChangedFrom({ title, previous, action, className }: {
  title: React.ReactNode
  previous: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div role='status' className={cn('mt-1.5 flex flex-col items-start gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-label', className)}>
      <span className='text-warning'>{title}</span>
      <span className='whitespace-pre-line text-muted-foreground'>{previous}</span>
      {action}
    </div>
  )
}
