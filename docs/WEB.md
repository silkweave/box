# apps/web - the Box SPA

`@silkweave/box-web` is the React/Vite single-page app a Box serves. It holds **no data of its
own**: everything it renders arrives live over tRPC from `apps/server`, and everything it draws with
comes from `@silkweave/box-ui`. What is left in this package is the part that is genuinely the
app's: the auth gate, the router, the feature registry, the data-store/change-feed layer, and the
agent panel.

This file describes **core's** web app - what a Box has with zero features installed. A feature's
screens are documented in its own `features/<id>/SPEC.md`.

Related reading: [`../packages/ui/README.md`](../packages/ui/README.md) (the component library),
[`docs/core/SEAM.md`](./core/SEAM.md) § 5 (the web half of the composition seam),
[`FEATURES.md`](FEATURES.md) (what a feature is), [`AUTH.md`](./AUTH.md).

---

## Run

```bash
bun install                              # from the repo root (the bun run workspace)
box dev                                  # turbo run dev: Nest on :8190 + Vite on :5190
bun run --filter @silkweave/box-ui storybook       # the component library on its own, :6006
```

**Point the browser at :8190, never at :5190.** Nest is the single origin. Both ports come from
`box.json` (`server.port` 8190, `server.vitePort` 5190). Per-Box overrides belong in the
gitignored `box.local.json`. In dev `box dev` starts the server with `--dev`, so it builds the Vite URL
from that port itself, and `apps/server/src/main.ts` registers a reverse proxy ahead of Nest's
router that forwards every path NOT matching
`/^\/(api|trpc|mcp|agent)(\/|$)/` to Vite, HMR websockets included. So the SPA is same-origin with
the API in dev and in prod alike: the tRPC client uses relative URLs, there is no `VITE_API_URL` and
no CORS anywhere. In prod there is no `--dev` flag, so Nest's `ServeStaticModule` serves the built
bundle (`box build` -> `apps/web/dist`) beside `/trpc` and `/mcp` on the one port.

Hitting the bare Vite port still works - `apps/web/vite.config.ts` carries a reciprocal proxy for
`/trpc`, `/mcp` and `/api` back to the server - but it is a fallback, not the supported path.

A second Box uses distinct port values in its gitignored `box.local.json`. Pick the port deliberately: a Box that
lands beside another service on the same number, or on the other address family of the same
number, so keep each Box's configured ports distinct.

Vite's `server.allowedHosts` carries `.ts.net` because Nest proxies with `changeOrigin: false`: the
original Host reaches Vite, and over tailscale that Host is the tailnet name, which Vite's host
check would otherwise answer with a blank page and "Blocked request" in the console. It is allowed
by suffix rather than with `true` - a dev server that trusts every Host is the DNS-rebinding hole
the check exists to close.

## Two packages, one app

| | `@silkweave/box-ui` (`packages/ui`) | `@silkweave/box-web` (`apps/web`) |
|---|---|---|
| Holds | tokens, stylesheets, primitives, the app shell, users, the markdown editor | routes, the feature registry, tRPC, auth, data stores, the agent panel |
| May import | React and its own stylesheet. Nothing else | anything |
| Proven by | Storybook - a component without a story is not in the library | `box verify` + loading the app |

**There is no build step for the library.** Both consumers (this app and Storybook) resolve the
`@silkweave/box-source` export condition straight to `src/`, so an edit in `packages/ui` is live
here with no rebuild. `apps/web/vite.config.ts` prepends that condition to Vite's client
conditions.

If a component can render with nothing but React and the library stylesheet, it belongs in
`packages/ui` and needs a story. If it needs tRPC, the session, the registry or the agent host, it
is an app component and belongs here (or in a feature).

That test is necessary and not sufficient, and the gap is where this app's `lib/` adapters come
from: **a library component may not compose English about the domain, decide when it is pointless
to render, or own a storage key** - all three pass a type-check. `src/lib/showAll.tsx`,
`channelIcons.tsx`, `tags.tsx` and `runLog.tsx` are the policy that came back out of the library on
each pairing an abstract component with this Box's vocabulary.

