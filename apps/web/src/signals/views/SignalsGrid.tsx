import { useMemo, useState } from 'react'
import { BarChart3, LayoutGrid, List, Plus } from 'lucide-react'
import type { Signal } from '../../types.ts'
import { baseChannel, channelLabel, inChannel } from '../../types.ts'
import { ArchivedBadge, SignalCard, signalReading, sparkWindow } from '../components/SignalCard.tsx'
import { SignalDialog } from '../components/SignalDialog.tsx'
import { SETTINGS_GUTTER, Button, Checkbox, UserChip, EmptyState } from '@silkweave/box-ui'
import { Sparkline } from '@silkweave/box-ui/charts'
import type { BoardBarValue } from '@silkweave/box-ui/board'
import type { Filters } from '@silkweave/box-ui/filters'
import { DataGrid, type DataGridColumn } from '@silkweave/box-ui/datagrid'
import { useSignalsDataWithArchived } from '../lib/useSignalsData.ts'
import { formatBucket, formatDelta, formatNumber } from '../../lib/format.ts'
import { useActiveUser } from '../../lib/useActiveUser.ts'
import { useUsersData } from '../../lib/useUsersData.ts'
import { usePersistedState } from '../../lib/usePersistedState.ts'
import { SignalsLink, signalHash } from '../lib/signalLink.tsx'
import { appKey } from '@/lib/storage.ts'
import { cn } from '@/lib/utils'
import { canAccessArea, useAccess } from '@/lib/access'

// The Signals section in Settings: every signal at `#settings/signals`, or one channel's at
// `#settings/signals/<channel>`, as a list on the house DataGrid (search, sort, filters, grouping,
// columns) with the cards as a second layout. Each row links to the signal's detail.

type ColumnKey = 'value' | 'trend' | 'change' | 'updated' | 'owner' | 'channel' | 'source' | 'interval'

const COLUMNS: { key: ColumnKey; label: string; width: number; hint?: string }[] = [
  { key: 'value', label: 'Value', width: 120, hint: 'The last complete bucket (an increment signal’s newest bucket is still filling).' },
  { key: 'trend', label: 'Trend', width: 130, hint: 'The last 30 days.' },
  { key: 'change', label: 'Change', width: 110, hint: 'Against the bucket before.' },
  { key: 'updated', label: 'Latest', width: 110, hint: 'The bucket the value is from.' },
  { key: 'owner', label: 'Owner', width: 130 },
  { key: 'channel', label: 'Channel', width: 120 },
  { key: 'source', label: 'Fed by', width: 120, hint: 'Manual: typed or recorded. Data source, tracker or formula: computed.' },
  { key: 'interval', label: 'Interval', width: 90 },
]
const COLUMN_KEYS = COLUMNS.map((c) => c.key as string)
const DEFAULT_COLUMNS: ColumnKey[] = ['value', 'trend', 'change', 'updated', 'owner']

/** What this browser keeps of the view: layout, grouping, sort and columns. Search and filters last while the section is open. */
interface KeptView {
  layout: string
  groupBy: string
  sort: string
  sortDir: 'asc' | 'desc'
  columns: string[]
}
const KEPT: KeptView = { layout: 'list', groupBy: 'channel', sort: 'name', sortDir: 'asc', columns: DEFAULT_COLUMNS }
const isKept = (v: unknown): v is KeptView => {
  const o = v as KeptView | null
  return (
    !!o &&
    typeof o.layout === 'string' &&
    typeof o.groupBy === 'string' &&
    typeof o.sort === 'string' &&
    (o.sortDir === 'asc' || o.sortDir === 'desc') &&
    Array.isArray(o.columns) &&
    o.columns.every((x) => typeof x === 'string')
  )
}

/** What feeds a signal, in a word. */
function fedBy(s: Signal): string {
  if (s.formula) return 'Formula'
  if (s.data_source_id) return 'Data source'
  if (s.tracker_key) return 'Tracker'
  return s.source === 'manual' ? 'Manual' : 'Derived'
}

