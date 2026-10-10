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
  // Start the live-refresh feed (lib/changeFeed.ts) once a session is established - the SSE
  // subscription would just 401 before that. Idempotent, so re-renders are free. Each feature's
  // `onSession` (a chat feed, a notification poller, a push-click listener) starts on the same gate.
  const { maintenance, updateAvailable } = useBoxStatus(!loading && !!principal)
  const startFeed = !loading && !!principal && !maintenance
  useEffect(() => {
    if (!startFeed) return
    startChangeFeed()
    const teardowns = ALL_WEB_FEATURES.map((f) => f.onSession?.()).filter((t): t is () => void => typeof t === 'function')
    return () => teardowns.forEach((t) => t())
  }, [startFeed])
  if (loading) return <div className='h-dvh w-full bg-bg' />
  if (!principal) return <LoginView />
  // Back to a server-served path mount (`/artifacts/<slug>/`) that sent this browser to sign in.
  if (followReturnPath()) return <div className='h-dvh w-full bg-bg' />
  if (maintenance) return (
    <main className='grid min-h-dvh place-items-center bg-bg px-6 text-text'>
      <div className='max-w-md text-center'>
        <img src={brand.logoUrl.startsWith('/builder-assets/') ? brand.logoUrl : `/builder-assets${brand.logoUrl}`} alt='' className='mx-auto mb-8 h-14 w-14' />
        <p className='text-xs font-medium uppercase tracking-[0.2em] text-primary'>Maintenance</p>
        <h1 className='mt-4 text-3xl font-semibold tracking-tight'>A little work. A better Box.</h1>
        <p className='mt-4 leading-relaxed text-muted-foreground'>Your team is making an update. We’ll bring you back automatically when your Box is ready.</p>
        <div className='mx-auto mt-8 h-1 w-20 animate-pulse rounded-full bg-gradient-to-r from-primary/20 via-primary to-primary/20' />
      </div>
    </main>
  )
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
