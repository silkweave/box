import { useEffect, useState } from 'react'
import { trpc } from '../../lib/trpc.ts'
import { reloadSignals, useSignalsData } from '../lib/useSignalsData.ts'
import { signalLabel, signalMap } from '../lib/signalLabel.ts'
import { UserPicker, SETTINGS_GUTTER, SettingsIntro, SettingsList, SettingsListHeading, SettingsListRow } from '@silkweave/box-ui'

interface OwnersFile {
  channels: Record<string, string>
  signals: Record<string, string | null>
}

/**
 * Settings → Signal owners: the channel-level defaults from the signal-owner settings (a channel
 * default covers every signal in it, e.g. github → every github.* signal). Per-signal overrides are
 * edited on each signal's detail page; the ones on file are listed read-only here for transparency.
 */
export function SignalOwnersView() {
  const { data: signals } = useSignalsData()
  const [owners, setOwners] = useState<OwnersFile | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    trpc.signalsOwners
      .query({})
      .then((d) => setOwners(d as unknown as OwnersFile))
      .catch((e) => setError(String(e)))
  }, [])

  const save = async (channel: string, owner: string | null) => {
    const next = await trpc.signalsOwnersSave.mutate(
      owner === null ? { scope: 'channel', key: channel } : { scope: 'channel', key: channel, owner },
    )
    setOwners(next as unknown as OwnersFile)
    void reloadSignals()
  }

  if (error) return <p className={`${SETTINGS_GUTTER} py-8 text-body-sm text-danger`}>{error}</p>
  if (!owners) return <p className={`${SETTINGS_GUTTER} py-8 text-body-sm text-muted-foreground`}>Loading…</p>

  // Every channel that has signal in the warehouse, plus any channel already mapped in the file.
  const channels = [...new Set([...(signals?.channels ?? []), ...Object.keys(owners.channels)])].sort()
  const overrides = Object.entries(owners.signals)
  const byId = signalMap(signals)

  return (
    <div className='pb-6'>
      <SettingsIntro>
        Who each signal belongs to. A channel default covers all of its signals; clearing it leaves the
        channel unowned. Per-signal overrides are set on the signal&apos;s detail page.
      </SettingsIntro>

      <SettingsList label='Channel owners'>
        {channels.map((c) => {
          const count = (signals?.signals ?? []).filter((s) => s.channel === c).length
          return (
            <SettingsListRow key={c} className='grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]'>
              <code className='truncate text-body-sm text-text'>{c}</code>
              <span className='hidden text-label text-muted-foreground sm:block'>
                {count} signal{count === 1 ? '' : 's'}
              </span>
              <UserPicker value={owners.channels[c] ?? null} onChange={(id) => void save(c, id)} />
            </SettingsListRow>
          )
        })}
      </SettingsList>

      {overrides.length > 0 && (
        <>
          <SettingsListHeading title='Per-signal overrides' />
          <SettingsList label='Per-signal overrides'>
            {overrides.map(([signalId, owner]) => (
              <SettingsListRow key={signalId} className='grid-cols-[minmax(0,1fr)_auto] text-body-sm'>
                {/* Friendly name first, id underneath - an override on a signal that no longer
                    exists still shows (as its bare id), because that is exactly the row to clean up. */}
                <span className='flex min-w-0 flex-col'>
                  <span className='truncate text-text'>{signalLabel(byId, signalId, { withChannel: true })}</span>
                  <code className='truncate text-label text-muted-foreground'>{signalId}</code>
                </span>
                <span className='text-muted-foreground'>{owner ?? 'unowned (brand)'}</span>
              </SettingsListRow>
            ))}
          </SettingsList>
        </>
      )}
    </div>
  )
}
