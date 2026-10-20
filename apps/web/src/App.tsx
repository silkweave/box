// Baked in at build time by apps/web/branding.ts from `box.json` (typed in vite-env.d.ts).
import brand from 'virtual:box-brand'
import { useEffect, type ReactNode } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router.tsx'
import { startChangeFeed } from './lib/changeFeed.ts'
import { AuthProvider, useAuth } from './lib/useAuth.tsx'
import { ALL_WEB_FEATURES } from './web-features.ts'
import { BrandProvider, UsersProvider } from '@silkweave/box-ui'
import { useUsersData } from './lib/useUsersData.ts'
import { LoginView } from './views/LoginView.tsx'
import { AppShellExtensions } from './lib/shell.tsx'
import { BuilderPreviewBridge } from './lib/BuilderPreviewBridge.tsx'
import { useBoxStatus } from './lib/useMaintenance.ts'
import { Button } from '@silkweave/box-ui'
import { followReturnPath } from './lib/returnPath.ts'

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
  // Every tab follows maintenance, signed in or not; a blocked tab moves to the supervisor's page.
  const { known, maintenance, updateAvailable } = useBoxStatus(loading ? { loading: true } : { loading: false, role: principal ? principal.role ?? 'member' : null })
  // Start the live-refresh feed (lib/changeFeed.ts) once a session is established - the SSE
  // subscription would just 401 before that. Idempotent, so re-renders are free. Each feature's
  // `onSession` (a chat feed, a notification poller, a push-click listener) starts on the same gate.
  const startFeed = !loading && !!principal && !maintenance
  useEffect(() => {
    if (!startFeed) return
    startChangeFeed()
    const teardowns = ALL_WEB_FEATURES.map((f) => f.onSession?.()).filter((t): t is () => void => typeof t === 'function')
    return () => teardowns.forEach((t) => t())
  }, [startFeed])
  // Blocked by maintenance: the tab is on its way to the supervisor's maintenance page.
  if (loading || maintenance) return <div className='h-dvh w-full bg-bg' />
  if (!principal) return known ? <LoginView /> : <div className='h-dvh w-full bg-bg' />
  // Back to a server-served path mount (`/artifacts/<slug>/`) that sent this browser to sign in.
  if (followReturnPath()) return <div className='h-dvh w-full bg-bg' />
  return (
    <AppUsers>
      {principal.role === 'admin' && <BuilderPreviewBridge />}
      <AppShellExtensions>
        <RouterProvider router={router} />
      </AppShellExtensions>
      {updateAvailable && <UpdateNotice />}
    </AppUsers>
  )
}

/** A newer web release was promoted. Never reloads by itself: the user may be mid-edit. */
function UpdateNotice() {
  return (
    <div role='status' className='fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-surface py-1.5 pl-4 pr-1.5 text-body-sm text-text shadow-lg'>
      <span>A new version of this Box is available.</span>
      <Button size='sm' onClick={() => location.reload()}>Reload</Button>
    </div>
  )
}

export function App() {
  return (
    <BrandProvider value={brand}>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </BrandProvider>
  )
}
