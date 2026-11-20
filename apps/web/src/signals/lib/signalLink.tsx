import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { settingsHash } from '../../lib/settingsLocation.ts'
import type { Signal } from '../../types.ts'

// Signals live in Settings, in the "Signals" section: `#settings/signals` is the list and
// `#settings/signals/<id>` one signal's detail (the id URL-encoded). A hash link opens the Settings
// dialog over whatever page is showing.

/** The Settings path of the Signals list, or of one signal's detail. */
export function signalsPath(id?: string): string {
  return id ? `signals/${encodeURIComponent(id)}` : 'signals'
}

/** The same as a hash (without `#`), for links. */
export function signalsHash(id?: string): string {
  return settingsHash(signalsPath(id))
}

/** The hash (without `#`) for one signal's detail. */
export function signalHash(signal: Pick<Signal, 'id'>): string {
  return signalsHash(signal.id)
}

/** A link that opens the Signals section (or a signal) without leaving the page. */
export function SignalsLink({ hash, className, children }: { hash: string; className?: string; children: ReactNode }) {
  return (
    <Link to='.' search={true} hash={hash} resetScroll={false} hashScrollIntoView={false} className={className}>
      {children}
    </Link>
  )
}
