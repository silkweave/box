import { BarChart3, Database, UserRound } from 'lucide-react'
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
    { id: 'signals', label: 'Signals', icon: BarChart3, group: 'signals', order: 108, render: (params) => <SignalsSection params={params} /> },
    { id: 'signal-owners', label: 'Signal owners', icon: UserRound, group: 'signals', order: 110, render: (params) => <SignalOwnersView params={params} /> },
    { id: 'data-sources', label: 'Data sources', icon: Database, group: 'signals', order: 120, render: (params) => <DataSourcesSection params={params} /> },
  ],
})
