import { useMemo, useState } from 'react'
import { BarChart3, Plus } from 'lucide-react'
import type { Signal } from '../../types.ts'
import { baseChannel, channelLabel, inChannel } from '../../types.ts'
import { SignalCard } from '../components/SignalCard.tsx'
import { SignalDialog } from '../components/SignalDialog.tsx'
import { SETTINGS_GUTTER, SegmentedControl, SelectField, Button, Checkbox, UserChip, EmptyState } from '@silkweave/box-ui'
import { useSignalsDataWithArchived } from '../lib/useSignalsData.ts'
import { useActiveUser } from '../../lib/useActiveUser.ts'
import { useUsersData } from '../../lib/useUsersData.ts'
import { usePersistedState } from '../../lib/usePersistedState.ts'
import { useSettingsDialog } from '../../lib/settingsDialog.ts'
import { SignalsLink, signalHash, signalsPath } from '../lib/signalLink.tsx'
import { appKey } from '@/lib/storage.ts'

type GroupBy = 'group' | 'user'
const GROUP_BYS: { value: GroupBy; label: string }[] = [
  { value: 'group', label: 'Group' },
  { value: 'user', label: 'User' },
]

/** The Signals grid in Settings: every channel at `#settings/signals`, or one channel's cards at
 *  `#settings/signals/<channel>`. Cards group into container cards per the "Group by" choice -
 *  signal group under its channel (default), or owner. Each card links to its detail. */