**The app fills three seams the library declares** - `ShellExtensionsProvider` (the top-bar cluster
and the aside panel), `UsersProvider` (the user directory as data), and `DocEditor`'s controlled
`doc` prop. The library never reaches back. The table of what crosses each one and why is in
[`../packages/ui/README.md`](../packages/ui/README.md) § The seams; this app's halves are
`src/lib/shell.tsx`, the `AppUsers` wrapper in `src/App.tsx`, and `src/components/DocEditor.tsx`.
`src/lib/userMenu.tsx` is the fourth, prop-shaped: `AccountMenu` takes who is signed in, what
sign-out does and where the active user is persisted, because all three are policy the library
should hold no opinion about. The "Only my items" filter is rendered into its `extra` slot from
here too - it is one app's feature, and it used to be `filterMine` props on the library component.

Two files here are aliases, not rivals: `src/lib/utils.ts` re-exports `cn` and
`src/lib/usePersistedState.ts` re-exports the persisted-state hook, both from
`@silkweave/box-ui/lib`. `cn` must exist exactly once in a running app - its tailwind-merge config is
tied to the `@theme` font-size scale in the library's `tokens.css`, and a second copy silently drops
sizes.

`src/styles/app.css` is the whole of this app's styling: it imports the library's
`styles/globals.css`, then `agent.css` (the workerdeck token bridge), then `@source '../'` so
Tailwind scans this app's sources.

## The shell, the router, Settings

| File | What |
|---|---|
| `src/main.tsx` | `applyTheme()`, then mount `<App />` into `#root` |
| `src/App.tsx` | `AuthProvider` -> auth gate -> `AppUsers` -> `AppShellExtensions` -> `RouterProvider` |
| `src/router-root.tsx` | dependency-light `rootRoute`, with the injected root shell component |
| `src/router.tsx` | injects `AppLayout`, then composes core's two routes + `WEB_ROUTES`, browser history, the legacy `#/` rewrite (see Routing below) |
| `src/components/AppLayout.tsx` | the one persistent `AppShell`, route outlet, active group navigation, and safe fallback chrome |
| `src/lib/routeShell.tsx` | `shellGroup` route metadata and the `RouteChrome` writer used by section layouts |
| `src/lib/nav.ts` | the sidebar groups, `navEntries()`, `useGroupNav()` |
| `src/lib/shell.tsx` | this app's `ShellExtensions` value: top-bar slots, user menu, agent panel |
| `src/views/HomeView.tsx` | the Dashboard placeholder at `/` |
| `src/views/SettingsView.tsx` | the Settings shell and core's two sections |

**`rootRoute` lives in its own file** so a feature's routes can import it without importing
`router.tsx`, which imports the features - that would be a cycle at module load.

The authenticated router mounts one `AppLayout` for its lifetime. That layout owns the single
`AppShell`; section layouts publish their current secondary items, selection callback, breadcrumbs,
actions, and optional group action through `RouteChrome`. A section route declares
`staticData: { shellGroup: '<nav id>' }`, and descendants inherit the deepest matching section.
The host uses this static identity to show the destination's group and fallback breadcrumb before
its data loads. A published descriptor is accepted only for the current section and committed
location, so delayed cleanup or a slow previous route cannot restore stale actions.

Feature layouts keep their providers, dialogs, and routed content inside `RouteChrome`. They must
publish one complete descriptor per section owner. Leaves that only add a top-bar portal continue
to use `TopBarActions` or `TopBarCenter`; global controls belong to the separate feature manifest
`shell.topbar` seam. Route changes retain the sidebar, top bar, portal targets, and Assistant while
the shell resets its drawer and section-level main scroll through its navigation lifecycle keys.
`RouteChrome` writers receive a stable controller and do not subscribe to its snapshots, which
prevents a publication loop. Descriptor React nodes render under the shell host, so route-local
context-dependent controls use the existing portals or receive their state explicitly. The routed
body still unmounts normally; the persistent shell does not cache inactive routes.

`router.tsx` owns the dashboard, the Builder boundary, and legacy Settings redirects; features
contribute `WEB_ROUTES`. Application pages use browser history and survive refresh through the
server's `index.html` fallback. Settings uses the hash so the application page stays mounted.

`navEntries()` reads feature navigation lazily and includes core's Dashboard entry.
`useGroupNav()` organizes them using this Box's `SIDEBAR_SECTIONS` in `src/lib/nav.ts`:

