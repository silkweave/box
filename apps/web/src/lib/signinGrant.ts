// The sign-in link a document was opened with. `/login/<grant>` is where sign-in links point (see
// apps/server/src/auth/app-url.ts) and `/login?e=...` is where a retired old-style link is redirected.
// Neither is a client route: the auth gate in App.tsx decides what to show, signed in or not.
//
// `captureSigninGrant()` runs before the router snapshots the URL (router.tsx). It takes the grant
// and the notice out of the address bar, signed in or not, so the credential never sits in the URL
// or the history, and keeps them here for this document only. A GET never spends a grant: only the
// person's click does, through POST /api/auth/link (see LoginView and SwitchAccountView).

/** Keeps the grant for this document only: a reload does not bring it back, the URL is gone. */
let pending: { grant: string | null; notice: string | null } = { grant: null, notice: null }

export interface SigninEntry {
  grant: string | null
  /** The `e=` hint the server redirected with (`retired`, `invalid`). */
  notice: string | null
  /** Where the address bar should point instead, or null when the URL carries nothing to take out. */
  cleanUrl: string | null
}

/** Pure: what a `/login` URL carries and where the address bar goes instead. */
export function readSigninEntry(pathname: string, search: string): SigninEntry {
  if (pathname !== '/login' && !pathname.startsWith('/login/')) return { grant: null, notice: null, cleanUrl: null }
  const params = new URLSearchParams(search)
  const rawGrant = pathname.slice('/login/'.length)
  let grant: string | null = null
  if (rawGrant) {
    try { grant = decodeURIComponent(rawGrant) } catch { grant = rawGrant }
  }
  const notice = params.get('e')
  params.delete('e')
  params.delete('link')
  const query = params.toString()
  return { grant, notice, cleanUrl: `/${query ? `?${query}` : ''}` }
}

/** Take the grant out of the address bar into this module. Call before the router snapshots the URL. */
export function captureSigninGrant(): void {
  if (typeof window === 'undefined') return
  const entry = readSigninEntry(window.location.pathname, window.location.search)
  if (entry.cleanUrl === null) return
  pending = { grant: entry.grant, notice: entry.notice }
  window.history.replaceState(null, '', entry.cleanUrl)
}

export function pendingSigninGrant(): string | null {
  return pending.grant
}

export function pendingSigninNotice(): string | null {
  return pending.notice
}

/** Drop the grant unspent (kept the current session, used a token instead, or the link failed). */
export function dropSigninGrant(): void {
  pending = { ...pending, grant: null }
}

/**
 * Read the subject out of a grant WITHOUT verifying it - display and routing only.
 *
 * Safe because nothing is granted on it: the server verifies the signature and it alone decides who
 * the bearer becomes. It names the account on "Continue as alice", and tells a signed-in browser
 * whether the link is for the same person (nothing to do) or someone else (ask before switching).
 */
export function grantSubject(grant: string): string | null {
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

/**
 * What a signed-in browser does with a pending grant. `same`: the link is for whoever is signed in,
 * so it is dropped unspent. `switch`: it is for someone else (or names nobody readable), so the
 * person is asked. Never switches silently: a forwarded or planted link would otherwise move them
 * into another account without their noticing.
 */
export function signedInGrantAction(grant: string, principalId: string): 'same' | 'switch' {
  return grantSubject(grant) === principalId ? 'same' : 'switch'
}
