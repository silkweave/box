import { SettingsError, SettingsLoading } from '@silkweave/box-ui'
import { canAccessArea, useAccess } from '@/lib/access'
import { useSignalsDataWithArchived } from '../lib/useSignalsData.ts'
import { SignalsList } from './SignalsList.tsx'
import { SignalDetailView } from './SignalDetailView.tsx'
import { SignalCreatePage, SignalEditPage } from './SignalEditPage.tsx'

const decode = (part: string): string => {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

/** The Signals settings section: the list at `#settings/signals`, the create page at
 *  `#settings/signals/new`, one signal's detail at `#settings/signals/<id>` and its definition at
 *  `.../edit`. */
export function SignalsSection({ params }: { params: string[] }) {
  // The page reads archived signals too: a detail stays reachable, and the grid hides them unless
  // "Show archived" is on.
  const { data, error } = useSignalsDataWithArchived()
  useAccess() // re-render when access changes
  if (error) return <><SettingsError error={error} title='Signals could not load.' /></>
  if (!data) return <><SettingsLoading label='Loading signals' /></>
  const [part, page] = params
  // Without write the create and edit routes fall back to the list and the detail.
  // A new signal is stored under `signals` (or its tracker's feature, checked by the server).
  if (part === 'new' && !page) return canAccessArea('signals', 'write') ? <SignalCreatePage /> : <SignalsList />
  if (part) {
    const id = decode(part)
    const signal = data.signals.find((s) => s.id === id)
    if (signal && page === 'edit' && canAccessArea(signal.area, 'write')) return <SignalEditPage signal={signal} />
    if (signal) return <SignalDetailView signal={signal} data={data} />
    // A route that names a missing signal shows a notice on the list.
    return <SignalsList missing={id} />
  }
  return <SignalsList />
}
