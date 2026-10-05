// The sign-in return path. A server-served path mount (core port, packages/core/src/path-mounts.ts,
// e.g. `/artifacts/<slug>/`) sends a browser without a session to `/?next=<path>`. The SPA renders
// the sign-in gate on any path, so after sign-in it must leave the SPA again with a full navigation:
// the target is not a client route. Captured and scrubbed before the router snapshots the URL, and
// kept in sessionStorage (this tab only) so it survives opening a sign-in link in the same tab.

const KEY = 'box:return-path'
const store = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** Only same-origin absolute paths: `/x`, never `//host` or `/\host`. */
export function safeReturnPath(raw: string | null): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null
  return raw
}

export function captureReturnPath(): void {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  if (!params.has('next')) return
  const next = safeReturnPath(params.get('next'))
  if (next) store()?.setItem(KEY, next)
  params.delete('next')
  const query = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
}

/** Leave for the captured path once a session exists. Returns true when navigating away. */
export function followReturnPath(): boolean {
  const target = safeReturnPath(store()?.getItem(KEY) ?? null)
  if (!target) return false
  store()?.removeItem(KEY)
  window.location.replace(target)
  return true
}
