// Archetype: LOG (docs/DESIGN.md 2.2 and 2.3). Use it for things that happened: one `DataGrid`
// (search and filters in its bar, Refresh as its `actions`, no sort control). Read-only. A row opens a routed detail page when there is one.
// Copy this file's structure: the `route` string ('' the log, '<id>' one entry; in the app
// `#settings/runs/<id>` through `useSettingsDialog().open`), a filter that narrows the rows, rows
// with a `StatusDot`, and the relative time with the full date as its title.
// An entry with no page of its own but more to read (the full error, the arguments) opens in place
// with `expandDetail` instead of `onOpen` (story "Details in place"); never hide it in a `title`.

import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { RefreshCw } from 'lucide-react'
import { Button } from '../../components/Button.tsx'
import { StatusDot } from '../../components/StatusDot.tsx'
import { RelativeTime } from '../../components/RelativeTime.tsx'
import { DataGrid } from '../../list/DataGrid.tsx'
import { SettingsEmpty, SettingsIntro, SettingsPage } from '../../settings/index.ts'
import { PaneFrame, later } from '../../settings/storyFrame.tsx'

type State = 'ready' | 'loading' | 'error' | 'empty'
type Args = { state: State }

const meta: Meta<Args> = {
  title: 'Patterns/Settings log',
  parameters: { layout: 'fullscreen' },
  args: { state: 'ready' },
  argTypes: { state: { control: 'inline-radio', options: ['ready', 'loading', 'error', 'empty'] } },
}
export default meta

type Result = 'ok' | 'failed' | 'running'
const NOW = Date.parse('2026-11-17T12:00:00Z')
type Run = { id: string; name: string; at: string; seconds: number; result: Result; error?: string }
const RUNS: Run[] = [
  { id: 'r1', name: 'Morning digest', at: '2026-11-17T11:55:00Z', seconds: 4, result: 'running' },
  { id: 'r2', name: 'Stale deals', at: '2026-11-17T09:42:00Z', seconds: 12, result: 'failed', error: 'The CRM answered 401: the API token was revoked. Reconnect the CRM in Settings > Data sources.' },
  { id: 'r3', name: 'Morning digest', at: '2026-11-17T08:00:00Z', seconds: 9, result: 'ok' },
  { id: 'r4', name: 'Weekly report', at: '2026-11-10T09:00:00Z', seconds: 31, result: 'ok' },
]
const TONE = { ok: 'success', failed: 'danger', running: 'accent' } as const
const LABEL = { ok: 'Succeeded', failed: 'Failed', running: 'Running' } as const


function Runs({ state, inPlace = false }: Args & { inPlace?: boolean }) {
  // In the app: `params` of the section's `render(params)`; `open` is `useSettingsDialog().open`.
  const [route, setRoute] = useState('')
  const open = (path = '') => setRoute(path)
  const [refreshing, setRefreshing] = useState(false)

  if (route) {
    return (
      <SettingsPage title={RUNS.find((r) => r.id === route)?.name ?? route} onClose={() => open()}>
        <SettingsEmpty>A run with its own page follows the Detail pattern.</SettingsEmpty>
      </SettingsPage>
    )
  }
  return (
    <>
      <SettingsIntro>Every time an automation ran, newest first.</SettingsIntro>
      {/* Newest first, so the only order is the log's own: the bar has no `sort`. */}
      <DataGrid<Run>
        rows={state === 'empty' ? [] : RUNS}
        getId={(r) => r.id}
        loading={state === 'loading'}
        error={state === 'error' ? new Error('The server did not answer.') : undefined}
        onRetry={() => undefined}
        empty='Nothing has run yet. Runs appear here once an automation fires.'
        bar={{
          noun: 'runs',
          fields: [{ key: 'result', title: 'Result', type: 'options', options: Object.entries(LABEL).map(([value, label]) => ({ value, label })) }],
        }}
        searchText={(r) => r.name}
        filterValue={(r, key) => (key === 'result' ? r.result : null)}
        rowLabel={(r) => `run of ${r.name}`}
        onOpen={inPlace ? undefined : (r) => open(r.id)}
        expandDetail={inPlace ? (r) => (r.error ? <p className='py-2 text-body-sm text-danger'>{r.error}</p> : null) : undefined}
        icon={(r) => <StatusDot tone={TONE[r.result]} label={LABEL[r.result]} pulse={r.result === 'running'} />}
        name={{ label: 'Automation', render: (r) => <span className='truncate font-medium text-text'>{r.name}</span> }}
        columns={[
          { key: 'at', label: 'When', width: 96, render: (r) => <RelativeTime value={r.at} now={NOW} className='text-body-sm text-muted-foreground' /> },
          { key: 'took', label: 'Took', width: 64, priority: 2, render: (r) => <span className='text-body-sm text-muted-foreground tabular-nums'>{r.seconds}s</span> },
        ]}
        actions={
          <Button
            variant='outline'
            size='sm'
            disabled={refreshing}
            onClick={() => {
              setRefreshing(true)
              void later(500).then(() => setRefreshing(false))
            }}>
            <RefreshCw /> Refresh
          </Button>
        }
      />
    </>
  )
}

/** Things that happened: a grid with search, a filter and Refresh, rows with status and time. */
export const Log: StoryObj<Args> = {
  render: (args) => (
    <PaneFrame title='Runs'>
      <Runs key={args.state} {...args} />
    </PaneFrame>
  ),
}

/** No page per entry: a failed run opens in place to show its full error (click the row, or Enter
 *  on its "Show details" button). Rows with nothing more to show do not open. */
export const DetailsInPlace: StoryObj<Args> = {
  name: 'Details in place',
  render: (args) => (
    <PaneFrame title='Runs'>
      <Runs key={args.state} {...args} inPlace />
    </PaneFrame>
  ),
}
