// Baked in at build time by apps/web/branding.ts from `box.json` (typed in vite-env.d.ts).
import brand from 'virtual:box-brand'
import { useEffect, type ReactNode } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router.tsx'
import { startChangeFeed } from './lib/changeFeed.ts'
import { AuthProvider, useAuth } from './lib/useAuth.tsx'
import { WEB_FEATURE_LIST } from './generated/features.ts'
import { BrandProvider, ConfirmHost, UsersProvider } from '@silkweave/box-ui'
import { useUsersData } from './lib/useUsersData.ts'
import { LoginView } from './views/LoginView.tsx'
import { AppShellExtensions } from './lib/shell.tsx'

/**
 * Fills the library's users directory (@silkweave/box-ui `UsersProvider`) from this app's store, so
 * every avatar, owner chip and assignee picker in the library can read it without importing tRPC.
 * Mounted INSIDE the auth gate: useUsersData fetches over tRPC and would just 401 before a session
 * exists.
 */
function AppUsers({ children }: { children: ReactNode }) {
  const { data } = useUsersData()
  return <UsersProvider users={data}>{children}</UsersProvider>
}

// Auth gate: probe /api/auth/me, then render login or the app. Everyone signed in sees the same
// app. See docs/AUTH.md.
function AuthGate() {
  const { loading, principal } = useAuth()
  // Start the live-refresh feed (lib/changeFeed.ts) once a session is established - the SSE
  // subscription would just 401 before that. Idempotent, so re-renders are free. Each feature's
  // `onSession` (a chat feed, a notification poller, a push-click listener) starts on the same gate.
  const startFeed = !loading && !!principal
  useEffect(() => {
    if (!startFeed) return
    startChangeFeed()
    const teardowns = WEB_FEATURE_LIST.map((f) => f.onSession?.()).filter((t): t is () => void => typeof t === 'function')
    return () => teardowns.forEach((t) => t())
  }, [startFeed])
  if (loading) return <div className='h-dvh w-full bg-bg' />
  if (!principal) return <LoginView />
  return (
    <AppUsers>
      <AppShellExtensions>
        <RouterProvider router={router} />
      </AppShellExtensions>
    </AppUsers>
  )
}

export function App() {
  return (
    <BrandProvider value={brand}>
      <AuthProvider>
        <AuthGate />
        <ConfirmHost />
      </AuthProvider>
    </BrandProvider>
  )
}
