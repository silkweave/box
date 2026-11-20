import { useEffect, useState } from 'react'
import {
  SettingsIntro,
  SettingsNotice,
  SettingsReadOnly,
  SettingsTabs,
  UserChip,
  UserPicker,
  usePersonName,
} from '@silkweave/box-ui'
import { DataGrid, NameCell } from '@silkweave/box-ui/list'
import { errorMessage } from '@silkweave/box-ui/lib'
import { trpc } from '../../lib/trpc.ts'
import { useAuth } from '../../lib/useAuth.tsx'
import { reloadSignals, useSignalsData } from '../lib/useSignalsData.ts'
import { signalLabel, signalMap } from '../lib/signalLabel.ts'
import { signalsPath } from '../lib/signalLink.tsx'
import { useSettingsDialog } from '../../lib/settingsDialog.ts'

interface OwnersFile {
  channels: Record<string, string>
  signals: Record<string, string | null>
}

interface ChannelRow {
  channel: string
  count: number
  owner: string | null
}

const OWNER_OPTIONS = [
  { value: 'owned', label: 'Has an owner' },
  { value: 'unowned', label: 'No owner' },
]

const SECTION = 'signal-owners'
const TABS = [
  { value: 'channels', label: 'Channel defaults' },
  { value: 'overrides', label: 'Signal overrides' },
] as const
type Tab = (typeof TABS)[number]['value']

/**
 * Settings → Signal owners, a tabbed section routed `signal-owners/<tab>` (docs/DESIGN.md 2.3):
 * Channel defaults (a channel's owner covers every signal in it, e.g. github → every github.*
 * signal) and Signal overrides (the signals with an owner of their own, which wins; a row opens the
 * signal, where it is edited). Neither tab has a form or a footer: the picker saves on change.
 */
export function SignalOwnersView({ params }: { params: string[] }) {
  const { open } = useSettingsDialog()
  const { data: signals } = useSignalsData()
  const [owners, setOwners] = useState<OwnersFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tab: Tab = params[0] === 'overrides' ? 'overrides' : 'channels'
  useEffect(() => {
    trpc.signalsOwners
      .query({})
      .then((d) => setOwners(d as unknown as OwnersFile))
      .catch((e) => setError(errorMessage(e)))
  }, [])
  return (
    <SettingsTabs label='Signal owners sections' value={tab} items={[...TABS]} onChange={(t) => open(`${SECTION}/${t}`)}>
      {tab === 'channels'
        ? <ChannelDefaultsTab signals={signals} owners={owners} error={error} onOwners={setOwners} />
        : <OverridesTab signals={signals} owners={owners} error={error} />}
    </SettingsTabs>
  )
}

type Signals = ReturnType<typeof useSignalsData>['data']
interface TabProps { signals: Signals; owners: OwnersFile | null; error: string | null }

