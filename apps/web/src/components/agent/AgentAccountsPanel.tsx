import * as React from 'react'
import { CheckCircle2, CircleAlert, CircleDashed } from 'lucide-react'
import { AccountConnectDialog } from '@workerdeck/ui'
import { Badge, Button, confirm } from '@silkweave/box-ui'
import { agentClient, setAgentEngine } from '../../lib/agentStore.ts'
import { relativeTime } from '../../lib/format.ts'
import { useAuth } from '../../lib/useAuth.tsx'
import { upsertUser } from '../../lib/useUsersData.ts'
import type { User } from '../../user-types.ts'

interface AccountProfile {
  name: string
  person: string
  engine: 'claude' | 'codex'
  description: string | null
  connectable: boolean
  account: { connectedAt: string; expiresAt: string } | null
  available: boolean | null
  unavailableReason: string | null
}

interface AccountsResponse {
  enabled: boolean
  profiles: AccountProfile[]
}

const ENGINE_LABEL: Record<string, string> = { claude: 'Claude', codex: 'Codex' }

const fetchAccounts = async (userId: string): Promise<AccountsResponse> => {
  const res = await fetch(`/api/agent/accounts?user=${encodeURIComponent(userId)}`, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`could not load agent accounts (${res.status})`)
  return (await res.json()) as AccountsResponse
}

/** A profile counts as connected when it has a stored account or the worker finds it signed in. */
const connected = (p: AccountProfile): boolean => p.account !== null || p.available === true

const dateOnly = (iso: string): string => iso.slice(0, 10)

/**
 * One user's agent accounts: their Claude and Codex profiles, Connect / Reconnect / Disconnect
 * (WorkerDeck runs the official sign-in and keeps the credential; the Box never sees it), and the
 * Default profile their runs use. Shown on Settings > Profile for yourself and in the Users detail
 * for an admin, the agent included: for the agent the default is the only profile it runs on.
 */
export function AgentAccountsPanel({ user, isAgent }: { user: User; isAgent: boolean }) {
  const { principal } = useAuth()
  const [data, setData] = React.useState<AccountsResponse | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [connecting, setConnecting] = React.useState<AccountProfile | undefined>(undefined)
  const [saving, setSaving] = React.useState(false)
  const self = principal?.id === user.id

  const load = React.useCallback(() => {
    fetchAccounts(user.id).then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
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
    setError(null)
    try {
      await agentClient.disconnectAccount(p.name)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const chooseDefault = async (p: AccountProfile | null): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      await upsertUser({ id: user.id, agent_profile: p?.name ?? '' })
      // Your own new default also becomes the engine your next sidebar session starts on.
      if (self && p) setAgentEngine(p.engine)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const name = user.nickname || user.id
  const chosen = data?.profiles.find((p) => p.name === user.agent_profile) ?? null
  return (
    <section className='flex flex-col gap-3' aria-label='Agent accounts'>
      <div>
        <h3 className='text-body-sm font-semibold text-text'>Agent accounts</h3>
        <p className='mt-0.5 max-w-prose text-label text-muted-foreground'>
          {isAgent
            ? `${name} runs only on the default profile: chat replies and every trigger that runs as ${name}.`
            : `Sidebar sessions, triggers and Builder run on ${self ? 'your' : `${name}'s`} own accounts. The default profile is used when nothing names an engine.`}
        </p>
      </div>
      {error && <p className='text-label text-danger'>{error}</p>}
      {!data ? (
        !error && <p className='text-label text-muted-foreground'>Loading…</p>
      ) : !data.enabled ? (
        <p className='text-label text-muted-foreground'>The agent surface is not configured on this Box (box.json workerdeck).</p>
      ) : data.profiles.length === 0 ? (
        <p className='text-label text-muted-foreground'>{name} has no agent profiles. An admin maps them in box.json agentProfiles.</p>
      ) : (
        <ul className='flex flex-col divide-y divide-border border-y border-border'>
          {data.profiles.map((p) => {
            const isDefault = chosen?.name === p.name
            return (
              <li key={p.name} className='flex flex-wrap items-center gap-x-4 gap-y-2 py-3'>
                <div className='min-w-0 flex-1'>
                  <p className='flex items-center gap-2 text-body-sm font-medium text-text'>
                    {ENGINE_LABEL[p.engine] ?? p.engine}
                    <code className='font-normal text-label text-muted-foreground'>{p.name}</code>
                    {isDefault && <Badge variant='accent' size='sm'>Default</Badge>}
                  </p>
                  <p className='mt-0.5 flex items-start gap-1.5 text-label text-muted-foreground'>
                    {p.account ? (
                      <>
                        <CheckCircle2 className='mt-px size-3.5 shrink-0 text-success' />
                        <span>Connected {relativeTime(p.account.connectedAt)}, expires {dateOnly(p.account.expiresAt)}</span>
                      </>
                    ) : p.available === true ? (
                      <>
                        <CheckCircle2 className='mt-px size-3.5 shrink-0 text-success' />
                        <span>{p.connectable ? 'Signed in' : 'Signed in on the Box host'}</span>
                      </>
                    ) : !p.connectable ? (
                      <>
                        <CircleDashed className='mt-px size-3.5 shrink-0' />
                        <span>Not signed in. Sign in on the Box host.</span>
                      </>
                    ) : (
                      <>
                        <CircleAlert className='mt-px size-3.5 shrink-0 text-warning' />
                        <span>Not connected</span>
                      </>
                    )}
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  {connected(p) && !isDefault && (
                    <Button size='sm' variant='ghost' disabled={saving} onClick={() => void chooseDefault(p)}>
                      Use as default
                    </Button>
                  )}
                  {p.connectable && (p.account || (p.engine === 'codex' && p.available === true)) && (
                    <Button size='sm' variant='ghost' className='text-muted-foreground' onClick={() => void disconnect(p)}>
                      Disconnect
                    </Button>
                  )}
                  {p.connectable && (
                    <Button size='sm' variant={connected(p) ? 'outline' : 'default'} onClick={() => setConnecting(p)}>
                      {connected(p) ? 'Reconnect' : 'Connect'}
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {data?.enabled && data.profiles.length > 0 && (
        <p className='text-label text-muted-foreground'>
          {chosen ? (
            <>
              Default: <code>{chosen.name}</code>
              {!connected(chosen) && <span className='text-warning'> (not connected: its runs fail until it is)</span>}.{' '}
              <button type='button' disabled={saving} className='underline underline-offset-2 hover:text-text' onClick={() => void chooseDefault(null)}>
                Clear
              </button>
            </>
          ) : (
            'No default chosen: Claude is used first.'
          )}
        </p>
      )}
      <AccountConnectDialog
        client={agentClient}
        profile={connecting?.name}
        engine={connecting?.engine}
        onClose={() => setConnecting(undefined)}
        onConnected={() => {
          setConnecting(undefined)
          load()
        }}
      />
    </section>
  )
}