export function SignalsGrid({ channel }: { channel?: string }) {
  // Every signal, archived ones included; "Show archived" decides whether they render.
  const { data: every } = useSignalsDataWithArchived()
  const { open } = useSettingsDialog()
  const { userId: activeUserId, user: activeUser, filterMine } = useActiveUser()
  const { data: users } = useUsersData()
  const [newOpen, setNewOpen] = useState(false)
  const [groupBy, setGroupBy] = usePersistedState<GroupBy>(
    appKey('signals', 'groupBy'),
    'group',
    (v) => GROUP_BYS.some((o) => o.value === v),
  )
  const [showArchived, setShowArchived] = usePersistedState<boolean>(
    appKey('signals', 'showArchived'),
    false,
    (v) => typeof v === 'boolean',
  )
  const mineOnly = filterMine && !!activeUserId
  const archivedCount = every ? every.signals.filter((s) => s.archived_at).length : 0
  const data = useMemo(
    () => (every && !showArchived ? { ...every, signals: every.signals.filter((s) => !s.archived_at) } : every),
    [every, showArchived],
  )

  const visible = useMemo(
    () =>
      data
        ? data.signals.filter(
            // A base-channel param ('github') includes its account variants ('github@dan').
            (s) => (!channel || inChannel(s.channel, channel)) && (!mineOnly || s.owner === activeUserId),
          )
        : [],
    [data, channel, mineOnly, activeUserId],
  )
  if (!data) return null

  // A Box with no signals AT ALL. Distinct from a filter that happens to match nothing, which the
  // count line below already explains.
  if (data.signals.length === 0 && archivedCount === 0)
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
            <Button size='sm' onClick={() => setNewOpen(true)}>
              <Plus /> New signal
            </Button>
          }
        />
        <SignalDialog open={newOpen} onOpenChange={setNewOpen} />
      </div>
    )

  // Sections merge by BASE channel - account variants ('github@dan') fold into one "GitHub"
  // section; the per-card owner chip + swatch tint carry whose signal each one is.
  const channels = [...new Set(data.channels.map(baseChannel))].filter(
    (c) => (!channel || inChannel(c, channel) || c === baseChannel(channel)) && visible.some((s) => inChannel(s.channel, c)),
  )

  const grid = (list: Signal[]) => (
    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
      {list.map((s) => (
        <SignalsLink
          key={s.id}
          hash={signalHash(s)}
          className='rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent/50'>
          <SignalCard signal={s} />
        </SignalsLink>
      ))}
    </div>
  )

  // One choice per BASE channel - account variants ('github@dan') fold into it.
  const channelOptions = [
    { value: '', label: 'All channels' },
    ...[...new Set(data.channels.map(baseChannel))].map((c) => ({
      value: c,
      label: `${channelLabel(c)} (${data.signals.filter((s) => inChannel(s.channel, c)).length})`,
    })),
  ]

  return (
    <div className={`${SETTINGS_GUTTER} pb-6`}>
      <div className='mb-6 flex flex-wrap items-center justify-between gap-3'>
        <SelectField
          aria-label='Channel'
          value={channel ? baseChannel(channel) : ''}
          options={channelOptions}
          onValueChange={(c) => open(signalsPath(c || undefined))}
        />
        <p className='text-body-sm text-muted-foreground'>
          {mineOnly && activeUser ? (
            <>
              Showing only <span className='text-accent'>{activeUser.nickname || activeUser.id}</span>
              {"'"}s signals ({visible.length}/
              {data.signals.filter((s) => !channel || inChannel(s.channel, channel)).length}) - toggle
              "Only my items" in the user menu to see everything.
            </>
          ) : (
            <>
              {visible.length} signal {channel ? `on ${channelLabel(baseChannel(channel))}` : 'across all channels'}.
            </>
          )}
        </p>
        <div className='flex items-center gap-2'>
          {(
            <Button size='sm' variant='outline' onClick={() => setNewOpen(true)}>
              <Plus /> New signal
            </Button>
          )}
          {/* Archived signals are hidden from pickers and this page; their points and readers stay. */}
          <label className='flex items-center gap-1.5 text-label text-muted-foreground' title='Archived signals are hidden from pickers and this page'>
            <Checkbox checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived{archivedCount > 0 ? ` (${archivedCount})` : ''}
          </label>
          <SegmentedControl label='Group by' value={groupBy} options={GROUP_BYS} onChange={setGroupBy} />
        </div>
      </div>

      {/* Definitions are configuration - the dialog is admin-gated above. */}
      <SignalDialog open={newOpen} onOpenChange={setNewOpen} />

      {groupBy === 'group'
        ? // Channel sections, each signal group as a container card ("npm" → "Downloads").
          channels.map((c) => {
            const groups = groupBy_(visible.filter((s) => inChannel(s.channel, c)), (s) => s.group)
            return (
              <section key={c} className='mb-10'>
                <h2 className='mb-4 flex items-center gap-2 text-heading-2 font-semibold text-text'>
                  {channelLabel(c)}
                </h2>
                <div className='flex flex-col gap-4'>
                  {[...groups.entries()].map(([group, list]) => (
                    <div key={group} className='rounded-xl border border-border p-3 sm:p-4'>
                      <div className='mb-3 flex items-center gap-2'>
                        <h3 className='text-body-sm font-semibold text-text'>{group}</h3>
                        <span className='text-label text-muted-foreground tabular-nums'>{list.length}</span>
                      </div>
                      {grid(list)}
                    </div>
                  ))}
                </div>
              </section>
            )
          })
        : // Owner containers, channel-labelled grids inside.
          [...new Set(visible.map((s) => s.owner ?? ''))]
            .sort((a, b) => {
              const name = (id: string) => users?.find((u) => u.id === id)?.nickname ?? id
              return a === '' ? 1 : b === '' ? -1 : name(a).localeCompare(name(b))
            })
            .map((owner) => {
              const own = visible.filter((s) => (s.owner ?? '') === owner)
              const byChannel = channels
                .map((c) => ({ channel: c, list: own.filter((s) => inChannel(s.channel, c)) }))
                .filter((g) => g.list.length > 0)
              return (
                <section key={owner || 'unowned'} className='mb-5 rounded-xl border border-border p-3 sm:p-4'>
                  <div className='mb-3 flex items-center gap-2'>
                    {owner ? (
                      <UserChip userId={owner} showName />
                    ) : (
                      <h3 className='text-body-sm font-medium text-muted-foreground'>Unassigned</h3>
                    )}
                    <span className='text-label text-muted-foreground tabular-nums'>{own.length}</span>
                  </div>
                  <div className='flex flex-col gap-4'>
                    {byChannel.map(({ channel: c, list }) => (
                      <div key={c}>
                        <h4 className='mb-2 text-label uppercase tracking-[0.07em] text-muted-foreground'>
                          {channelLabel(c)}
                        </h4>
                        {grid(list)}
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}

      <footer className='border-t border-border pt-5 text-label text-muted-foreground'>
        Live from the DuckDB warehouse · trends fill in as daily snapshots accrue.
      </footer>
    </div>
  )
}

function groupBy_<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const item of arr) {
    const k = key(item)
    const cur = m.get(k)
    if (cur) cur.push(item)
    else m.set(k, [item])
  }
  return m
}