| Section | Destinations |
| --- | --- |
| Workspace | Dashboard, Chat, Artifacts, Sink |
| Reporting | Signals, Circuit Boards |
| Operations | Initiatives, Sprints, Reminders |
| Sales | Accounts |
| Marketing | Content, Engagement |

Absent features create no empty headings; additional unassigned entries appear under Other.
The UI library accepts optional `NavGroup.section` labels and renders a heading when the section
changes. Selecting a group navigates to its overview and automatically shows its sub-navigation
in a rounded panel with a solid header. `--sidebar-primary` controls the header fill and the
lower-opacity sub-item hover (10%) and selected (18%) fills in both themes;
`--sidebar-primary-text` controls the header foreground. Override these tokens in theme CSS.
Groups use the 12px `--radius-lg`, buttons the 8px `--radius-md`, with uniform 4px panel
padding and row gaps and 12px horizontal button padding. Every group reserves the same
padding and 1px border, including closed groups and standalone destinations, so activating
a header does not shift its icon or label. Navigation has no chevrons or selection stripes;
selected sub-items use a tinted background. `expandable: false` suppresses sub-navigation for
standalone destinations, including Dashboard and Artifacts.

**`/` is Dashboard** (`HomeView`). A new Box uses it as a temporary onboarding workspace: it reads
the compiled feature registry and the Builder supervisor's provider readiness, then routes an
administrator through provider setup, a first feature integration and replacement of the onboarding
view with the Box's real dashboard. Progress is derived from live state rather than stored as an
onboarding ledger. Members see the installed state but not Builder actions.
Artifacts is a web-only placeholder feature at `/artifacts`. Accounts is the display name for the
CRM workspace; its `/crm` routes, feature identity and stored records retain their existing names.

Navigation reads the generated registry inside component calls, never at module scope, because
feature views participate in a registry import cycle (`docs/core/SEAM.md` § 5.4).

`SettingsDialogHost` in `views/SettingsView.tsx` mounts once beside the persistent shell.
Core owns Profile (order 0, the default) and Users (100); features contribute ordered sections
through `settings`. Missing or unknown sections fall back to Profile. The footer shows Settings,
theme, and collapse controls in a row, or vertically when collapsed. Automation and Alerts live
inside Settings and have no main-sidebar entries.

Use `useSettingsDialog().open('initiative-kinds')` from an application page to open that section
without changing the pathname, query filters, or page scroll. Links use `to='.'`, `search={true}`,
`hash='settings/initiative-kinds'`, `resetScroll={false}`, and `hashScrollIntoView={false}`.
Sections receive the remaining path as `render(params: string[])`. Examples:

- `/initiatives#settings/initiative-kinds`
- `/initiatives#settings/users/new` or `#settings/users/<id>`
- `#settings/automation/schedules`, `#settings/automation/actions`, `#settings/automation/runs/<id>`
- `#settings/alerts/rules` and `#settings/alerts/feed`

Section and sub-page navigation participates in browser history. Closing clears the hash with a
replace navigation; the page behind the dialog stays mounted. Legacy `/settings/<section>`,
`/automation/...`, and `/alerts` URLs redirect to the corresponding dialog over Dashboard.
Old `schedules` and `rules` Settings identifiers remain valid aliases.

Settings wraps its content in the UI library's `InlineDialogScope`. Editors use `InlineDialog`,
`InlineDialogContent`, `InlineDialogTitle`, and `InlineDialogDescription`: they replace the pane
with a Back action while preserving the underlying list. Outside that scope they retain normal
dialog behavior, so shared editors still work on application pages. Confirmations use the same
pane; leaving the section cancels pending confirmations. Keep new Settings editors in this scope
instead of adding another modal. Profile edits stay inline and include sign-out.

## Routing - real paths, no server work

Deep links are plain paths: `http://localhost:8190/crm/acme`, `/chat/general`,
`/initiatives/<slug>/<task>`. The SPA uses `createBrowserHistory()` and the server fallback serves
`index.html` for application paths.

Moving to `createBrowserHistory()` needed **no server change and no SSR**, because the SPA fallback
both topologies need already existed:

- **Prod:** `ServeStaticModule` (`apps/server/src/app.module.ts`) registers express-static plus a
  `{*any}` catch-all that sends `index.html`. Its `exclude` list is the contract - `/api`, `/trpc`,
  `/mcp`, `/agent` so they 404 as JSON, and `/assets/{*path}` so a **stale hashed chunk** requested
  by a tab loaded before a deploy 404s honestly instead of coming back as `index.html` with
  `content-type: text/html` (which the browser reports as an unreadable module parse error).