export function SignalsGrid({ channel }: { channel?: string }) {
  // Every signal, archived ones included; "Show archived" decides whether they render.
  const { data: every } = useSignalsDataWithArchived()
  const { userId: activeUserId, user: activeUser, filterMine } = useActiveUser()
  const { data: users } = useUsersData()
  const [newOpen, setNewOpen] = useState(false)
  useAccess() // re-render when access changes
  // A new signal is stored under `signals` (or its tracker's feature, checked by the server).
  const canCreate = canAccessArea('signals', 'write')
  const [kept, setKept] = usePersistedState<KeptView>(appKey('signals', 'view'), KEPT, isKept)
  const [local, setLocal] = useState<{ search: string; filters: Filters }>({ search: '', filters: {} })
  const [showArchived, setShowArchived] = usePersistedState<boolean>(appKey('signals', 'showArchived'), false, (v) => typeof v === 'boolean')
  const mineOnly = filterMine && !!activeUserId
  const archivedCount = every ? every.signals.filter((s) => s.archived_at).length : 0

  const rows = useMemo(
    () =>
      (every?.signals ?? []).filter(
        // A base-channel param ('github') includes its account variants ('github@dan').
        (s) => (showArchived || !s.archived_at) && (!channel || inChannel(s.channel, channel)) && (!mineOnly || s.owner === activeUserId),
      ),
    [every, showArchived, channel, mineOnly, activeUserId],
  )
  if (!every) return null

  // A Box with no signals AT ALL. Distinct from a filter that happens to match nothing.
  if (every.signals.length === 0)
    return (
      <div className={`${SETTINGS_GUTTER} pb-6`}>
        <EmptyState
          icon={<BarChart3 className='size-6' />}
          title='No signals yet'
          description={
            <>
              A signal is one number you watch over time - downloads a week, stars, signups, revenue
              booked. Define one by hand, or{' '}
              <SignalsLink hash='settings/data-sources' className='font-medium text-accent transition-colors hover:underline'>
                connect a data source
              </SignalsLink>{' '}
              and let a sync fill one in.
            </>
          }
          action={
            canCreate ? (
              <Button size='sm' onClick={() => setNewOpen(true)}>
                <Plus /> New signal
              </Button>
            ) : undefined
          }
        />
        <SignalDialog open={newOpen} onOpenChange={setNewOpen} />
      </div>
    )

  const userLabel = (id: string): string => users?.find((u) => u.id === id)?.nickname ?? id
  const owners = [...new Set(rows.flatMap((s) => (s.owner ? [s.owner] : [])))]
  const channels = [...new Set(rows.map((s) => baseChannel(s.channel)))].sort()
  const sources = [...new Set(rows.map(fedBy))].sort()

  const view: BoardBarValue = { ...local, ...kept, columns: kept.columns.filter((k) => COLUMN_KEYS.includes(k)) }
  const onViewChange = (patch: Partial<BoardBarValue>): void => {
    const { search, filters, layout, groupBy, sort, sortDir, columns } = patch
    if (search !== undefined || filters !== undefined) setLocal((cur) => ({ search: search ?? cur.search, filters: filters ?? cur.filters }))
    if (layout !== undefined || groupBy !== undefined || sort !== undefined || sortDir !== undefined || columns !== undefined)
      setKept((cur) => ({
        layout: layout ?? cur.layout,
        groupBy: groupBy ?? cur.groupBy,
        sort: sort ?? cur.sort,
        sortDir: sortDir ?? cur.sortDir,
        columns: columns ? [...columns] : cur.columns,
      }))
  }

  const columns: DataGridColumn<Signal>[] = COLUMNS.map((c) => ({ ...c, render: (s) => <SignalCell column={c.key} signal={s} /> }))

  const scope = mineOnly && activeUser ? `${activeUser.nickname || activeUser.id}'s signals` : channel ? channelLabel(baseChannel(channel)) : null

  return (
    <div className={`${SETTINGS_GUTTER} pb-6`}>
      <SignalDialog open={newOpen} onOpenChange={setNewOpen} />
      <DataGrid<Signal>
        variant='section'
        rows={rows}
        getId={(s) => s.id}
        rowLabel={(s) => s.label}
        name={{
          label: 'Signal',
          min: 220,
          render: (s) => (
            <SignalsLink hash={signalHash(s)} className='flex min-w-0 items-center gap-2 rounded px-1 outline-none hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/50'>
              <span className='min-w-0 truncate text-text' title={s.label}>
                {s.label}
              </span>
              {s.archived_at && <ArchivedBadge className='shrink-0' />}
            </SignalsLink>
          ),
        }}
        columns={columns}
        view={view}
        onViewChange={onViewChange}
        bar={{
          noun: 'signals',
          searchPlaceholder: 'Search signals...',
          layouts: [
            { value: 'list', label: 'List', icon: List },
            { value: 'cards', label: 'Cards', icon: LayoutGrid, groups: true },
          ],
          groupBy: [
            { value: 'channel', label: 'Channel' },
            { value: 'group', label: 'Signal group' },
            { value: 'owner', label: 'Owner' },
            { value: 'none', label: 'None' },
          ],
          sort: [
            { value: 'name', label: 'Name' },
            { value: 'value', label: 'Value', defaultDir: 'desc' },
            { value: 'updated', label: 'Latest', defaultDir: 'desc' },
          ],
          fields: [
            { key: 'channel', title: 'Channel', type: 'options', options: channels.map((c) => ({ value: c, label: channelLabel(c) })) },
            { key: 'owner', title: 'Owner', type: 'person', noneLabel: 'No owner', options: owners.map((id) => ({ value: id, label: userLabel(id) })) },
            { key: 'source', title: 'Fed by', type: 'options', options: sources.map((v) => ({ value: v, label: v })) },
          ],
          notice: scope ? <span>Showing {scope}</span> : undefined,
        }}
        searchText={(s) => `${s.label} ${s.id} ${s.group} ${channelLabel(s.channel)} ${s.description}`}
        filterValue={(s, axis) => (axis === 'channel' ? baseChannel(s.channel) : axis === 'owner' ? s.owner : axis === 'source' ? fedBy(s) : null)}
        filterContext={{ me: activeUserId }}
        sortValue={(s, key) => {
          const { latest } = signalReading(s)
          return key === 'name' ? s.label.toLowerCase() : key === 'value' ? (latest?.value ?? null) : key === 'updated' ? (latest?.date ?? null) : null
        }}
        groupOf={(s, by) => {
          if (by === 'owner') return { key: s.owner ?? '', label: s.owner ? <UserChip userId={s.owner} showName /> : 'No owner' }
          const c = baseChannel(s.channel)
          if (by === 'group') return { key: `${c}/${s.group}`, label: `${channelLabel(c)} · ${s.group}` }
          return { key: c, label: channelLabel(c) }
        }}
        renderCard={(s) => (
          <SignalsLink hash={signalHash(s)} className='-m-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent/50'>
            <SignalCard signal={s} />
          </SignalsLink>
        )}
        actions={
          <div className='flex items-center gap-2'>
            {/* Archived signals are hidden from pickers and this page; their points and readers stay. */}
            <label className='flex items-center gap-1.5 text-label whitespace-nowrap text-muted-foreground' title='Archived signals are hidden from pickers and this page'>
              <Checkbox checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              Show archived{archivedCount > 0 ? ` (${archivedCount})` : ''}
            </label>
            {canCreate && (
              <Button size='sm' onClick={() => setNewOpen(true)}>
                <Plus /> New signal
              </Button>
            )}
          </div>
        }
        empty='No signal matches.'
        storageKey={appKey('signals', 'list')}
        countLabel={(shown, total) => (shown === total ? `${total} signals` : `${shown} / ${total} signals`)}
      />
    </div>
  )
}

