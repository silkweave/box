import { useEffect, useState, type FormEvent } from 'react'
import { Copy, LogIn, Terminal } from 'lucide-react'
import { Wordmark, Badge, Button } from '@silkweave/box-ui'
import { useAuth } from '../lib/useAuth.tsx'

// The sign-in gate, shown whenever there is no session. Two ways in, and they are different
// credentials (see apps/server/src/auth/auth.controller.ts):
//
//   - A SIGN-IN LINK (`/login/<grant>`, normalized to transient query state by router.tsx):
//     path for a person who is not set up yet.
//   - An ACCESS TOKEN, pasted: the permanent credential, the same one their MCP client uses. For
//     someone who kept theirs.
//
// There is no password. See docs/AUTH.md.

/** Why a link did not work. The server sends these as the 401 message; anything else is unexpected. */
const LINK_ERRORS: Record<string, string> = {
  expired: 'This sign-in link has expired - they only last a few minutes. Ask for a new one.',
  used: 'This sign-in link has already been used. Ask for a new one.',
  invalid: 'This is not a valid sign-in link for this Box.',
  revoked: 'That account no longer has access to this Box. Ask an admin.',
}

/** The `e=` hints the server redirects with. */
const NOTICES: Record<string, string> = {
  retired:
    'That link is an old-style one and no longer signs you in. Ask for a new sign-in link, or paste your access token below.',
  invalid: 'That sign-in link did not work. Ask for a new one, or paste your access token below.',
}

/**
 * Read the subject out of a grant WITHOUT verifying it - display only.
 *
 * Safe because nothing is decided on it: the server verifies the signature and it alone decides who
 * this is. Showing "Continue as alice" is purely so a person can tell they are about to sign in as
 * the right account (and notice when a colleague forwarded them their own link).
 */
function grantSubject(grant: string): string | null {
  try {
    const payload = grant.split('.')[1]
    if (!payload) return null
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    if (grant.startsWith('bl2.')) {
      if (decoded.length < 11) return null
      return new TextDecoder().decode(Uint8Array.from(decoded.slice(10), char => char.charCodeAt(0))) || null
    }
    const sub = (JSON.parse(decoded) as { sub?: unknown }).sub
    return typeof sub === 'string' && sub ? sub : null
  } catch {
    return null
  }
}

