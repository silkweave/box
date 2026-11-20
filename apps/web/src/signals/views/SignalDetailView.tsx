import { useState } from 'react'
import { Archive, ArchiveRestore, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import { canAccessArea, useAccess } from '@/lib/access'
import type { Signal, SignalDataSource, SignalsData } from '../../types.ts'
import { channelLabel } from '../../types.ts'
import { setSignalArchivedState, setSignalOwner } from '../lib/useSignalsData.ts'
import { useAuth } from '../../lib/useAuth.tsx'
import { SignalsLink, signalHash, signalsPath } from '../lib/signalLink.tsx'
import { useSettingsDialog } from '../../lib/settingsDialog.ts'
import { signalLabel, signalMap } from '../lib/signalLabel.ts'
import { SignalChart } from '../components/SignalChart.tsx'
import { SignalUsage } from '../components/SignalUsage.tsx'
import { SignalPointsEditor } from '../components/SignalPointsEditor.tsx'
import { SignalDelta } from '../components/SignalDelta.tsx'
import {
  Badge,
  RelativeTime,
  SettingsDetailHeader,
  SettingsEmpty,
  SettingsFact,
  SettingsFacts,
  SettingsGroup,
  SettingsNotice,
  SettingsPage,
  UserPicker,
  type ActionMenuItem,
} from '@silkweave/box-ui'
import { DataGrid } from '@silkweave/box-ui/list'
import { errorMessage } from '@silkweave/box-ui/lib'
import { computeDelta, formatBucket, formatNumber } from '../../lib/format.ts'

/**
 * A single signal's page at `#settings/signals/<id>` (archetype Detail,
 * docs/DESIGN.md 2.3): the header with its identity, the definition as facts, the readings, the
 * history chart with the recent snapshots, and the hand-entered points. A data-less signal
 * (registered, no points yet) shows its definition with an honest empty state.
 *
 * Who may change what: a definition (Edit) is every writer's, like `signal-upsert`; archiving and
 * the owner are administrators' (`signal-archive`, `signal-owner-set`). Nothing here is a draft:
 * the owner picker saves on change and says so.
 */
export function SignalDetailView({ signal, data }: { signal: Signal; data: SignalsData }) {
  const { open } = useSettingsDialog()
  const { principal } = useAuth()
  const isAdmin = principal?.role === 'admin'
  useAccess() // re-render when access changes
  const [archiving, setArchiving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [ownerSaved, setOwnerSaved] = useState(false)

  const points = signal.points
  const latest = points.length > 0 ? points[points.length - 1] : null
  const delta = computeDelta(points)
  const values = points.map((p) => p.value)
  const isIncrement = signal.accumulation === 'increment'
  // Sub-daily charts serve a trailing window (SUBDAILY_WINDOW_DAYS server-side), so peak/low over
  // `points` are window stats there - the label must not claim "all-time" it cannot back.
  const windowed = signal.interval === 'hour'

  // Peak/low carry the bucket they happened in: "12,492 on Jul 18" answers the question the bare number provokes.
  const peak = points.length > 0 ? points.reduce((a, b) => (b.value > a.value ? b : a)) : null
  const low = points.length > 0 ? points.reduce((a, b) => (b.value < a.value ? b : a)) : null

  // The three standing questions (plus last-7d), from the server's full-store aggregates - NOT
  // from `points`, which may be windowed. Null renders an honest dash, never a fabricated 0.
  const aggTitle = isIncrement ? 'Sum of the buckets in the window' : 'The latest value in the window'
  const periods: { label: string; value: number | null; title: string }[] = [
    { label: 'All time', value: signal.aggregates.all_time, title: isIncrement ? 'Sum of every bucket ever' : 'The latest value' },
    { label: 'Yesterday', value: signal.aggregates.yesterday, title: `${aggTitle} - the last complete UTC day` },
    { label: 'Month to date', value: signal.aggregates.month_to_date, title: `${aggTitle} - from the 1st of the current UTC month, today included` },
    { label: 'Last 7 days', value: signal.aggregates.last_7d, title: `${aggTitle} - the 7 complete UTC days before today` },
  ]

  const recent = [...points].reverse().slice(0, 14)
  const byId = signalMap(data)
  const toList = () => open(signalsPath())

  // Archiving is configuration (admin-only server-side, like renaming and deleting): it hides the
  // signal from pickers and the Signals grid; points, goals and milestones that read it are unaffected.
  const toggleArchived = (): void => {
    setArchiving(true)
    setFailure(null)
    setSignalArchivedState(signal.id, !signal.archived_at)
      .catch((err: unknown) => setFailure(errorMessage(err)))
      .finally(() => setArchiving(false))
  }
  const saveOwner = (id: string | null): void => {
    setFailure(null)
    setSignalOwner(signal.id, id)
      .then(() => {
        setOwnerSaved(true)
        setTimeout(() => setOwnerSaved(false), 1500)
      })
      .catch((err: unknown) => setFailure(errorMessage(err)))
  }

  const actions: ActionMenuItem[] = [
    ...(canAccessArea(signal.area, 'write') ? [{ label: 'Edit signal', icon: <Pencil />, onSelect: () => open(`${signalsPath(signal.id)}/edit`) }] : []),
    ...(isAdmin
      ? [{ label: signal.archived_at ? 'Unarchive' : 'Archive', icon: signal.archived_at ? <ArchiveRestore /> : <Archive />, disabled: archiving, onSelect: toggleArchived }]
      : []),
  ]

  return (
    <SettingsPage
      title={signal.label}
      info='A signal is a number the team watches over time. Anyone who can write may edit its definition; administrators archive it and set its owner.'
      onRoot={toList}
      onClose={toList}>
      <SettingsDetailHeader
        title={signal.label}
        badges={signal.archived_at ? <Badge variant='neutral'>Archived</Badge> : undefined}
        meta={
          <span>
            <code>{signal.id}</code>{signal.group ? <> &middot; {signal.group}</> : null}
          </span>
        }
        actions={actions.length > 0 ? actions : undefined}>
        {signal.archived_at && (
          <p className='text-label text-muted-foreground'>
            Archived <RelativeTime value={signal.archived_at} />: hidden from pickers and the Signals page, still read by whatever references it.
          </p>
        )}
      </SettingsDetailHeader>
      {failure && <SettingsNotice tone='danger' title='That change was not saved'>{failure}</SettingsNotice>}

      <SettingsGroup title='Definition' description={signal.description || undefined}>
        <SettingsFacts columns={3}>
          <SettingsFact label='Channel'>{channelLabel(signal.channel)}</SettingsFact>
          <SettingsFact label='Interval'>{INTERVAL[signal.interval] ?? signal.interval}</SettingsFact>
          <SettingsFact label='Direction'>{signal.direction === 'up' ? 'Up is good' : 'Down is good'}</SettingsFact>
          <SettingsFact label='Source'>{signal.source}</SettingsFact>
          {signal.unit && <SettingsFact label='Unit'>{signal.unit}</SettingsFact>}
          <SettingsFact label='Accumulation'>
            <span title='Snapshot: the whole value at that time. Increment: occurrences per bucket.'>{signal.accumulation}</span>
          </SettingsFact>
          <SettingsFact label='Owner'>
            <span className='inline-flex items-center gap-2'>
              {/* Writes the definition and a per-signal override in the signal-owner settings (clear =
                  explicitly unowned). Administrators only; everyone else sees the chip. */}
              <UserPicker value={signal.owner} readOnly={!isAdmin} onChange={saveOwner} emptyLabel='No owner' showEmptyLabel />
              {ownerSaved && <span className='text-label text-success'>Saved</span>}
            </span>
          </SettingsFact>
          {signal.formula && (
            <SettingsFact label='Formula' span='full'>
              <code title='Points are computed from other signals; a manual point overrides its bucket'>= {signal.formula}</code>
            </SettingsFact>
          )}
          {signal.data_source_id && (
            <SettingsFact label='Connection' span='full'>
              <ConnectionLine signal={signal} sources={data.sources} />
            </SettingsFact>
          )}
          {signal.depends_on.length > 0 && (
            <SettingsFact label='Driven by' span='full'>
              {signal.depends_on.map((id, i) => (
                <span key={id}>
                  {i > 0 && ' · '}
                  <DependencyLink byId={byId} id={id} />
                </span>
              ))}
            </SettingsFact>
          )}
          <SignalUsage signalId={signal.id} className='col-span-full' />
        </SettingsFacts>
      </SettingsGroup>

      {latest ? (
        <>
          <SettingsGroup title='Latest'>
            <SettingsFacts columns={2}>
              <SettingsFact
                label={
                  // An increment signal's last bucket is still filling - say so instead of "Current".
                  isIncrement ? (signal.interval === 'day' ? 'Today so far' : 'Current bucket') : 'Current'
                }>
                <Reading value={formatNumber(latest.value)} unit={signal.unit} sub={formatBucket(latest.date)} />
              </SettingsFact>
              <SettingsFact label='Latest change'>
                {delta ? (
                  <Reading value={`${delta.abs > 0 ? '+' : ''}${formatNumber(delta.abs)}`} unit={signal.unit} sub={<SignalDelta variant='chip' delta={delta} direction={signal.direction} />} />
                ) : (
                  <Reading value='baseline' muted sub='first point, nothing to compare' />
                )}
              </SettingsFact>
              <SettingsFact label={windowed ? '90d peak' : 'All-time peak'}>
                <Reading value={formatNumber(Math.max(...values))} unit={signal.unit} sub={peak ? formatBucket(peak.date) : null} />
              </SettingsFact>
              <SettingsFact label={windowed ? '90d low' : 'All-time low'}>
                <Reading value={formatNumber(Math.min(...values))} unit={signal.unit} sub={low ? formatBucket(low.date) : null} />
              </SettingsFact>
            </SettingsFacts>
          </SettingsGroup>

          <SettingsGroup title='Over time'>
            <SettingsFacts columns={2}>
              {periods.map((p) => (
                <SettingsFact key={p.label} label={p.label}>
                  <span title={p.title}>
                    <Reading value={p.value == null ? null : formatNumber(p.value)} unit={signal.unit} />
                  </span>
                </SettingsFact>
              ))}
            </SettingsFacts>
          </SettingsGroup>

          <SettingsGroup title='History'>
            <SignalChart signal={signal} />
          </SettingsGroup>

          {/* A bounded excerpt: the latest 14 buckets, so no search or filter. The full history is the
              chart above, and the manual points below keep their own search and date filter. */}
          <DataGrid<{ date: string; value: number; diff: number | null }>
            variant='section'
            title={`Last ${recent.length} snapshots`}
            rows={recent.map((p, i) => ({ date: p.date, value: p.value, diff: recent[i + 1] ? p.value - recent[i + 1]!.value : null }))}
            getId={(p) => p.date}
            bar={{ noun: 'snapshots' }}
            rowLabel={(p) => formatBucket(p.date)}
            name={{ label: 'Date', render: (p) => <span className='text-body-sm tabular-nums text-muted-foreground'>{formatBucket(p.date)}</span> }}
            columns={[
              { key: 'value', label: 'Value', width: 112, render: (p) => <span className='block w-full text-right text-body-sm tabular-nums text-text'>{formatNumber(p.value)}</span> },
              {
                key: 'change',
                label: 'Change',
                width: 112,
                render: (p) =>
                  p.diff == null ? (
                    <span className='block w-full text-right text-muted-foreground'>-</span>
                  ) : (
                    <SignalDelta variant='plain' delta={{ abs: p.diff, pct: null, dir: p.diff > 0 ? 'up' : p.diff < 0 ? 'down' : 'flat' }} direction={signal.direction} />
                  ),
              },
            ]}
          />
        </>
      ) : (
        <SettingsGroup title='Readings'>
          <SettingsEmpty>
            No data points yet. The signal exists and can already be bound to initiatives and targets;
            {signal.formula
              ? ' its points are computed from the formula once its inputs have data.'
              : signal.data_source_id
                ? ' points appear on its data source’s next sync. Run one from Data sources if it has never synced.'
                : signal.source === 'derived'
                  ? ' points appear when its channel derives.'
                  : signal.accumulation === 'increment'
                    ? ' occurrences count in via the signal-event tool, and buckets can be gap-filled by hand.'
                    : ' enter points by hand until a live source exists.'}
          </SettingsEmpty>
        </SettingsGroup>
      )}

      {/* Manual entry is the bridge until a live source exists, and gap-fill for derived signals.
          Always present: a shadowed manual point renders as such rather than being hidden. */}
      <SignalPointsEditor signal={signal} />

    </SettingsPage>
  )
}

const INTERVAL: Record<string, string> = { hour: 'Hourly', day: 'Daily', week: 'Weekly', month: 'Monthly' }

/**
 * The connection line for a signal bound to a data source: which source, which tracker, and when it
 * last landed. Three honest states beyond "fine": the source was DELETED out from under the binding
 * (dangling - the points stay, they just stop refreshing), the last sync FAILED, or it has gone
 * STALE (read-side only, ~2x the daily cadence every source runs on - no stored staleness).
 */
function ConnectionLine({ signal, sources }: { signal: Signal; sources: SignalDataSource[] }) {
  const source = sources.find((s) => s.id === signal.data_source_id)
  const failed = source?.last_sync_status === 'error'
  const stale =
    source?.status === 'enabled' &&
    !!source.last_sync_at &&
    Date.now() - new Date(source.last_sync_at).getTime() > 2 * 24 * 60 * 60 * 1000
  const tone = !source || failed ? 'text-danger' : stale ? 'text-warning' : 'text-muted-foreground'

  return (
    <span className={cn('text-body-sm', tone)}>
      {!source ? (
        <>
          <code>{signal.data_source_id}</code> no longer exists. The points are real history that has stopped refreshing; re-point or clear the connection from Edit signal.
        </>
      ) : (
        <>
          {source.label} · <span title={`provider tracker key: ${signal.tracker_key}`}>{signal.tracker_key}</span> ·{' '}
          {source.last_sync_at ? (
            <>
              {failed ? 'last sync failed ' : 'synced '}
              <RelativeTime value={source.last_sync_at} />
            </>
          ) : (
            'never synced'
          )}
          {stale && !failed && ', stale'}
          {source.status === 'disabled' && ' · source disabled (syncs only on demand)'}
        </>
      )}
    </span>
  )
}

/** A reading: the value in the display face, its unit beside it (a separate element, never glued
 *  into the value, so a long number truncates instead of overflowing), and a line under it. */
function Reading({ value, unit, sub, muted }: { value: string | null; unit?: string | null; sub?: React.ReactNode; muted?: boolean }) {
  return (
    <span className='flex flex-col gap-1'>
      <span className='flex items-baseline gap-1'>
        {value == null ? (
          <span className='font-serif text-display-sm leading-none text-muted-foreground' title='No data in this window'>
            -
          </span>
        ) : (
          <>
            <span title={value} className={cn('min-w-0 truncate font-serif text-display-sm tabular-nums leading-none', muted ? 'text-muted-foreground' : 'text-text')}>
              {value}
            </span>
            {unit && <span className='shrink-0 text-label text-muted-foreground'>{unit}</span>}
          </>
        )}
      </span>
      {sub != null && <span className='truncate text-label tabular-nums text-muted-foreground'>{sub}</span>}
    </span>
  )
}

/** A depends_on entry: friendly label (raw id in the tooltip), linked when the signal resolves. */
function DependencyLink({ byId, id }: { byId: ReturnType<typeof signalMap>; id: string }) {
  const dep = byId.get(id)
  if (!dep) return <code title='no live signal with this id'>{id}</code>
  return (
    <SignalsLink hash={signalHash(dep)} className='text-accent hover:underline'>
      <span title={id}>{signalLabel(byId, id)}</span>
    </SignalsLink>
  )
}
