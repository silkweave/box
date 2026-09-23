import type { ComponentType, ReactNode } from 'react'
import { createRootRoute, Outlet } from '@tanstack/react-router'

/** The one root every feature's routes hang from. Its own file so features can import it without
 *  importing router.tsx (which imports the features - that would be a cycle at module load). */
// Root shell options are constructor-only in this router version. Inject the app-owned
// implementation during composition without importing its registry here.
let Layout: ComponentType<{ children: ReactNode }>
export function installRootLayout(component: typeof Layout) { Layout = component }
function RootShell({ children }: { children: ReactNode }) {
  return <Layout>{children}</Layout>
}
export const rootRoute = createRootRoute({ component: Outlet, shellComponent: RootShell })