- **Dev:** `main.ts` proxies every non-`RESERVED` path to Vite, whose `appType: 'spa'` default
  serves `index.html` for unknown paths. HMR is unaffected.

Two consequences worth holding on to:

1. **The URL namespace is shared with the server now.** A top-level client route may not collide
   with the reserved prefixes (`/api`, `/trpc`, `/mcp`, `/agent` - `RESERVED` in `main.ts` and the
   `exclude` list in `app.module.ts` are two spellings of one set), with a real file the SPA ships
   (`/assets/*`, `/manifest.webmanifest`, `/push-icon.png`, `/apple-touch-icon.png`,
   `/app-icon-512.png`), or with what Vite owns in dev (`/src`, `/node_modules`, `/@vite`, `/@fs`).
   A name clash is a silent break, so a feature that adds a route must check its path against these
   reserved prefixes and public files.
2. **Legacy `/#/...` links still work.** `router.tsx` rewrites `#/<path>` to `/<path>` with
   `replaceState` before `createBrowserHistory()` snapshots `location`. It also moves a grant from
   `/login/<grant>` into transient query state and normalizes the path to `/`. `/login` is not a
   client route: the auth gate renders `LoginView` on any path, and the grant is scrubbed from the
   visible URL after the login view reads it. `box auth token` and `box auth reveal` print the root.

An `<a href='/'>` is now a full document reload, not a route change - the sidebar wordmark links
through the shell seam's `homeLink`, which this app fills with TanStack's `<Link to='/'>` in
`lib/shell.tsx` (the library's default is a plain anchor, because `packages/ui` may not import a
router). The push chain moved with it: web push carries `url: '/chat/<slug>'`, and the service
worker's "never push to the room you are looking at" check reads `pathname`, not `hash`. **A service
worker and the notifications it has shown are cached on the client**, so a click on a notification
delivered before the change still posts `/#/chat/<slug>`, so the notifications app's
`listenPushNavigate()` accepts both spellings on purpose. If you integrate a feature that shows
notifications, it inherits this problem and this answer.

## The feature registry, and the ports a feature fills

`src/feature.ts` is the web-side contract. A feature is a directory under `features/<id>/web/` whose
`index.tsx` default-exports one `defineWebFeature({...})`. `src/generated/features.ts`, maintained alongside the feature source, is the **only file outside the feature that names it**.

```ts
export const WEB_FEATURES = [alerts, automation, ...] as const satisfies readonly WebFeature[]
export const WEB_FEATURE_LIST: readonly WebFeature[] = WEB_FEATURES   // widened, for port readers
export const WEB_ROUTES = [...alerts.routes, ...automation.routes, ...] as const
```

`WEB_ROUTES` is spread explicitly rather than flat-mapped on purpose: a `flatMap` over a tuple of
tuples infers `unknown[]` and every typed `<Link to=...>` in the app goes dark.

`defineWebFeature` takes a `const` type parameter so each feature's route tuple survives into
`typeof router`.

| Port | Read by | A real example |
|---|---|---|
| `routes` | `router.tsx` | `sink`: `routes.tsx` builds `/sink` with a `$file` child off `rootRoute` and exports `sinkRoutes` |
| `nav` | `lib/nav.ts` | `planning` contributes two groups: Initiatives (order 200) and Sprints (210) |
| `settings` | `views/SettingsView.tsx` | `automation`: `{ id: 'automation', label: 'Automation', order: 800, render: (params) => <AutomationSettings params={params} /> }` |
| `shell.topbar` | `lib/shell.tsx` | `automation`'s `RestartRequiredButton` at order 100, `notifications`' `NotificationBell` at 200 |
| `onSession` | `App.tsx`'s auth gate | `notifications` starts its poller and returns `listenPushNavigate(...)` as the teardown |
| `slots` | `lib/slots.ts` | `engagement` contributes `PodEngagementPanel` to content's `content.piece.panel` slot |
| `docs` | `lib/useDoc.ts` | `sink` provides kind `sink`; `planning` provides `initiative` and `task` |

