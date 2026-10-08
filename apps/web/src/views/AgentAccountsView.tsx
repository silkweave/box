import * as React from 'react'
import { CheckCircle2, CircleAlert } from 'lucide-react'
import { AccountConnectDialog } from '@workerdeck/ui'
import { Button, PageContainer, confirm } from '@silkweave/box-ui'
import { agentClient } from '../lib/agentStore.ts'
import { relativeTime } from '../lib/format.ts'
import { useAuth } from '../lib/useAuth.tsx'

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

const fetchAccounts = async (): Promise<AccountsResponse> => {
  const res = await fetch('/api/agent/accounts', { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`could not load agent accounts (${res.status})`)
  return (await res.json()) as AccountsResponse
}

const dateOnly = (iso: string): string => iso.slice(0, 10)

/**
 * Settings, Agent accounts: which Claude account each agent profile runs on, and the button that
 * connects one. WorkerDeck runs the official `claude setup-token` sign-in and keeps the token for the
 * profile; the Box never sees it. A person connects their own profiles, an admin anyone's.
 */
export function AgentAccountsView() {
  const { principal } = useAuth()
  const [data, setData] = React.useState<AccountsResponse | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [connecting, setConnecting] = React.useState<string | undefined>(undefined)

  const load = React.useCallback(() => {
    fetchAccounts().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  React.useEffect(load, [load])

  const disconnect = async (p: AccountProfile): Promise<void> => {
    const ok = await confirm({
      title: `Disconnect ${p.name}?`,
      message: 'Its runs stop using this Claude account until someone connects one again. Also revoke the token at claude.ai (Settings, Claude Code).',
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

  const admin = principal?.role === 'admin'
  return (
    <PageContainer width='wide' className='px-4 pt-2 pb-8 md:px-6'>
      <div className='flex flex-col gap-6'>
        <p className='max-w-prose text-body-sm text-muted-foreground'>
          Agent runs (sidebar sessions, triggers, Builder) use the Claude account connected to the person's profile.
          Connect signs in once at claude.ai and lasts a year. {admin ? 'As an admin you can connect any profile.' : ''}
        </p>
        {error && <p className='text-body-sm text-danger'>{error}</p>}
        {!data ? (
          !error && <p className='text-body-sm text-muted-foreground'>Loading…</p>
        ) : !data.enabled ? (
          <p className='text-body-sm text-muted-foreground'>The agent surface is not configured on this Box (box.json workerdeck).</p>
        ) : data.profiles.length === 0 ? (
          <p className='text-body-sm text-muted-foreground'>You have no agent profiles. An admin maps them in box.json agentProfiles.</p>
        ) : (
          <ul className='flex flex-col divide-y divide-border'>
            {data.profiles.map((p) => (
              <li key={p.name} className='flex flex-wrap items-center gap-x-4 gap-y-2 py-3'>
                <div className='min-w-0 flex-1'>
                  <p className='text-body-sm font-medium text-text'>
                    {p.name}
                    {p.description && <span className='ml-2 font-normal text-muted-foreground'>{p.description}</span>}
                  </p>
                  <p className='mt-0.5 flex items-start gap-1.5 text-label text-muted-foreground'>
                    {p.account ? (
                      <>
                        <CheckCircle2 className='mt-px size-3.5 shrink-0 text-success' />
                        <span>Connected {relativeTime(p.account.connectedAt)}, expires {dateOnly(p.account.expiresAt)}</span>
                      </>
                    ) : !p.connectable ? (
                      <span>Codex signs in on the Box host (`codex login`); connecting here comes later.</span>
                    ) : (
                      <>
                        <CircleAlert className='mt-px size-3.5 shrink-0 text-warning' />
                        <span>
                          No account connected
                          {p.available === false && p.unavailableReason ? `: ${p.unavailableReason}` : ''}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                {p.connectable && (
                  <div className='flex items-center gap-2'>
                    {p.account && (
                      <Button size='sm' variant='ghost' className='text-muted-foreground' onClick={() => void disconnect(p)}>
                        Disconnect
                      </Button>
                    )}
                    <Button size='sm' variant={p.account ? 'outline' : 'default'} onClick={() => setConnecting(p.name)}>
                      {p.account ? 'Reconnect' : 'Connect'}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <AccountConnectDialog
        client={agentClient}
        profile={connecting}
        onClose={() => setConnecting(undefined)}
        onConnected={() => {
          setConnecting(undefined)
          load()
        }}
      />
    </PageContainer>
  )
}
