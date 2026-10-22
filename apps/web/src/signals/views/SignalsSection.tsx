import { SETTINGS_GUTTER } from '@silkweave/box-ui'
import { useSignalsData } from '../lib/useSignalsData.ts'
import { SignalsGrid } from './SignalsGrid.tsx'
import { SignalDetailView } from './SignalDetailView.tsx'

const decode = (part: string): string => {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/** The Signals settings section. `#settings/signals` is every signal, `#settings/signals/<channel>`
 *  one channel's, and `#settings/signals/<channel>/<slug>` one signal's detail. */
export function SignalsSection({ params }: { params: string[] }) {
  const { data, error } = useSignalsData()
  if (error) return <p className={`${SETTINGS_GUTTER} py-8 text-body-sm text-danger`}>Failed to reach the API: {error}</p>
  if (!data) return <p className={`${SETTINGS_GUTTER} py-8 text-body-sm text-muted-foreground`}>Loading…</p>
  const [channel, slug] = params
  if (channel && slug) return <SignalDetailView channel={decode(channel)} slug={slug} />
  return <SignalsGrid channel={channel ? decode(channel) : undefined} />
}