**`slots` and `docs` are the web form of "the dependent registers into the dependency."** The owner
of a slot names it and types the props it renders with (`content.piece.panel` renders `{ piece }`);
contributors match that shape and never edit the owner. `slotComponents<P>(name)` returns every
contribution in feature order.

`docs` exists because of a concrete break: `useDoc` named `trpc.planningDoc`, `trpc.sinkDoc` and
`useDoc` resolves a `kind`
through the registry and names no procedure itself; a `kind` no present feature provides resolves to
`error`, which is the same verdict a failed read gets, because to a reader it is the same thing: the
doc is not there.

`onSession` runs once a session exists and returns its own teardown - the auth gate collects them
and calls them when the session goes away.

Adding or removing a feature: update its maintained registration and routes, then run `box verify`.

---

## The TDZ rule: never read the registry at module scope

> **`src/generated/features.ts` sits on an import cycle with every view**
> (view -> `lib/nav.ts` -> `generated/features.ts` -> a feature's `index.tsx` -> that view).
> A module on that cycle that touches `WEB_FEATURES` / `WEB_FEATURE_LIST` / `WEB_ROUTES` **at module
> scope** runs while the binding is still in its temporal dead zone and throws
> `Cannot access 'WEB_FEATURE_LIST' before initialization` at load. Not a broken view: a **white
> screen, the whole app**.

**`box verify` cannot detect a module-scope registry read at runtime.** Load the app in a browser.

The rule: **read a registry lazily, inside a function, and cache the result.** Four core modules do
this, and they are the pattern to copy:

```ts
// lib/shell.tsx
let cachedTopbar: ComponentType[] | undefined
function topbarComponents(): ComponentType[] {
  cachedTopbar ??= WEB_FEATURE_LIST.flatMap((f) => f.shell?.topbar ?? [])
    .sort((a, b) => a.order - b.order)
    .map((slot) => slot.component)
  return cachedTopbar
}
```

- `lib/nav.ts` - `navEntries()`, cached in a module `let`
- `lib/shell.tsx` - `topbarComponents()`, as above
- `lib/slots.ts` - `slotComponents(name)`, cached in a `Map`
- `lib/useDoc.ts` - `docSurface(kind)`, cached in a `Map` (a miss caches `null` too)
- `views/SettingsView.tsx` - `allSections()`, cached in a module `let`

The hazard is precise: a module is unsafe when a **feature's `index.tsx` pulls it in**, because then
its body runs *during* the registry's own evaluation, before the registry's bindings are
initialised. `router.tsx` spreads `WEB_ROUTES` at module scope and is fine because it is the
registry's *importer* - its body runs after. (`notifications/index.tsx` does import `router.tsx`,
and only touches `router` inside a callback, which is the same rule one level up.) `App.tsx` reads
`WEB_FEATURE_LIST` inside an effect. Do not take either as licence: if you are writing anything a
feature might import, read lazily.

**After touching `App.tsx`, `router.tsx`, `lib/shell.tsx`, `lib/nav.ts` or any feature's
`index.tsx`, load the app in a browser and look at the console.** That is the only check that
catches this.

---

## How data reaches a view

```
DuckDB warehouse -> a feature's controller -> tRPC -> lib/trpc.ts -> a data store -> useData() -> the view
                                              ^
                         change bus -> changesFeed (SSE) -> lib/changeFeed.ts invalidates the store
```

### The client

`src/lib/trpc.ts` is the one client. A `splitLink` routes subscriptions over
`httpSubscriptionLink` (SSE) and everything else over a batched HTTP link; the same `/trpc` handler
serves both, at a relative URL. Every call carries `x-box-csrf: 1`, because the server requires that
header on cookie-authed mutations (`auth.guard.ts`); sending it on queries too is harmless and means
no mutation can be missed. Bearer clients are exempt.

### The generated router type

`src/generated/appRouter.d.ts` is written by **`bun run typegen`**, which boots the Nest app far enough
to register the adapters (`NestFactory.create` + `app.init()`, no `listen()`, no port) and dumps the
router type. It is a generated file - never hand-edit it. `bun run typegen --check` fails instead of
writing and restores the file; it runs inside `box verify`, so **a controller change no longer
needs a running server** for the SPA's types to catch up.

### Data stores