/** One read-only cell of a signal row. */
function SignalCell({ column, signal: s }: { column: ColumnKey; signal: Signal }) {
  const { latest, delta } = signalReading(s)
  switch (column) {
    case 'value':
      return latest ? (
        <span className='block px-2 tabular-nums text-text'>
          {formatNumber(latest.value)}
          {s.unit ? <span className='ml-1 text-label text-muted-foreground'>{s.unit}</span> : null}
        </span>
      ) : (
        <span className='block px-2 text-muted-foreground'>-</span>
      )
    case 'trend':
      return s.points.length > 1 ? <Sparkline points={sparkWindow(s.points)} height={24} color='var(--chart-1)' /> : null
    case 'change':
      return delta ? (
        <span
          className={cn(
            'block px-2 text-label tabular-nums whitespace-nowrap',
            delta.dir === 'up' && 'text-success',
            delta.dir === 'down' && 'text-danger',
            delta.dir === 'flat' && 'text-muted-foreground',
          )}>
          {delta.dir === 'up' ? '▲' : delta.dir === 'down' ? '▼' : '–'} {formatDelta(delta)}
        </span>
      ) : null
    case 'updated':
      return <span className='block px-2 text-label tabular-nums text-muted-foreground'>{latest ? formatBucket(latest.date) : 'no data yet'}</span>
    case 'owner':
      return s.owner ? <UserChip userId={s.owner} showName /> : null
    case 'channel':
      return <span className='block truncate px-2 text-label text-muted-foreground'>{channelLabel(s.channel)}</span>
    case 'source':
      return <span className='block truncate px-2 text-label text-muted-foreground'>{fedBy(s)}</span>
    case 'interval':
      return <span className='block px-2 text-label text-muted-foreground'>{s.interval}</span>
  }
}
