import { useEffect, useState } from 'react'
import { Wordmark, Button } from '@silkweave/box-ui'
import { trpc } from '../lib/trpc.ts'
import { useAuth } from '../lib/useAuth.tsx'

// The consent page of MCP sign-in (`/connect?request=<id>`): an MCP client (Claude Code, Codex, ...)
// sent the person's browser here from the Box's `/mcp/authorize`. It shows who is signed in, the
// client as it identified itself and where the browser returns, and asks Allow or Deny. App.tsx
// renders it outside the app shell for any signed-in person; signed out, the login comes first and
// returns here (lib/returnPath.ts).
//
// Honest about what is known: a client's name is self-declared, so only a CIMD client's publishing
// host is shown as verified, and nothing claims which program or person started the request.

interface ConsentRequest {
  id: string
  clientId: string
  clientName: string | null
  clientKind: 'cimd' | 'dcr'
  clientHost: string | null
  redirectHost: string
  expiresAt: number
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; request: ConsentRequest; person: { id: string; display: string }; outsideServices: string[] }
  | { kind: 'gone' }
  | { kind: 'denied' }
  | { kind: 'error'; message: string }

export function ConnectView({ requestId }: { requestId: string }) {
  const { principal, logout } = useAuth()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  // Set when an Allow was refused because the session is now another person (an account switch in
  // another tab): the page reloads who is signed in and asks again.
  const [switched, setSwitched] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!requestId) return setState({ kind: 'gone' })
    let live = true
    trpc.connectRequest.query({ id: requestId }).then(
      (res) => {
        if (!live) return
        setState(res.request ? { kind: 'ready', request: res.request, person: res.person, outsideServices: res.outsideServices } : { kind: 'gone' })
      },
      (e: unknown) => live && setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }),
    )
    return () => {
      live = false
    }
  }, [requestId, principal?.id, reload])

  // A click, never an effect: consent is the person's explicit act.
  const decide = async (allow: boolean): Promise<void> => {
    if (busy) return
    if (state.kind !== 'ready') return
    setBusy(true)
    try {
      // `shown` is only a precondition: the server approves for the session's person, and refuses an
      // Allow when that is no longer the person this page shows.
      const { redirectTo } = await trpc.connectDecide.mutate({ id: requestId, allow, shown: state.person.id })
      if (!redirectTo) {
        setBusy(false)
        return setState({ kind: 'gone' })
      }
      if (!allow) setState({ kind: 'denied' })
      // Back to the client (its loopback listener or its hosted callback), which finishes the sign-in.
      window.location.replace(redirectTo)
    } catch (e) {
      setBusy(false)
      const data = (e as { data?: { code?: string; httpStatus?: number } } | null)?.data
      if (data?.code === 'CONFLICT' || data?.httpStatus === 409) {
        setSwitched(true)
        setState({ kind: 'loading' })
        return setReload((n) => n + 1)
      }
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className='flex min-h-dvh w-full items-center justify-center bg-bg px-4 py-10 text-text'>
      <div className='w-full max-w-md'>
        <div className='mb-8 flex justify-center'>
          <Wordmark />
        </div>
        <div className='flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-(--shadow-md)'>
          {state.kind === 'loading' && <p className='text-body-sm text-muted-foreground'>Loading…</p>}
          {state.kind === 'gone' && (
            <Note title='This request is no longer open'>
              It was already answered, it expired (requests last 10 minutes) or the Box restarted. Start the sign-in again in your app.
            </Note>
          )}
          {state.kind === 'denied' && <Note title='Not connected'>You denied the request. Your app reports that the sign-in was refused.</Note>}
          {state.kind === 'error' && <Note title='Could not continue'>{state.message}</Note>}
          {state.kind === 'ready' && switched && (
            <Note title='You are signed in as someone else now'>The account changed in another tab. Check who is signed in below and decide again.</Note>
          )}
          {state.kind === 'ready' && (
            <Consent request={state.request} person={state.person} outsideServices={state.outsideServices} busy={busy} onDecide={decide} onSwitch={() => void logout()} />
          )}
          {state.kind !== 'ready' && principal && (
            <Button variant='ghost' onClick={() => window.location.replace('/')}>
              Go to the dashboard
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className='text-heading-3 font-semibold'>{title}</h1>
      <p className='mt-1 text-body-sm text-muted-foreground'>{children}</p>
    </div>
  )
}

function Consent({ request, person, outsideServices, busy, onDecide, onSwitch }: { request: ConsentRequest; person: { id: string; display: string }; outsideServices: string[]; busy: boolean; onDecide: (allow: boolean) => void; onSwitch: () => void }) {
  const verified = request.clientKind === 'cimd' && request.clientHost
  const name = request.clientName?.trim() || (verified ? request.clientHost! : 'An app')
  return (
    <>
      <div>
        <h1 className='text-heading-3 font-semibold'>Connect {name} to your account?</h1>
        <p className='mt-1 text-body-sm text-muted-foreground'>
          {verified ? (
            <>
              Published by <span className='font-medium text-text'>{request.clientHost}</span>.
            </>
          ) : (
            <>
              <span className='font-medium text-warning'>Unverified app.</span> Its name is what it says about itself.
            </>
          )}{' '}
          After you decide, your browser returns to <code className='text-text'>{request.redirectHost}</code>.
        </p>
      </div>
      <p className='text-body-sm'>
        This app can use your current Box permissions, including changes you can make; they follow future role changes. You can revoke it any time in Settings, Profile.
      </p>
      {outsideServices.length > 0 && (
        <p className='text-body-sm'>
          It can also use the outside services you reach through this Box: <span className='font-medium'>{outsideServices.join(', ')}</span>.
        </p>
      )}
      <p className='text-label text-muted-foreground'>
        Signed in as <span className='font-medium text-text'>{person.display}</span>{' '}
        <button type='button' className='underline underline-offset-2 hover:text-text' onClick={onSwitch} disabled={busy}>
          Switch account
        </button>
      </p>
      <p className='text-label text-muted-foreground'>Only allow it if you just started connecting this app yourself.</p>
      <div className='flex gap-2'>
        <Button className='flex-1' onClick={() => onDecide(true)} disabled={busy}>
          Allow
        </Button>
        <Button className='flex-1' variant='outline' onClick={() => onDecide(false)} disabled={busy}>
          Deny
        </Button>
      </div>
    </>
  )
}