`src/lib/dataStore.ts` is the ONE module-level cache and subscription store, replacing the seven
hand-rolled copies each domain hook used to carry. `createDataStore(fetcher)` gives you `load`,
`reload`, `peek`, `set` (optimistic patch + notify) and a `useData(enabled?)` hook. One shared fetch
per store, deduped while in flight; every subscriber re-renders on every emit; a mutation patches
through `set()` and reconciles with `reload()`.

The idiom is a module-level store plus a scope registration, right next to each other:

```ts
// lib/useUsersData.ts
const store = createDataStore<User[]>(() => trpc.usersList.query({}).then(fromWire))
registerStoreReloads(['table:users'], store)
```

Core carries two: `lib/useUsersData.ts` (the directory, which also feeds `UsersProvider`) and
`lib/useRuns.ts` (the ops layer: the action registry, run history, Run Now). Every feature's
`lib/use*Data.ts` follows the same two lines.

### The change feed

Every tab holds ONE `changesFeed` tRPC subscription (SSE, `src/lib/changeFeed.ts`, started by the
auth gate), streaming invalidation hints from the server's change bus (`packages/core/src/changes.ts`).
Events carry a **scope, never data**:

- `table:<name>` - emitted by the warehouse record layer on every in-process write, so mutations
  from the web UI, MCP agents, REST and cron actions all announce themselves;
- `docs:<section>` / `config:<file>` / `warehouse` - emitted by the server's recursive fs watcher
  (`apps/server/src/changes/changes.watcher.ts`) for OUT-of-process edits: a local agent session
  editing markdown, a human in an editor, an external DuckDB writer. A `warehouse` event invalidates
  every `table:`-scoped registration.

A matching event reloads the store, debounced 300ms, and **only if it has ever loaded** - a route
you never visited costs nothing. State that does not live in a global store opts in with
`subscribeChanges(scopes, cb)`, which returns its unsubscribe; pair it with the effect teardown.

The stream opens with a `hello` event carrying the server's boot id. There is no event replay, so
**any hello after the first** (SSE reconnect, server restart) means events may have been missed and
every loaded store reloads. `ping` keepalives flow when the bus is quiet. On a fatal stream error the
feed unsubscribes and reconnects from scratch after 5s.

## Auth on the web side

The full model is in [AUTH.md](AUTH.md). The web app is responsible for:

- `src/lib/useAuth.tsx` probes `GET /api/auth/me` on mount. That endpoint is `@Public()` so the SPA
  can ask without eating a 401. The principal is `{ id, display }` and **nothing else** - no role
  reaches the client; the session cookie does not carry one either, and the server re-reads the role
  from the users row on every request.
- `App.tsx` is the gate: while `loading`, an empty canvas; with no principal, `LoginView`; otherwise
  the app. The change feed and every feature's `onSession` start on that same gate, because an SSE
  subscription or a tRPC fetch before a session just 401s.
- `src/views/LoginView.tsx` exchanges a pasted access token for a session cookie. There is no
  password. For `/login/<grant>`, the router passes the grant through transient client state.
  `LoginView` spends it with a POST when the user confirms, then receives the same session cookie.
- The authenticated principal IS the active-user scope: `useAuth` pushes it into
  `lib/useActiveUser.ts`, whose `getActiveUserId()` stamps `actor` on mutations from non-React data
  code.
- **Tiers are enforced on the server, not hidden in the UI.** `admin` and `member` are read inside
  `AuthGuard` from the `@Admin()` decorator, which holds on REST, tRPC and MCP alike. The SPA renders
  the same surface for everyone signed in and an admin-only mutation fails at the server for a
  member. Do not add a client-side gate and call it security; if a control should not be reachable,
  the route it calls must refuse it.

## The app's own lib

Everything in `src/lib/` that is not covered above, and why it is core rather than a feature's:

