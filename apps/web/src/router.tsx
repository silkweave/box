import { createBrowserHistory, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { rootRoute } from './router-root.tsx'
import { WEB_ROUTES } from './generated/features.ts'
import { appEntries, homePath } from './lib/nav.ts'
import { HomeView } from './views/HomeView.tsx'
import { SettingsView } from './views/SettingsView.tsx'

// The route tree is core's two routes plus whatever the present features contribute. Every path
// segment is real (`/crm/$id`, `/settings/$section`) so links are shareable and the back button
// works; features keep their own sub-trees and any redirects they owe their history.

// `/` is the app dashboard (HomeView), not a redirect into whichever feature sorted first.
// The one exception is a Box with NO apps: an empty grid is not a landing page, so it still
// redirects to homePath() - which on a featureless Box is Settings. Both calls read the generated
// registry, and beforeLoad runs at navigation time rather than at module evaluation, so neither is
// on the module-scope path that white-screens the SPA (see HomeView).
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    if (appEntries().length === 0) throw redirect({ to: homePath() as never })
  },
  component: HomeView,
})

// Settings: one stateful view that reads the active section from the `$section` param; the child
// route only registers the path segment. Sections come from core + every feature's `settings`.
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsView,
})
const settingsSectionRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '$section',
  component: () => null,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  settingsRoute.addChildren([settingsSectionRoute]),
  ...WEB_ROUTES,
])

// Legacy hash links (`/#/crm/acme`, `/#/chat/general`) predate browser history (2026-09-14) and are
// immortal: they sit in bookmarks, in agent transcripts and in every AGENT.md that was ever read.
// Rewrite them to the real path BEFORE createBrowserHistory() snapshots `location`, so the router
// never sees the hash at all. replaceState, so Back does not bounce into the old URL.
if (typeof window !== 'undefined') {
  if (window.location.hash.startsWith('#/')) {
    window.history.replaceState(null, '', window.location.hash.slice(1))
  }
  // `/login` is where sign-in links point (`?link=<grant>`, see auth/app-url.ts) and where a
  // retired old-style link is redirected (`?e=retired`). It is NOT a client route - the auth gate in
  // App.tsx renders LoginView ahead of the router, on any path - so under hash routing the path was
  // ignored. Under browser history the router WOULD see it once the user signs in and the gate
  // mounts, and 404. Normalize it away here instead of inventing a route for it.
  //
  // THE QUERY MUST SURVIVE: it carries the grant. LoginView reads it on mount and scrubs it itself.
  if (window.location.pathname === '/login') {
    window.history.replaceState(null, '', '/' + window.location.search)
  }
}

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
// Checked by hand on 2026-09-14 against every feature's routes.tsx (alerts, automation, chat,
// content, crm, signals, boards, engagement, initiatives, sprints, sink) plus core's /settings:
// no collision. A feature that adds a top-level route must re-check; nothing in `box verify` does.
export const router = createRouter({ routeTree, history: createBrowserHistory() })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
