import { useState } from 'react'
import { LogIn } from 'lucide-react'
import { Wordmark, Button } from '@silkweave/box-ui'
import { useAuth, type Principal } from '../lib/useAuth.tsx'
import { grantSubject } from '../lib/signinGrant.ts'
import { LINK_ERRORS } from './LoginView.tsx'

// A sign-in link opened in a browser that is already signed in as someone else (App.tsx). Asks
// instead of switching: a forwarded or planted link would otherwise move the person into another
// account without their noticing, and what they type next would land there. Switching spends the
// grant, whose session cookie replaces the current one, and starts the app afresh so nothing loaded
// for the previous person stays on screen. Staying drops the grant unspent.

export function SwitchAccountView({ grant, current, onStay }: { grant: string; current: Principal; onStay: () => void }) {
  const { loginWithLink } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const subject = grantSubject(grant)

  // A click, never an effect: the same rule as LoginView's "Continue as".
  const switchAccount = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await loginWithLink(grant, { reload: true })
    if (!res.ok) {
      setBusy(false)
      setError(LINK_ERRORS[res.error ?? ''] ?? 'That sign-in link did not work. Ask for a new one.')
    }
  }

  return (
    <div className='flex h-dvh w-full items-center justify-center bg-bg px-4 text-text'>
      <div className='w-full max-w-sm'>
        <div className='mb-8 flex justify-center'>
          <Wordmark />
        </div>
        <div className='flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-(--shadow-md)'>
          <div>
            <h1 className='text-heading-3 font-semibold'>Switch account?</h1>
            <p className='mt-1 text-body-sm text-muted-foreground'>
              You are signed in as <span className='font-medium text-text'>{current.display}</span>.{' '}
              {subject ? (
                <>
                  This link signs in as <span className='font-medium text-text'>{subject}</span>.
                </>
              ) : (
                'This link signs in as another account.'
              )}
            </p>
          </div>
          {error && <p className='text-body-sm text-destructive'>{error}</p>}
          {!error && (
            <Button onClick={switchAccount} disabled={busy}>
              <LogIn />
              {busy ? 'Switching…' : subject ? `Switch to ${subject}` : 'Switch account'}
            </Button>
          )}
          <Button variant={error ? 'default' : 'ghost'} onClick={onStay} disabled={busy}>
            Stay as {current.display}
          </Button>
        </div>
      </div>
    </div>
  )
}
