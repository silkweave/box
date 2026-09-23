import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { setActiveUser } from './useActiveUser.ts'

// Client auth state. Probes GET /api/auth/me on mount; no principal means the login gate. The
// authenticated principal drives the active-user scope (its id stamps `actor` on mutations) and
// supplies the coarse role needed for admin-only surfaces. See docs/AUTH.md.

export interface Principal {
  id: string
  display: string
  role?: 'admin' | 'member'
}

interface AuthState {
  loading: boolean
  principal: Principal | null
  agent: { id: string; name: string; role: 'admin' | 'member' } | null
  /** The public first-run signal. Creating the owner remains a host-only CLI operation. */
  needsOwner: boolean
  login: (token: string) => Promise<{ ok: boolean; error?: string }>
  /** Spend a short-lived sign-in grant from a `?link=` URL. See LoginView. */
  loginWithLink: (grant: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  refetch: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [principal, setPrincipal] = useState<Principal | null>(null)
  const [agent, setAgent] = useState<AuthState['agent']>(null)
  const [needsOwner, setNeedsOwner] = useState(false)

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' })
      const data = (await res.json()) as { principal: Principal | null; agent: AuthState['agent']; needsOwner?: boolean }
      setPrincipal(data.principal)
      setAgent(data.agent)
      setNeedsOwner(data.needsOwner === true)
      // The authenticated principal IS the active user (locks the actor to who is signed in).
      if (data.principal) setActiveUser(data.principal.id)
    } catch {
      setPrincipal(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refetch()
  }, [refetch])

  const login = useCallback(
    async (token: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-box-csrf': '1' },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string }
        return { ok: false, error: body.message ?? 'invalid access token' }
      }
      await refetch()
      return { ok: true }
    },
    [refetch],
  )

  const loginWithLink = useCallback(
    async (grant: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await fetch('/api/auth/link', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-box-csrf': '1' },
        body: JSON.stringify({ grant }),
      })
      if (!res.ok) {
        // Idempotency for the SAME browser. A double-click, a form resubmit or a prefetch can spend
        // the grant on the first request and fail on the second - at which point the person IS
        // signed in and must not be shown "already used". Ask who we are before believing the error.
        await refetch()
        const probe = await fetch('/api/auth/me', { credentials: 'same-origin' })
          .then((r) => r.json() as Promise<{ principal: Principal | null }>)
          .catch(() => ({ principal: null }))
        if (probe.principal) return { ok: true }

        const body = (await res.json().catch(() => ({}))) as { message?: string }
        return { ok: false, error: body.message ?? 'invalid' }
      }
      await refetch()
      return { ok: true }
    },
    [refetch],
  )

  const logout = useCallback(async (): Promise<void> => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'x-box-csrf': '1' },
    })
    setPrincipal(null)
    setActiveUser(null)
    await refetch()
  }, [refetch])

  return (
    <AuthContext.Provider value={{ loading, principal, agent, needsOwner, login, loginWithLink, logout, refetch }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
