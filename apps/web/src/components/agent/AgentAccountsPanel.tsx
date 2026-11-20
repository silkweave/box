import * as React from 'react'
import { AccountConnectDialog } from '@workerdeck/ui'
import { ActionMenu, Badge, SettingsNotice, confirm, type ActionMenuItem } from '@silkweave/box-ui'
import { DataGrid, NameCell } from '@silkweave/box-ui/list'
import { agentClient, loadAgentAccounts, notifyAgentAccountsChanged, setAgentEngine, type AgentAccountProfile, type AgentAccountsResponse } from '../../lib/agentStore.ts'
import { relativeTime } from '../../lib/format.ts'
import { useAuth } from '../../lib/useAuth.tsx'
import { upsertUser } from '../../lib/useUsersData.ts'
import type { User } from '../../user-types.ts'

type AccountProfile = AgentAccountProfile

const ENGINE_LABEL: Record<string, string> = { claude: 'Claude', codex: 'Codex' }

/** A profile counts as connected when it has a stored account or the worker finds it signed in. */
const connected = (p: AccountProfile): boolean => p.account !== null || p.available === true

const dateOnly = (iso: string): string => iso.slice(0, 10)

/** What the Agent accounts list is for, for the page's info popover. */
export function agentAccountsInfo(user: User, isAgent: boolean, self: boolean): string {
  const name = user.nickname || user.id
  return isAgent
    ? `${name} runs only on the default profile: chat replies and every trigger that runs as ${name}.`
    : `Sidebar sessions, triggers and Builder run on ${self ? 'your' : `${name}'s`} own accounts. The default is used when nothing names an engine; with none chosen, Claude is used first.`
}

/**
 * One user's agent accounts as a grid: their Claude and Codex profiles, Connect / Reconnect with
 * Disconnect and the Default choice in the row menu (WorkerDeck runs the official sign-in and keeps
 * the credential; the Box never sees it). `titled` draws it as a section with a heading, for a page
 * that holds other lists too; alone in a tab it is the tab's plain grid. Shown on Settings > Profile
 * for yourself and in the Users detail for an admin, the agent included: for the agent the default
 * is the only profile it runs on.
 */
