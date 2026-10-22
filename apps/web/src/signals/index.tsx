import { BarChart3, Plug, UserRound } from 'lucide-react'
import { defineWebFeature } from '../feature.ts'
import { DataSourcesSection } from './views/DataSourcesSection.tsx'
import { SignalOwnersView } from './views/SignalOwnersView.tsx'
import { SignalsSection } from './views/SignalsSection.tsx'

/** Core's signals live in Settings: Signals (the grid and each signal's detail), Signal owners and
 *  Data sources. No sidebar entry: a recipe that reads signals brings its own. */
export default defineWebFeature({
  id: 'signals',
  routes: [],
  settings: [
    { id: 'signals', label: 'Signals', icon: BarChart3, order: 108, render: (params) => <SignalsSection params={params} /> },
    { id: 'signal-owners', label: 'Signal owners', icon: UserRound, order: 110, render: () => <SignalOwnersView /> },
    { id: 'data-sources', label: 'Data sources', icon: Plug, order: 120, render: () => <DataSourcesSection /> },
  ],
})