export function LoginView() {
  const { login, loginWithLink, needsOwner } = useAuth()
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  // Captured once, on mount. The URL is scrubbed immediately afterwards so the grant does not sit in
  // the address bar to be screenshotted, shoulder-read or copied out of a shared screen, and so Back
  // cannot return to it. Keeping it in state is enough - it is spent by a POST, not by the URL.
  const [grant, setGrant] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const link = params.get('link')
    const e = params.get('e')
    if (link) setGrant(link)
    if (e && NOTICES[e]) setNotice(NOTICES[e])
    if (link || e) {
      params.delete('link')
      params.delete('e')
      const qs = params.toString()
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    }
  }, [])

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!token.trim() || busy) return
    setBusy(true)
    setError(null)
    const res = await login(token.trim())
    setBusy(false)
    if (!res.ok) setError(res.error ?? 'Sign in failed')
  }

  // Deliberately NOT called from an effect. The click is the control that stops a link unfurler or a
  // URL scanner from spending a single-use grant before the human ever sees it - auto-submitting on
  // mount would hand that back to any headless browser that renders the page.
  const useLink = async (): Promise<void> => {
    if (!grant || busy) return
    setBusy(true)
    setError(null)
    const res = await loginWithLink(grant)
    setBusy(false)
    if (!res.ok) {
      setError(LINK_ERRORS[res.error ?? ''] ?? 'That sign-in link did not work. Ask for a new one.')
      setGrant(null) // a spent or bad grant is not worth a second button
    }
  }

  const subject = grant ? grantSubject(grant) : null
  const bootstrapCommand = 'bun setup'

  const copyBootstrap = async (): Promise<void> => {
    await navigator.clipboard.writeText(bootstrapCommand)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className='flex h-dvh w-full items-center justify-center bg-bg px-4 text-text'>
      <div className={`w-full ${needsOwner && !grant ? 'max-w-4xl' : 'max-w-sm'}`}>
        <div className='mb-8 flex justify-center'>
          <Wordmark />
        </div>

        {grant ? (
          <div className='flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-(--shadow-md)'>
            <div>
              <h1 className='text-heading-3 font-semibold'>Sign in</h1>
              <p className='mt-1 text-body-sm text-muted-foreground'>
                {subject ? (
                  <>
                    You have a sign-in link for <span className='font-medium text-text'>{subject}</span>.
                  </>
                ) : (
                  'You have a sign-in link.'
                )}
              </p>
            </div>
            {error && <p className='text-body-sm text-destructive'>{error}</p>}
            <Button onClick={useLink} disabled={busy}>
              <LogIn />
              {busy ? 'Signing in…' : subject ? `Continue as ${subject}` : 'Continue'}
            </Button>
            <button
              type='button'
              onClick={() => setGrant(null)}
              className='text-body-sm text-muted-foreground underline-offset-2 hover:underline'>
              Use an access token instead
            </button>
          </div>
        ) : needsOwner ? (
          <div className='grid overflow-hidden rounded-xl border border-border bg-surface shadow-(--shadow-md) md:grid-cols-[1.1fr_0.9fr]'>
            <section className='p-6 md:p-8'>
              <Badge variant='silk'>First run</Badge>
              <h1 className='mt-5 font-serif text-display-md'>Set up the owner of this Box</h1>
              <p className='mt-2 max-w-lg text-body-sm leading-relaxed text-muted-foreground'>
                This Box is running, but it has no human account yet. Guided setup creates the owner and connects any local Codex or Claude profiles without opening a network signup window.
              </p>
              <ol className='mt-6 space-y-5 text-body-sm'>
                <li className='flex gap-3'><StepNumber value='1' /><div><p className='font-medium text-text'>Open another terminal in this checkout</p><p className='mt-1 text-muted-foreground'>Leave <code>bun dev</code> running.</p></div></li>
                <li className='flex gap-3'><StepNumber value='2' /><div className='min-w-0 flex-1'><p className='font-medium text-text'>Run guided setup</p><div className='mt-2 flex items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2'><Terminal className='size-4 shrink-0 text-accent' /><code className='min-w-0 flex-1 overflow-x-auto text-label'>{bootstrapCommand}</code><Button variant='ghost' size='icon-xs' aria-label='Copy command' onClick={() => void copyBootstrap()}><Copy /></Button></div><p className='mt-1 text-label text-muted-foreground'>{copied ? 'Copied.' : 'Confirm the machine identity, choose the owner, and accept any detected provider profiles.'}</p></div></li>
                <li className='flex gap-3'><StepNumber value='3' /><div><p className='font-medium text-text'>Open the printed sign-in link</p><p className='mt-1 text-muted-foreground'>It is short-lived and single-use. The permanent owner token stays out of terminal output.</p></div></li>
              </ol>
            </section>
            <form onSubmit={submit} className='flex flex-col justify-center gap-4 border-t border-border bg-bg/50 p-6 md:border-l md:border-t-0 md:p-8'>
              <div><h2 className='text-heading-3 font-semibold'>Manual fallback</h2><p className='mt-1 text-body-sm text-muted-foreground'>If you created the owner without guided setup, paste that owner's access token.</p></div>
              <TokenInput token={token} setToken={setToken} />
              {error && <p className='text-body-sm text-destructive'>{error}</p>}
              <Button type='submit' disabled={!token.trim() || busy}><LogIn />{busy ? 'Signing in…' : 'Sign in as owner'}</Button>
            </form>
          </div>
        ) : (
          <form onSubmit={submit} className='flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-(--shadow-md)'>
            <div>
              <h1 className='text-heading-3 font-semibold'>Sign in</h1>
              <p className='mt-1 text-body-sm text-muted-foreground'>Paste your access token to continue.</p>
            </div>
            {notice && <p className='text-body-sm text-muted-foreground'>{notice}</p>}
            <TokenInput token={token} setToken={setToken} />
            {error && <p className='text-body-sm text-destructive'>{error}</p>}
            <Button type='submit' disabled={!token.trim() || busy}>
              <LogIn />
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}

function StepNumber({ value }: { value: string }) {
  return <span className='flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-bg text-label font-semibold text-accent'>{value}</span>
}

function TokenInput({ token, setToken }: { token: string; setToken: (value: string) => void }) {
  return <input type='password' value={token} onChange={(event) => setToken(event.target.value)} placeholder='Access token' autoFocus autoComplete='off' aria-label='Access token' className='h-9 rounded-md border border-border bg-bg px-3 text-body-sm outline-none transition-colors focus-visible:border-accent' />
}
