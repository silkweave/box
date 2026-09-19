import type * as React from 'react'

/** A full-height centered note - the empty/loading/error state of a whole view. */
export function CenteredNote({ children }: { children: React.ReactNode }) {
  return (
    <div className='grid h-dvh place-items-center bg-bg px-6 text-center text-body-sm leading-loose text-muted-foreground'>
      <p>{children}</p>
    </div>
  )
}
