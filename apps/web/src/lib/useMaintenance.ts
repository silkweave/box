import { useEffect, useState } from 'react'
import { whilePageActive } from './pageLifecycle.ts'

/** The web release this document was served from; absent under Vite and before the first release. */
const loadedRelease = (): string | null =>
  document.querySelector<HTMLMetaElement>('meta[name="box-web-release"]')?.content || null

/**
 * The supervisor's status stream. Existing member tabs enter maintenance too, without depending on
 * the restarting app's feeds, and a tab served from a release learns when a newer one is promoted.
 */
export function useBoxStatus(signedIn: boolean): { maintenance: boolean; updateAvailable: boolean } {
  const [maintenance, setMaintenance] = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  useEffect(() => {
    if (!signedIn) { setMaintenance(false); return }
    const loaded = loadedRelease()
    return whilePageActive(() => {
      let disposed = false
      let revision = 0
      let retry: ReturnType<typeof setTimeout> | undefined
      const events = new EventSource('/api/box-status/events')
      const apply = async (data: string, current: number): Promise<void> => {
        try {
          const status = JSON.parse(data) as { maintenance?: boolean; release?: string | null }
          if (typeof status.maintenance !== 'boolean') return
          if (loaded && typeof status.release === 'string' && !disposed) setUpdateAvailable(status.release !== loaded)
          let blocked = status.maintenance
          if (blocked) {
            const identity = await fetch('/api/auth/me', { signal: AbortSignal.timeout(3_000), cache: 'no-store' })
            const body = identity.ok ? await identity.json() as { principal?: { role?: string } } : null
            blocked = body?.principal?.role !== 'admin'
          }
          if (!disposed && current === revision) setMaintenance(blocked)
        } catch {
          // An app restart may interrupt the admin check while the supervisor stream stays open.
          if (!disposed && current === revision) retry = setTimeout(() => { void apply(data, current) }, 3_000)
        }
      }
      events.onmessage = event => {
        if (retry) clearTimeout(retry)
        void apply(event.data, ++revision)
      }
      return () => { disposed = true; if (retry) clearTimeout(retry); events.close() }
    })
  }, [signedIn])
  return { maintenance, updateAvailable }
}
