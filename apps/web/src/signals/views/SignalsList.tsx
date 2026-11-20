import { Plus } from 'lucide-react'
import type { Signal } from '../../types.ts'
import { baseChannel, channelLabel } from '../../types.ts'
import {
  Button,
  Checkbox,
  SettingsHeaderActions,
  SettingsIntro,
  SettingsNotice,
  UserChip,
  usePersonName,
} from '@silkweave/box-ui'
import { DataGrid, NameCell } from '@silkweave/box-ui/list'
import { Sparkline } from '@silkweave/box-ui/charts'
import { useSignalsDataWithArchived } from '../lib/useSignalsData.ts'
import { signalReading, sparkWindow } from '../lib/signalReading.ts'
import { SignalsLink, signalsPath } from '../lib/signalLink.tsx'
import { formatBucket, formatNumber } from '../../lib/format.ts'
import { SignalDelta } from '../components/SignalDelta.tsx'
import { useActiveUser } from '../../lib/useActiveUser.ts'
import { usePersistedState } from '../../lib/usePersistedState.ts'
import { appKey } from '@/lib/storage.ts'
import { useSettingsDialog } from '@/lib/settingsDialog.ts'
import { canAccessArea, useAccess } from '@/lib/access'

// The Signals section in Settings (archetype List, docs/DESIGN.md 2.3): every signal at
// `#settings/signals` as rows with their latest value, trend and change, under the list bar
// (search, filters, grouping, sort). Each row opens the signal's detail; New signal opens
// `#settings/signals/new`.

/** What feeds a signal, in a word. */
function fedBy(s: Signal): string {
  if (s.formula) return 'Formula'
  if (s.data_source_id) return 'Data source'
  if (s.tracker_key) return 'Tracker'
  return s.source === 'manual' ? 'Manual' : 'Derived'
}