/** Channel defaults tab (List): one owner per channel, saved on change. */
function ChannelDefaultsTab({ signals, owners, error, onOwners }: TabProps & { onOwners: (next: OwnersFile) => void }) {
  const { principal } = useAuth()
  const admin = principal?.role === 'admin'
  const personName = usePersonName()
  const [failure, setFailure] = useState<string | null>(null)
  // The channel whose owner was just saved: the picker saves on change, so it says so beside itself.
  const [saved, setSaved] = useState<string | null>(null)

  // Every channel that has signal in the warehouse, plus any channel already mapped in the file.
  const channels = [...new Set([...(signals?.channels ?? []), ...Object.keys(owners?.channels ?? {})])].sort()
  const rows: ChannelRow[] = channels.map((channel) => ({
    channel,
    count: (signals?.signals ?? []).filter((s) => s.channel === channel).length,
    owner: owners?.channels[channel] ?? null,
  }))

  const save = async (channel: string, owner: string | null) => {
    setFailure(null)
    try {
      const next = await trpc.signalsOwnersSave.mutate(
        owner === null ? { scope: 'channel', key: channel } : { scope: 'channel', key: channel, owner },
      )
      onOwners(next as unknown as OwnersFile)
      void reloadSignals()
      setSaved(channel)
      setTimeout(() => setSaved((cur) => (cur === channel ? null : cur)), 1500)
    } catch (e) {
      setFailure(errorMessage(e))
    }
  }

  return (
    <>
      <SettingsIntro info={<>A channel&apos;s owner covers all of its signals; clearing it leaves the channel unowned. Set an owner for a single signal on its page.</>}>
        Who looks after each channel&apos;s signals.
      </SettingsIntro>
      {/* Readers keep search, filters and sort (the grid is a reader control); the picker is read-only for them. */}
      <SettingsReadOnly active={!admin} note='Only administrators can change signal owners.'>
        <DataGrid<ChannelRow>
          rows={rows}
          getId={(r) => r.channel}
          loading={!owners && error === null}
          error={error ?? undefined}
          empty='No channels yet. Owners appear here once signals exist.'
          bar={{
            noun: 'channels',
            fields: [{ key: 'owner', title: 'Owner', type: 'options', options: OWNER_OPTIONS.filter((o) => rows.some((r) => (r.owner ? 'owned' : 'unowned') === o.value)) }],
            sort: [{ value: 'name', label: 'Channel' }, { value: 'signals', label: 'Signals', defaultDir: 'desc' }],
          }}
          searchText={(r) => `${r.channel} ${personName(r.owner)}`}
          filterValue={(r) => (r.owner ? 'owned' : 'unowned')}
          sortValue={(r, key) => (key === 'signals' ? r.count : r.channel.toLowerCase())}
          rowLabel={(r) => r.channel}
          name={{ label: 'Channel', render: (r) => <NameCell primary={r.channel} /> }}
          columns={[
            { key: 'signals', label: 'Signals', width: 96, priority: 2, render: (r) => <span className='text-label text-muted-foreground'>{r.count === 1 ? '1 signal' : `${r.count} signals`}</span> },
            {
              key: 'owner',
              label: 'Owner',
              width: 224,
              render: (r) => (
                <span className='flex items-center gap-2'>
                  <UserPicker value={r.owner} readOnly={!admin} onChange={(id) => void save(r.channel, id)} emptyLabel='No owner' showEmptyLabel caret className='min-w-36' />
                  {saved === r.channel && <span role='status' className='text-label text-success'>Saved</span>}
                </span>
              ),
            },
          ]}
        />
        {failure && <SettingsNotice tone='danger' title='The owner was not saved'>{failure}</SettingsNotice>}
      </SettingsReadOnly>
    </>
  )
}

/** Signal overrides tab (List): the signals with an owner of their own; a row opens the signal. */
function OverridesTab({ signals, owners, error }: TabProps) {
  const { open } = useSettingsDialog()
  const personName = usePersonName()
  const byId = signalMap(signals)
  const rows = Object.entries(owners?.signals ?? {}).sort(([a], [b]) => signalLabel(byId, a).localeCompare(signalLabel(byId, b)))
  return (
    <>
      <SettingsIntro info='An owner set on a signal wins over its channel default, and "No owner" leaves that signal unowned. Open a signal to change its owner.'>
        The signals that have an owner of their own.
      </SettingsIntro>
      <DataGrid<[string, string | null]>
        rows={rows}
        getId={([signalId]) => signalId}
        loading={!owners && error === null}
        error={error ?? undefined}
        empty='No signal has an owner of its own. Set one on the signal’s page.'
        bar={{ noun: 'overrides', one: 'override' }}
        searchText={([signalId, owner]) => `${signalLabel(byId, signalId, { withChannel: true })} ${signalId} ${personName(owner)}`}
        rowLabel={([signalId]) => signalLabel(byId, signalId)}
        // An override on a signal that no longer exists still shows (as its bare id), because that is
        // exactly the row to clean up; opening it lands on the signals list with a notice.
        onOpen={([signalId]) => open(signalsPath(signalId))}
        name={{
          label: 'Signal',
          render: ([signalId]) => <NameCell primary={signalLabel(byId, signalId)} secondary={signalId} />,
        }}
        columns={[
          {
            key: 'owner',
            label: 'Owner',
            width: 176,
            render: ([, owner]) => (owner ? <UserChip userId={owner} showName unknown='id' /> : <span className='text-body-sm text-muted-foreground'>No owner</span>),
          },
        ]}
      />
    </>
  )
}
