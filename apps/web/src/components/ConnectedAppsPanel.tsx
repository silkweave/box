import * as React from 'react'
import { Button, SettingsNotice, confirm } from '@silkweave/box-ui'
import { DataGrid, NameCell } from '@silkweave/box-ui/list'
import { trpc } from '../lib/trpc.ts'
import { relativeTime } from '../lib/format.ts'

/** One connected app as the server returns it (apps/server auth/connect.controller.ts). */
interface ConnectedApp {
  grantId: string
  principalId: string
  clientId: string
  clientName: string | null
  clientKind: 'cimd' | 'dcr'
  clientHost: string | null
  connectedAt: string
  lastUsedAt: string | null
  expiresAt: string
  device: string | null
}

const dateOnly = (iso: string): string => iso.slice(0, 10)

/** How a client is named: its own name (self-declared), and who publishes it (blank when nothing is verified). */
function clientLabel(a: ConnectedApp): { name: string; source: string } {
  const name = a.clientName?.trim() || (a.clientHost ?? 'Unnamed app')
  return { name, source: a.clientKind === 'cimd' && a.clientHost ? `published by ${a.clientHost}` : '' }
}

/**
 * The MCP clients a person connected to their account (Claude Code, Codex, ...): a grid with one row
 * per connection, when it was connected and last used, when it has to reconnect, and Revoke.
 * Settings > Profile shows your own; the Users detail shows a person's to an admin. Hidden on a Box
 * without MCP sign-in.
 */
export function ConnectedAppsPanel({ userId, self, name }: { userId: string; self: boolean; name: string }) {
  const [installed, setInstalled] = React.useState<boolean | null>(null)
  const [apps, setApps] = React.useState<ConnectedApp[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  // A failed revoke, shown above the list; `error` is the load failing.
  const [failure, setFailure] = React.useState<string | null>(null)

  const load = React.useCallback(() => {
    void (async () => {
      try {
        const status = await trpc.connectStatus.query({})
        setInstalled(status.installed)
        if (!status.installed) return
        const res = self ? await trpc.connectApps.query({}) : await trpc.connectAppsOf.query({ principalId: userId })
        setApps(res.apps)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })()
  }, [self, userId])
  React.useEffect(load, [load])

  const revoke = async (a: ConnectedApp): Promise<void> => {
    const { name: appName } = clientLabel(a)
    const ok = await confirm({
      title: `Revoke ${appName}?`,
      message: `It stops working at once and has to be connected again. Removing it in the app itself does not revoke it here.`,
      confirmLabel: 'Revoke',
      danger: true,
    })
    if (!ok) return
    setFailure(null)
    try {
      if (self) await trpc.connectAppRevoke.mutate({ grantId: a.grantId })
      else await trpc.connectAppAdminRevoke.mutate({ grantId: a.grantId })
      load()
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e))
    }
  }

  const revokeAll = async (): Promise<void> => {
    const ok = await confirm({ title: `Revoke all of ${name}'s connected apps?`, message: 'Each stops working at once; they can connect again.', confirmLabel: 'Revoke all', danger: true })
    if (!ok) return
    setFailure(null)
    try {
      await trpc.connectAppsRevokeAll.mutate({ principalId: userId })
      load()
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e))
    }
  }

  if (installed === false) return null
  return (
    <>
      {failure && <SettingsNotice tone='danger' title='That did not work.'>{failure}</SettingsNotice>}
      <DataGrid<ConnectedApp>
        variant='section'
        title='Connected apps'
        rows={apps ?? []}
        getId={(a) => a.grantId}
        loading={!apps && error == null}
        error={error ?? undefined}
        onRetry={load}
        empty={self ? 'No apps connected yet. Add this Box to an AI client under Connect an AI client.' : `${name} has no connected apps.`}
        bar={{ noun: 'apps', one: 'app' }}
        searchText={(a) => `${clientLabel(a).name} ${a.clientHost ?? ''}`}
        rowLabel={(a) => clientLabel(a).name}
        name={{
          label: 'App',
          render: (a) => {
            const { name: appName, source } = clientLabel(a)
            return <NameCell primary={appName} secondary={[source, a.device ? `approved in ${a.device}` : ''].filter(Boolean).join(', ')} badge={a.clientKind === 'cimd' ? null : { label: 'Unverified', variant: 'warning' }} />
          },
        }}
        columns={[
          { key: 'connected', label: 'Connected', width: 112, priority: 2, render: (a) => <span className='text-muted-foreground'>{relativeTime(a.connectedAt)}</span> },
          { key: 'used', label: 'Last used', width: 112, priority: 2, render: (a) => <span className='text-muted-foreground'>{a.lastUsedAt ? relativeTime(a.lastUsedAt) : 'Not yet'}</span> },
          { key: 'expires', label: 'Reconnect by', width: 120, priority: 3, render: (a) => <span className='text-muted-foreground'>{dateOnly(a.expiresAt)}</span> },
        ]}
        rowActions={(a) => <Button size='sm' variant='ghost' className='text-muted-foreground' onClick={() => void revoke(a)}>Revoke</Button>}
        actions={!self && apps && apps.length > 1 ? (
          <Button size='sm' variant='ghost' className='text-muted-foreground' onClick={() => void revokeAll()}>Revoke all</Button>
        ) : undefined}
      />
    </>
  )
}
