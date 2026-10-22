import { createBrowserHistory, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { AppLayout } from './components/AppLayout.tsx'
import { CenteredNote } from '@silkweave/box-ui'
import { rootRoute, installRootLayout } from './router-root.tsx'
import { ALL_WEB_ROUTES } from './web-features.ts'
import { HomeView } from './views/HomeView.tsx'
import { RecipeGalleryView } from './views/RecipeGalleryView.tsx'
import { captureReturnPath } from './lib/returnPath.ts'
// Must evaluate before the /login normalization below (imports run first).
import './lib/loginEntry.ts'

// The route tree is core's routes plus whatever the present features contribute. Every path
// segment is real (`/crm/$id`, `/sink/$file`) so links are shareable and the back button
// works; features keep their own sub-trees and any redirects they owe their history.

// Dashboard is the default landing page, including a Box with no optional features.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeView,
  staticData: { shellGroup: 'home' },
})

// The Recipe Gallery (Work menu). Core-owned, so it outlives the onboarding dashboard.
const recipesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recipes',
  component: RecipeGalleryView,
  staticData: { shellGroup: 'recipes' },
})

// Preserve bookmarked settings URLs as dialog links over the dashboard.
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  beforeLoad: ({ location }) => {
    const path = location.pathname.slice('/settings'.length).replace(/^\//, '')
    throw redirect({ to: '/', hash: `settings/${path || 'profile'}`, replace: true })
  },
})
const settingsSectionRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '$',
})

const builderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/builder',
  beforeLoad: () => { window.location.replace('/builder'); },
  component: () => null,
})

// Keep composition here: router-root must not eagerly import the feature registry.
installRootLayout(AppLayout)
rootRoute.update({
  notFoundComponent: () => <CenteredNote>Page not found.</CenteredNote>,
  errorComponent: () => <CenteredNote>Unable to load this page. Navigate to another section or reload.</CenteredNote>,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  recipesRoute,
  builderRoute,
  settingsRoute.addChildren([settingsSectionRoute]),
  ...ALL_WEB_ROUTES,
])

// Legacy hash links (`/#/crm/acme`, `/#/chat/general`) predate browser history (2026-09-14) and are
// immortal: they sit in bookmarks, in agent transcripts and in every AGENT.md that was ever read.
// Rewrite them to the real path BEFORE createBrowserHistory() snapshots `location`, so the router
// never sees the hash at all. replaceState, so Back does not bounce into the old URL.
if (typeof window !== 'undefined') {
  if (window.location.hash.startsWith('#/')) {
    window.history.replaceState(null, '', window.location.hash.slice(1))
  }
  // `/login/<grant>` is where sign-in links point (see auth/app-url.ts) and `/login?e=...` is where a
  // retired old-style link is redirected (`?e=retired`). It is NOT a client route - the auth gate in
  // App.tsx renders LoginView ahead of the router, on any path - so under hash routing the path was
  // ignored. Under browser history the router WOULD see it once the user signs in and the gate
  // mounts, and 404. Normalize it away here instead of inventing a route for it.
  //
  // Convert the path envelope into transient query state before the router snapshots the URL.
  // LoginView reads and immediately scrubs it. This keeps the public URL clean without making the
  // credential a client route or letting a GET consume it.
  if (window.location.pathname === '/login' || window.location.pathname.startsWith('/login/')) {
    const pathGrant = window.location.pathname.slice('/login/'.length)
    const params = new URLSearchParams(window.location.search)
    if (pathGrant) {
      try { params.set('link', decodeURIComponent(pathGrant)) } catch { params.set('link', pathGrant) }
    }
    const query = params.toString()
    window.history.replaceState(null, '', `/${query ? `?${query}` : ''}`)
  }
}

// A server path mount's sign-in return (lib/returnPath.ts); must run before history snapshots.
captureReturnPath()

// Browser history, not hash: deep links are real paths (`/crm/acme`, `/chat/general`). It costs no
// server work because both topologies already fall back to index.html - Nest's ServeStaticModule
// catch-all in prod (app.module.ts, whose `exclude` list is the contract) and Vite's SPA fallback
// behind main.ts's dev proxy. The price is that the SPA now SHARES one URL namespace with the
// server, which hash routing never did. A top-level client route may NOT collide with:
//   - the reserved prefixes: /api, /trpc, /mcp, /agent (`RESERVED` in apps/server/src/main.ts and
//     the `exclude` list in app.module.ts are the two spellings of the same set);
//   - a real file the SPA ships: /assets/* and everything under apps/web/public (/manifest.webmanifest,
//     /push-icon.png, /apple-touch-icon.png, /app-icon-512.png);
//   - what Vite owns in dev: /src, /node_modules, /@vite, /@fs, /@id.
//   - a server path mount's subtree (core path-mounts.ts): `/artifacts/<slug>/` is served by the
//     server, so only the bare `/artifacts` may be a client route.
// Checked by hand against every feature's routes.tsx plus core's /settings: no collision. Core's /recipes (2026-10-02) is not a served path either: recipes/ reaches the SPA
// only through import.meta.glob. A feature that adds a top-level route must re-check; nothing in `box verify` does.
export const router = createRouter({ routeTree, history: createBrowserHistory() })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