| File | What |
|---|---|
| `format.ts` | **One date format, `YYYY-MM-DD`, everywhere**, through three deliberately distinct formatters: `formatDate` (a date), `formatBucket` (a warehouse bucket, **UTC**), `formatDateTime` (a timestamp in the *reader's* timezone, for the few fields that are wall clock to a person). Plus `formatNumber`, `formatDelta`, `formatDuration`. Do not flatten the three into one, and do not call `toLocaleString()` at a call site |
| `gridColumns.ts` | The geometry half of a data grid, shared by every feature that draws one. Two things about a column, stored in two different places on purpose: WHICH columns and in WHAT ORDER is view state (shared with the team); HOW WIDE each one is, is a user setting (localStorage, per column) - width is about your screen and your eyesight, and syncing it would mean one person's drag re-laying-out everybody else's board |
| `guards.ts` | Type guards (`isStringArray`, ...) used by stored views and localStorage reads. |
| `useRecentIds.ts` | "Where have I been": the ids you opened, newest first, per browser. Deliberately not shared the way a team's saved view is |
| `image.ts` | Client-side avatar prep - downscale and square-crop a picked file into a small data URI that fits in the `users.image` column. No upload infrastructure |
| `highlighter.ts` | Fine-grained shiki for read-only code blocks: the core plus exactly the grammars a small team pastes, each behind its own dynamic import. The full bundle would dominate the app's download |
| `agentStore.ts` | The module-level agent store the sidebar, the top-bar toggle and the Run-now action converge on |
| `storagePrefix.ts` | **The one place this Box's localStorage namespace is written down** (`ui`). Imports nothing, on purpose: `vite.config.ts` imports it too, and Node loads a vite config without the workspace's `@silkweave/box-source` condition |
| `storage.ts` | `appKey(...parts)` builds every localStorage key from the Box namespace. No call site spells a key out. |

## The agent panel

`src/components/agent/AgentSidebar.tsx` (plus `AgentToggle`, delivered through the shell seam)
embeds a live workerdeck session as a right-hand panel inside the shell's framed canvas. All the
transcript machinery is `@workerdeck/ui`'s `SessionPanel`; **this app writes no transcript UI.**
Tokens are bridged in `src/styles/agent.css` - **never import the worker's own `theme.css`**: both
token systems collide on `@theme` names, so the bridge maps the few gaps onto Box vars and
`@source`-scans the package instead. The panel renders md+ only; small screens keep the copy-paste
flow. It re-attaches a still-running session on mount and on window focus, so one agent per user
converges across windows.

`src/components/agent/GenerateCommand.tsx` (`GenerateButton`) is the app-wide "this hands off to AI"
affordance: a periwinkle Sparkles button that opens an explainer modal, copies the command snippet
to the clipboard immediately, and offers **Run now** in the sidebar when the agent host is
configured. Features mount it wherever a skill takes over (see each feature's SPEC). **Reuse it for
any future run-this-in-a-session action; never restyle it per view, and never hand-roll a
copy-the-command chip.** The copy path is the fallback on every screen without a sidebar, so it must
not be removed.

## Three traps worth not re-learning

**Never index a UI map with a value that came out of the warehouse.** A warehouse holds values the
current vocabulary has never heard of - a renamed status still sitting in rows written before the
rename took a whole view down with `Cannot destructure property 'icon' of 'MAP[status]'`. A `data.db`
never travels by git, so a `git pull` does not fix it and a reseed only fixes it until the next
rename. Every data-driven lookup goes through a resolver that degrades: an unknown value renders as
a muted question-mark chip instead. The crm app's `crmStatus.tsx` is the pattern; an adopted app
brings its own copy of it.

**Ids are for machines and the API; the UI resolves a friendly label - and an unresolvable binding
renders its raw id rather than vanishing.** A binding you cannot see is a binding you cannot fix.

**One eager import defeats every lazy boundary that shares a dependency.** Keep large editor and
feature views behind `lazy()` wrappers and inspect the entry chunk when reviewing bundle changes.

## Checks

`box verify` from the root covers this package's typecheck and lint (see the root `AGENTS.md` for
the whole chain). Two things it does not cover:

1. **Anything that only fails at runtime** - above all a module-scope registry read. Load the app.
2. **The component library's rendering** - that is Storybook's job
   (`bun run --filter @silkweave/box-ui storybook`), and `bun run --filter @silkweave/box-ui typecheck` type-checks
   every story.

`apps/web/dist/` and `node_modules/` are build output and gitignored.

## Product branding

Choose the build-time product name and artwork in the `brand` section of `box.json`; the SPA
gets them from the `virtual:box-brand` module that `apps/web/branding.ts` generates at build time,
so a change needs a rebuild. See
[Branding a Box](BRANDING.md) for the shared web/server surfaces, image sizes and rebuild steps.
