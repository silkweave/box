import { useEffect, useState } from 'react'
import { whilePageActive } from './pageLifecycle.ts'

/** Existing member tabs enter maintenance too, without depending on the restarting app's feeds. */
export function useMaintenance(signedIn: boolean): boolean {
  const [maintenance, setMaintenance] = useState(false)
  useEffect(() => {
    if (!signedIn) { setMaintenance(false); return }
    return whilePageActive(() => {
      let disposed = false
      let revision = 0
      let retry: ReturnType<typeof setTimeout> | undefined
      const events = new EventSource('/api/box-status/events')
      const apply = async (data: string, current: number): Promise<void> => {
        try {
          const status = JSON.parse(data) as { maintenance?: boolean }
          if (typeof status.maintenance !== 'boolean') return
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
  return maintenance
}
