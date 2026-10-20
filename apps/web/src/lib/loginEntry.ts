/**
 * Whether this document was opened on `/login` (the maintenance page's Admin sign-in link, sign-in
 * links). Captured at import, before router.tsx normalizes the path away, so maintenance can still
 * let an admin reach the sign-in form.
 */
export const openedOnLogin = typeof window !== 'undefined' && /^\/login(?:\/|$)/.test(window.location.pathname)
