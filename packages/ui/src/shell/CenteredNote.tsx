import type * as React from 'react'

/**
 * A full-height centred note: the loading, empty or error state of a whole view.
 * Use it while a view's first data arrives, when a route has nothing to show, or when it failed.
 * Not for a page that is empty by design and offers a way out (`EmptyState`), an empty list inside a
 * page (`SettingsEmpty`), or the states of a settings section (`SettingsLoading`, `SettingsError`).
 * Rule: it claims `h-dvh`; render it instead of the view, never inside one.
 */
export function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className='grid h-dvh place-items-center bg-bg px-6 text-center text-body-sm leading-loose text-muted-foreground'>
      <p>{children}</p>
    </div>
  )
}