export function SignalsList({ missing }: { missing?: string }) {
  const { open } = useSettingsDialog()
  // Every signal, archived ones included; "Show archived" decides whether they render.
  const { data: every } = useSignalsDataWithArchived()
  const { userId: activeUserId } = useActiveUser()
  const personName = usePersonName()
  useAccess() // re-render when access changes
  // A new signal is stored under `signals` (or its tracker's feature, checked by the server).
  const canCreate = canAccessArea('signals', 'write')
  const [showArchived, setShowArchived] = usePersistedState<boolean>(appKey('signals', 'showArchived'), false, (v) => typeof v === 'boolean')
  const archivedCount = every ? every.signals.filter((s) => s.archived_at).length : 0

  const rows = (every?.signals ?? []).filter((s) => showArchived || !s.archived_at)
  const owners = [...new Set(rows.flatMap((s) => (s.owner ? [s.owner] : [])))]
  const channels = [...new Set(rows.map((s) => baseChannel(s.channel)))].sort()
  const sources = [...new Set(rows.map(fedBy))].sort()

  return (
    <>
      <SettingsIntro info='A signal is a number the team watches over time: typed in, recorded by an agent, or computed from a tracker or a data source. Archived signals are hidden from pickers and this list; their points stay.'>
        The numbers your team tracks, with their latest value and trend.
      </SettingsIntro>
      {canCreate && (
        <SettingsHeaderActions>
          <Button size='sm' onClick={() => open('signals/new')}>
            <Plus /> New signal
          </Button>
        </SettingsHeaderActions>
      )}
      {missing && <SettingsNotice tone='warning' title={`There is no signal "${missing}" you can see.`} />}
      <DataGrid<Signal>
        rows={rows}
        getId={(s) => s.id}
        muted={(s) => s.archived_at != null}
        loading={!every}
        // A Box with no signals AT ALL. Distinct from a filter that happens to match nothing.
        empty={
          <>
            No signals yet.{canCreate ? ' Define one with New signal, or ' : ' '}
            <SignalsLink hash='settings/data-sources' className='font-medium text-accent transition-colors hover:underline'>
              connect a data source
            </SignalsLink>{' '}
            and let a sync fill them in.
          </>
        }
        bar={{
          noun: 'signals',
          fields: [
            { key: 'channel', title: 'Channel', type: 'options', options: channels.map((c) => ({ value: c, label: channelLabel(c) })) },
            { key: 'owner', title: 'Owner', type: 'person', noneLabel: 'No owner', options: owners.map((id) => ({ value: id, label: personName(id) })) },
            { key: 'source', title: 'Fed by', type: 'options', options: sources.map((v) => ({ value: v, label: v })) },
          ],
          sort: [{ value: 'name', label: 'Name' }, { value: 'value', label: 'Value', defaultDir: 'desc' }, { value: 'updated', label: 'Latest', defaultDir: 'desc' }],
          groupBy: [{ value: 'channel', label: 'Channel' }, { value: 'group', label: 'Signal group' }, { value: 'owner', label: 'Owner' }],
        }}
        defaultView={{ sort: 'name', groupBy: 'channel' }}
        storageKey={appKey('signals', 'listView')}
        searchText={(s) => `${s.label} ${s.id} ${s.group} ${channelLabel(s.channel)} ${s.description} ${personName(s.owner)}`}
        filterContext={{ me: activeUserId }}
        filterValue={(s, key) => (key === 'channel' ? baseChannel(s.channel) : key === 'owner' ? s.owner : key === 'source' ? fedBy(s) : null)}
        sortValue={(s, key) => (key === 'value' ? (signalReading(s).latest?.value ?? null) : key === 'updated' ? (signalReading(s).latest?.date ?? null) : s.label.toLowerCase())}
        groupOf={(s, key) =>
          key === 'owner'
            ? { key: s.owner ?? '', label: s.owner ? personName(s.owner) : 'No owner' }
            : key === 'group'
              ? { key: `${baseChannel(s.channel)}/${s.group}`, label: `${channelLabel(baseChannel(s.channel))} · ${s.group || 'No group'}` }
              : { key: baseChannel(s.channel), label: channelLabel(baseChannel(s.channel)) }
        }
        rowLabel={(s) => s.label}
        onOpen={(s) => open(signalsPath(s.id))}
        name={{ label: 'Signal', render: (s) => <NameCell primary={s.label} badge={s.archived_at ? { label: 'Archived' } : null} /> }}
        columns={[
          { key: 'value', label: 'Value', width: 112, render: (s) => <SignalValue signal={s} /> },
          { key: 'trend', label: 'Trend', width: 80, priority: 2, render: (s) => (s.points.length > 1 ? <Sparkline points={sparkWindow(s.points)} height={24} color='var(--chart-1)' /> : null) },
          { key: 'change', label: 'Change', width: 120, priority: 2, render: (s) => <SignalDelta delta={signalReading(s).delta} direction={s.direction} /> },
          { key: 'owner', label: 'Owner', width: 96, priority: 3, render: (s) => (s.owner ? <UserChip userId={s.owner} showName /> : null) },
          { key: 'latest', label: 'Latest', width: 96, priority: 3, render: (s) => <span className='text-label tabular-nums text-muted-foreground'>{signalReading(s).latest ? formatBucket(signalReading(s).latest!.date) : 'no data yet'}</span> },
        ]}
        actions={
          <label className='flex items-center gap-1.5 text-label whitespace-nowrap text-muted-foreground' title='Archived signals are hidden from pickers and this page'>
            <Checkbox checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived{archivedCount > 0 ? ` (${archivedCount})` : ''}
          </label>
        }
      />
    </>
  )
}

function SignalValue({ signal: s }: { signal: Signal }) {
  const { latest } = signalReading(s)
  return (
    <span className='block w-full text-right text-body-sm tabular-nums text-text'>
      {latest ? (
        <>
          {formatNumber(latest.value)}
          {s.unit ? <span className='ml-1 text-label text-muted-foreground'>{s.unit}</span> : null}
        </>
      ) : (
        <span className='text-muted-foreground'>-</span>
      )}
    </span>
  )
}
