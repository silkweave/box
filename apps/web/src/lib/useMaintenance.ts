import { useEffect, useState } from 'react'
import { whilePageActive } from './pageLifecycle.ts'
import { openedOnLogin } from './loginEntry.ts'

/** The supervisor's maintenance page (apps/server/src/builder/maintenance.ts MAINTENANCE_PAGE_PATH). */
const MAINTENANCE_PAGE = '/api/box-status/page'

/** The web release this document was served from; absent under Vite and before the first release. */
const loadedRelease = (): string | null =>
  document.querySelector<HTMLMetaElement>('meta[name="box-web-release"]')?.content || null

/** Who is looking: unknown while the session probe runs, then signed out or signed in with a role. */
export type BoxStatusViewer = { loading: true } | { loading: false; role: 'admin' | 'member' | null }

/**
 * Whether maintenance keeps this viewer out. Admins pass unless the host locked them out too. A
 * signed-out tab passes only when opened on /login while admins are not locked out, so an admin can sign in.
 */
export function maintenanceBlocks(maintenance: boolean, lockAdmins: boolean, role: 'admin' | 'member' | null, onLogin: boolean): boolean {
  if (!maintenance) return false
  if (lockAdmins) return true
  if (role === 'admin') return false
  if (role === null) return !onLogin
  return true
}

/**
 * The supervisor's status stream, followed by every tab (signed in or not), so an open tab enters
 * maintenance without depending on the restarting app's feeds, and a tab served from a release
 * learns when a newer one is promoted. A blocked tab moves to the supervisor's maintenance page,
 * the same page a fresh visit gets, which brings it back here once maintenance ends.
 */
export function useBoxStatus(viewer: BoxStatusViewer): { known: boolean; maintenance: boolean; updateAvailable: boolean } {
  // False until the first status arrives (or a short wait passes), so the login view does not flash first.
  const [known, setKnown] = useState(false)
  const [maintenance, setMaintenance] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const role = viewer.loading ? undefined : viewer.role
  useEffect(() => {
    if (role === undefined) return
    const loaded = loadedRelease()
    return whilePageActive(() => {
      const events = new EventSource('/api/box-status/events')
      const fallback = setTimeout(() => setKnown(true), 1_500)
      events.onmessage = event => {
        clearTimeout(fallback)
        try {
          const status = JSON.parse(event.data) as { maintenance?: boolean; release?: string | null; notice?: { lockAdmins?: boolean } }
          if (typeof status.maintenance !== 'boolean') return
          if (loaded && role !== null && typeof status.release === 'string') setUpdateAvailable(status.release !== loaded)
          const blocked = maintenanceBlocks(status.maintenance, !!status.notice?.lockAdmins, role, openedOnLogin)
          setMaintenance(blocked)
          setKnown(true)
          if (blocked) {
            events.close()
            location.replace(`${MAINTENANCE_PAGE}?return=${encodeURIComponent(location.pathname + location.search + location.hash)}`)
          }
        } catch {
          // A malformed event is skipped; the next one carries the full state again.
          setKnown(true)
        }
      }
      return () => { clearTimeout(fallback); events.close() }
    })
  }, [role])
  return { known, maintenance, updateAvailable }
}