export function AgentAccountsPanel({ user, titled = false }: { user: User; titled?: boolean }) {
  const { principal } = useAuth()
  const [data, setData] = React.useState<AgentAccountsResponse | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  // A failed action, shown above the list; `error` is the load failing.
  const [failure, setFailure] = React.useState<string | null>(null)
  const [connecting, setConnecting] = React.useState<AccountProfile | undefined>(undefined)
  const [saving, setSaving] = React.useState(false)
  const self = principal?.id === user.id

  const load = React.useCallback(() => {
    loadAgentAccounts(user.id).then((d) => { setError(null); setData(d) }, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [user.id])
  React.useEffect(load, [load])

  const disconnect = async (p: AccountProfile): Promise<void> => {
    const ok = await confirm({
      title: `Disconnect ${p.name}?`,
      message:
        p.engine === 'codex'
          ? 'Its runs stop using this account until someone connects one again.'
          : 'Its runs stop using this account until someone connects one again. Also revoke the token at claude.ai (Settings, Claude Code).',
      confirmLabel: 'Disconnect',
      danger: true,
    })
    if (!ok) return
    setFailure(null)
    try {
      await agentClient.disconnectAccount(p.name)
      load()
      notifyAgentAccountsChanged()
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e))
    }
  }

  const chooseDefault = async (p: AccountProfile | null): Promise<void> => {
    setSaving(true)
    setFailure(null)
    try {
      await upsertUser({ id: user.id, agent_profile: p?.name ?? '' })
      // Your own new default also becomes the engine your next sidebar session starts on.
      if (self && p) setAgentEngine(p.engine)
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const name = user.nickname || user.id
  const chosen = data?.profiles.find((p) => p.name === user.agent_profile) ?? null
  // Choosing between accounts only means something once two are connected; with one, it is the
  // default. A chosen default that is no longer connected still shows, so its failing runs are fixable.
  const choosable = (data?.profiles.filter(connected).length ?? 0) > 1 || (chosen !== null && !connected(chosen))
  const rows = data?.enabled ? data.profiles : []
  const empty = !data?.enabled
    ? 'Agent sessions are not set up on this Box yet. An administrator turns them on.'
    : `${self ? 'You have' : `${name} has`} no agent accounts yet. An administrator adds them.`
  return (
    <>
      {failure && <SettingsNotice tone='danger' title='That did not work.'>{failure}</SettingsNotice>}
      <DataGrid<AccountProfile>
        variant={titled ? 'section' : 'full'}
        title={titled ? 'Agent accounts' : undefined}
        rows={rows}
        getId={(p) => p.name}
        loading={!data && error == null}
        error={error ?? undefined}
        onRetry={load}
        empty={empty}
        bar={{ noun: 'accounts', one: 'account' }}
        rowLabel={(p) => `${ENGINE_LABEL[p.engine] ?? p.engine} ${p.name}`}
        name={{
          label: 'Account',
          render: (p) => {
            const isDefault = chosen?.name === p.name
            return (
              <NameCell
                primary={ENGINE_LABEL[p.engine] ?? p.engine}
                secondary={isDefault && !connected(p) ? 'Its runs fail until it is connected' : p.name}
                badge={isDefault ? { label: 'Default', variant: 'accent' } : null}
              />
            )
          },
        }}
        columns={[
          { key: 'status', label: 'Status', width: 150, render: (p) => <ProfileStatus profile={p} /> },
          { key: 'connected', label: 'Connected', width: 112, priority: 2, render: (p) => <span className='text-muted-foreground'>{p.account ? relativeTime(p.account.connectedAt) : ''}</span> },
          { key: 'expires', label: 'Expires', width: 104, priority: 3, render: (p) => <span className='text-muted-foreground'>{p.account ? dateOnly(p.account.expiresAt) : ''}</span> },
        ]}
        rowActions={(p) => {
          const isDefault = chosen?.name === p.name
          // Connect, Reconnect and the rest share the row's one menu: the action slot is 64px.
          const items: ActionMenuItem[] = [
            ...(p.connectable ? [{ label: connected(p) ? 'Reconnect' : 'Connect', onSelect: () => setConnecting(p) }] : []),
            ...(choosable && connected(p) && !isDefault ? [{ label: 'Use as default', disabled: saving, onSelect: () => void chooseDefault(p) }] : []),
            ...(isDefault && choosable ? [{ label: 'Clear default', disabled: saving, onSelect: () => void chooseDefault(null) }] : []),
            ...(p.connectable && (p.account || (p.engine === 'codex' && p.available === true))
              ? [{ label: 'Disconnect', danger: true, onSelect: () => void disconnect(p) }]
              : []),
          ]
          return items.length > 0 ? <ActionMenu size='sm' label={`Actions for ${p.name}`} items={items} /> : null
        }}
      />
      <AccountConnectDialog
        client={agentClient}
        profile={connecting?.name}
        engine={connecting?.engine}
        onClose={() => setConnecting(undefined)}
        onConnected={() => {
          // The first connected account becomes the default, so a person with one account never has to choose.
          if (connecting && (!chosen || !connected(chosen))) void chooseDefault(connecting)
          setConnecting(undefined)
          load()
          notifyAgentAccountsChanged()
        }}
      />
    </>
  )
}

/** One profile's state as a badge: connected, signed in on the host, or not. */
function ProfileStatus({ profile: p }: { profile: AccountProfile }) {
  if (p.account) return <Badge variant='success'>Connected</Badge>
  if (p.available === true) return <Badge variant='success'>{p.connectable ? 'Signed in' : 'Signed in on the Box host'}</Badge>
  if (!p.connectable) return <Badge variant='neutral' title='Sign in on the Box host'>Not signed in</Badge>
  return <Badge variant='warning'>Not connected</Badge>
}
