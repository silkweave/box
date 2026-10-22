import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { settingsHash } from '../../lib/settingsLocation.ts'
import { signalSlug } from './signalSlug.ts'
import type { Signal } from '../../types.ts'

// Signals live in Settings, in the "Signals" section: `#settings/signals` is the grid,
// `#settings/signals/<channel>` one channel's grid and `#settings/signals/<channel>/<slug>` one
// signal's detail. A hash link opens the Settings dialog over whatever page is showing.

/** The Settings path of the Signals section, a channel's grid, or one signal's detail. */
export function signalsPath(channel?: string, slug?: string): string {
  return ['signals', ...(channel ? [encodeURIComponent(channel)] : []), ...(channel && slug ? [slug] : [])].join('/')
}

/** The same as a hash (without `#`), for links. */
export function signalsHash(channel?: string, slug?: string): string {
  return settingsHash(signalsPath(channel, slug))
}

/** The hash (without `#`) for one signal's detail. */
export function signalHash(signal: Pick<Signal, 'id' | 'channel'>): string {
  return signalsHash(signal.channel, signalSlug(signal))
}

/** A link that opens the Signals section (or a channel, or a signal) without leaving the page. */
export function SignalsLink({ hash, className, children }: { hash: string; className?: string; children: ReactNode }) {
  return (
    <Link to='.' search={true} hash={hash} resetScroll={false} hashScrollIntoView={false} className={className}>
      {children}
    </Link>
  )
}
