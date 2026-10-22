# The composition seam (Silkweave Stack)

How a Silkweave Box is composed from core and features: what a feature is allowed to do, how it
is registered, and why the seam is shaped this way. The source layout is
features/<id>/{core,server,web}. The Stack offers each feature as a recipe: documentation in
recipes/<id>/ plus a reference implementation in features/<id>/. An agent adapts a recipe by reading
those documents and that implementation and integrating the code into the receiving Box's own
features/<id>/, where it is registered as a feature. See docs/RECIPES.md. Related details live in WAREHOUSE, SERVER, WEB,
and AUTH.

Core owns typed extension points (ports): the warehouse schema, ops registry, persisted events spine,
Nest module list, web route tree, navigation, Settings, shell slots, session hooks, UI slots, and
doc surfaces. Features contribute through maintained registration and public barrels. The receiving
agent adds required packages, adapts wiring, and records upstream SHA, path mappings, local gotchas,
and integration state.

Migrations are the hard boundary: preserve identities and bodies byte-exactly, back up before
applying, apply them before unrelated changes, and confirm boot. The warehouse ledger checks
migration digests; chat's private ledger has no checksum. New behavior is a new migration.

---
## 1. What is core, what is a feature

Core is what every Box has: the warehouse engine and record layer, auth and users, events, the ops
kernel and run funnel, the change bus, box config and brand, the agent host, and the web shell,
navigation, dashboard, Settings, and login flow. Core also owns maintained registration barrels and
the shared UI library.

A feature is one source tree with three runtime areas and documentation:

| Directory | Holds | Entry |
|---|---|---|
| features/<id>/core/ | Tables, migrations, actions, domain code | manifest.ts exports CoreFeature; index.ts is the public barrel |
| features/<id>/server/ | Nest module, controllers, runtime registrations | index.ts exports ServerFeature |
| features/<id>/web/ | Routes, views, stores | index.tsx exports WebFeature |
| features/<id>/ | SPEC, INSTALL, GOTCHAS, AGENT, skills | Maintained reference documentation |

The id is a lowercase slug and the migration ledger namespace. It is never renamed. Runtime
registration and public export paths are maintained in the Box root source. An integrating agent
updates those registrations and records the source SHA and path mapping.

Feature source may import core and declared prerequisites. Optional integration belongs in a glue
feature, so a Box can remove a feature after adapting dependent registrations and imports.

---
## 2. The feature manifest

### 2.1 Form: one manifest module per tree, one maintained registration per tree

A feature is described by TypeScript modules, not JSON: the things it contributes are values with
behaviour (ModelSpecs with enum thunks, migration `run` hooks, action generators, Nest module
classes, React routes and components). JSON would need a second, hand-maintained mapping from
names to those values, which is exactly the touchpoint the seam removes.

```
features/<id>/core/manifest.ts                  default export: CoreFeature (data only, § 2.4)
features/<id>/core/index.ts                     the feature's public barrel
features/<id>/server/index.ts                   default export: ServerFeature
features/<id>/web/index.tsx                     default export: WebFeature

Root maintained registration imports the feature barrels into the warehouse, server, and web
composition points.
```

The contracts are core-owned (`feature.ts` at the root of each tree) and never edited by a feature:

```ts
// packages/core/src/feature.ts
export interface CoreFeature {
  id: string                          // the directory name; the migration ledger namespace, NEVER renamed
  dependsOn?: readonly string[]       // features whose tables and migrations must exist before this one boots
  models: readonly ModelSpec[]        // tables this feature OWNS; CREATE TABLE IF NOT EXISTS on every boot
  baseline?: readonly string[]        // idempotent DDL re-run on every boot after every CREATE TABLE (views, indexes)
  migrations: readonly Migration[]    // append-only, one ledger row each, keyed `${id}:${name}`
  actions?: readonly ActionSpec[]     // runnable ops contributed to core's run funnel
  presetModules?: readonly string[]   // preset module ids of the boards this feature draws with a view bar
  background?: Readonly<Record<string, string>> // capability key -> what it arms: box.json `background.features.<id>.<key>`
}

// apps/server/src/feature.ts
export interface ServerFeature {
  id: string
  module: Type<unknown>               // the Nest module, imported into AppModule verbatim
}

// apps/web/src/feature.ts
export interface WebFeature {
  id: string
  routes: readonly AnyRoute[]         // direct children of rootRoute (import it from router-root.tsx)
  nav?: readonly NavEntry[]           // { id, label, icon, to, description?, order }
  settings?: readonly SettingsSection[]                                // { id, label, icon, order, render }
  shell?: { topbar?: readonly { order: number; component: ComponentType }[] }
  onSession?: () => void | (() => void)                                // runs once a session exists; returns the teardown
  slots?: Readonly<Record<string, readonly ComponentType<any>[]>>      // contributed INTO another feature's surface (§ 5.6)
  docs?: Readonly<Record<string, DocSurface>>                          // markdown doc families this feature serves (§ 5.6)
}
```

Each contract comes with a `define*Feature<const T extends X>(feature: T): T` identity function,
and it is not decoration. Annotating a manifest `: WebFeature` would widen `routes` to
`readonly AnyRoute[]`, `typeof router` would then know no paths, and `navigate({ to: '/crm/$id' })`
would accept any string anywhere, silently. The `const` type parameter keeps the tuple of concrete
`Route` types, which is what makes cross-feature links compile-checked (§ 5.1). The same reasoning
is why a maintained registration is `[...] as const satisfies readonly WebFeature[]` with no annotation,
and carries a separately widened `*_LIST` for consumers that read a port rather than the literals.

### 2.2 A feature's manifests, concretely (crm, an integrated feature)

CRM provides concrete examples of the three entry modules present in this stack:

```ts
// features/crm/core/manifest.ts
import { defineCoreFeature } from '@silkweave/box-core/feature'
import { CRM_MODELS } from './models.js'

export default defineCoreFeature({
  id: 'crm',
  models: CRM_MODELS,
  migrations: [],   // append-only; grows once a Box has shipped with the old shape
})
```

```ts
// features/crm/server/index.ts
import { defineServerFeature } from '../../../apps/server/src/feature.js'
import { CrmModule } from './crm/crm.module.js'

export default defineServerFeature({ id: 'crm', module: CrmModule })
```

```tsx
// features/crm/web/index.tsx
import { Contact } from 'lucide-react'
import { defineWebFeature } from '../../../apps/web/src/feature.ts'
import { crmRoutes } from './routes.tsx'   // Route objects whose parent is rootRoute (§ 5.1)

export default defineWebFeature({
  id: 'crm',
  routes: crmRoutes,
  nav: [{ id: 'crm', label: 'CRM', icon: Contact, to: '/crm', order: 600,
          description: 'Accounts, contacts, meetings and revenue, worked one company at a time.' }],
})
```

`features/crm/core/index.ts` is the barrel: it re-exports the manifest and the
feature's public modules (`models`, `types`, `state`, ...). The server tree reaches a feature's
core code only through it, because the core workspace exports its public barrel. So
`import { listCrmAccounts } from '@silkweave/box-core'` in the crm controller type-checks on any
Box that has crm and fails on one that does not, which is the honest outcome. It also means a
cross-feature import on the server is a name, not a path; `typecheck` attributes each name to the
feature that exports it (§ 4.1).

### 2.3 Maintained registration and its consumers

The root source keeps static imports for every feature present in the Box. These maintained barrels
are the registration surface, so missing source fails loudly during typecheck or boot. Core
registration feeds warehouse/schema.ts and ops/registry.ts; server registration feeds app.module.ts;
web registration feeds router.tsx, navigation, Settings, shell, slots, and docs. Registration is
ordinary source, not a generated catalogue or installation manifest.

| Registration | Consumer | What it does |
|---|---|---|
| Core feature list | warehouse/schema.ts | Orders features, baselines models, and applies migrations |
| Core feature list | ops/registry.ts | Adds feature actions to the run funnel |
| Server feature list | app.module.ts | Registers feature Nest modules |
| Web feature list and routes | router.tsx, nav, Settings, shell, slots, docs | Composes the web surface |

tRPC and MCP assembly remains feature-aware only through registered Nest modules. Duplicate names
fail during type generation or boot. The same static import rule makes a core-only Box a useful
check: stale feature references fail loudly.

### 2.4 The one rule for `manifest.ts`: it is data

The core import graph has a cycle by construction: `warehouse/schema.ts` imports
feature registration, which imports every manifest; a manifest imports its `actions.ts`, which
imports its `state.ts`, which imports `warehouse/model.ts`, which imports `warehouse/db.ts`, which
imports `warehouse/schema.ts`. ESM tolerates it exactly as it tolerates the `db.ts <-> schema.ts`
cycle core already has: as long as no module READS a binding from a module still evaluating above
it on the stack. A manifest that did `const DDL = createTableSql(CRM_ACCOUNTS)` at top level would
throw a TDZ `ReferenceError` at boot.

So: **a manifest and the files it imports (`models.ts`, `migrations.ts`, `actions.ts`) contain
object literals and function references only; never a top-level call into `warehouse/*`, `ops/*` or
another feature.** `models.ts` imports only `./types.js` for enum vocabularies, the discipline
`warehouse/core-models.ts` keeps. A migration `run` hook that needs feature code uses
`await import('./state.js')` inside the hook. Keep dependency declarations accurate: the runtime
uses them for migration ordering, while imports and typechecks establish the source connections.

The alternative was to break the static cycle by having every entry point call
`configureSchema(FEATURES)` before touching the warehouse. It is cleaner for the module graph and
worse for every script, test and agent that forgets it. Rejected; the data-only rule is cheaper.

### 2.5 Why maintained static registration

Static imports make the enabled feature set visible to the compiler and boot path. Filesystem
discovery would make registration asynchronous, weaken type inference, and let a feature disappear
silently from one runtime while remaining present in another. The maintainer carries the registration
list because it is a project responsibility, and missing source fails loudly. Feature documentation
explains how an agent updates the list during integration.

## 3. Schema: baseline + per-feature ledgers

`warehouse/schema.ts` has no global list of anything. `applySchema(conn, features)` orders the
feature registry, baselines every ModelSpec with `CREATE TABLE IF NOT EXISTS`, runs each feature's
`baseline` DDL, then applies each feature's append-only migrations once each, atomically with their
ledger row. The step-by-step mechanics, the DuckDB constraints that shaped them and the working
rules for changing a schema are [WAREHOUSE](../WAREHOUSE.md)'s; this section is the design.

### 3.1 Ledger key and table

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  name       VARCHAR   NOT NULL PRIMARY KEY,   -- '<feature>:<name>', e.g. 'planning:001-sprint-tasks'
  feature    VARCHAR   NOT NULL DEFAULT 'core',
  applied_at TIMESTAMP NOT NULL DEFAULT now(),
  checksum   VARCHAR                            -- name + evaluated SQL + a hash of run.toString()
)
```

The author writes `name: '001-sprint-tasks'`; the runner stores `planning:001-sprint-tasks`.
Uniqueness across features is by prefix; uniqueness within a feature is asserted before anything
runs. Core's own migrations (`warehouse/core-migrations.ts`) are keyed `core:<name>` and run first.
The ledger travels inside the `.db` file, so a restored older backup upgrades itself on its first
boot. `applySchema` refuses a ledger row with no prefix: that file is not a Box warehouse.

### 3.2 Run order

`orderFeatures` returns core first, then features in dependency order, ties broken by id, so two
Boxes with the same directories apply the same sequence whatever order the registry listed them in.
It throws on a cycle, naming the trail, and on a `dependsOn` naming an absent feature.
`assertOwnership` then refuses a table declared by two features and a migration name declared
twice in one feature. Both are pure and unit-tested (`warehouse/schema.test.ts`).

Within a feature, order is **array position**; the `NNN` prefix is a reading aid. Two features'
`001`s have no relationship, and the runner never interleaves by number. The only cross-feature
guarantee is that a dependency's tables and migrations are complete before a dependent's migration
runs, which is all a read-only dependency needs.

Before any pending migration writes to an existing warehouse, `ensureSchema` takes a `pre-migrate`
snapshot under the same write connection; a snapshot failure stops the migration. Two guards run
before that and refuse to boot, because in both cases the code on disk no longer describes the
database on disk: an applied migration that is missing from the installed code, and one whose
checksum no longer matches. Neither is a compliance rule; a team that means to rewrite its history
says so to the database
([what still refuses to boot](../WAREHOUSE.md#what-still-refuses-to-boot)).

### 3.3 Enabling feature B six months after feature A

A Box has run `planning` and `sink` since January; in July the team integrates `crm`. Boot:

1. `orderFeatures` places core first and crm by its dependencies, ties broken by id. `assertOwnership` passes.
2. Baseline creates `crm_accounts` and the rest at the CURRENT ModelSpec shape, empty.
3. crm's migrations have never been applied here, so every one of them runs, in order, against
   tables that are already at the shape the last one produces.

That is the fresh-warehouse path, and it is universal: **every migration must be a safe no-op when
its table is already in the post-migration shape.** DDL uses `ADD COLUMN IF NOT EXISTS`,
`DROP COLUMN IF EXISTS`, `ALTER TABLE IF EXISTS` (core's own `core:001-users-role` is the shape); a
bare `DROP COLUMN old` fails at step 3 because the baseline never created `old`, the boot aborts
with `migration crm:004-drop-old failed`, nothing is half-applied, and the fix is the guard. A
backfill `UPDATE` must be correct on zero rows. A `run` hook that reasons about shape checks
`duckdb_columns()` / `duckdb_tables()` first, and one that copies rows out of an old table must
guard on the OLD table existing, because on this path only the new one does.

This path adds a failure mode the fresh path never had: **the row population of OTHER features'
tables is arbitrary.** A crm migration written in March that reads `planning` rows as they were
shaped in March runs in July against rows shaped by planning's April and June migrations. That is
why cross-feature writes are forbidden and cross-feature reads must be written as "seed from
whatever the dependency holds NOW", never as "convert what it held on the day I shipped" (§ 3.4).
The one case no rule closes is a read-only cross-feature migration that depends on a column the
dependency later dropped; `bun run schema:check` cannot see it, because it runs on empty tables. The
mitigation is that a migration reads a dependency's tables only through the dependency's exported
readers, via `await import()` inside `run`, which the compiler checks against the dependency's
current code, never through hand-written SQL against the dependency's columns.

### 3.4 Cross-feature migrations: reads allowed via declared dependencies, writes forbidden

- A migration in feature B may **read** tables of a feature in B's `dependsOn`. The topological order
  guarantees they exist and are current. Read through the dependency's exported readers inside
  `run` (§ 3.3), so the dependency is visible in the manifest rather than buried in a string.
- A migration in feature B may **never write** (ALTER, UPDATE, DELETE, INSERT, DROP) a table it does
  not own. Feature A owns its tables' history; if B needs a column on A's table, that is a change
  to A: A gets the ModelSpec column and the migration, and B's `dependsOn` already covers the order.
- Enforcement is layered, and only the first layer is proof. `assertOwnership` proves declarations.
  `bun run schema:check` runs a conservative regex over each migration's static SQL against the tables
  the feature owns (`warehouse/migration-ownership.ts`) and reports a hit as a **warning**: on the
  maintainer checkout, where apps stay separable, a warning is something to fix; on a team's Box
  that merged two integrated features into one vocabulary, it is the product working. `run` hooks are
  opaque to it.
- **Removing a feature never drops its tables or its ledger rows.** Nothing in the code does, and
  the missing-migration guard only fires for installed features. The rows are the tenant's, and the
-  ledger is what makes re-integrating the feature resume at `N+1` instead of re-running `001..N`
  against tables that already hold rows. Purging is a deliberate manual step, after a backup.
- **Feature ids and migration names are immutable, and so is a shipped migration's body.** Renaming
  either re-runs every migration on every deployed Box; editing one trips the checksum guard.

### 3.5 What `bun run schema:check` proves, and what it cannot

`packages/core/scripts/schema-check.ts` runs as **part of `box verify`**. On
throwaway DuckDB files it proves the fresh and reboot paths (apply twice on one file; every declared
table exists) and, for each feature F, the enabled-later path of § 3.3 (apply without F and its
dependents, then apply everything). That second pass is the one that catches an undeclared
dependency: a view or migration reaching for a table its feature never listed in `dependsOn` works
on a full Box and fails on the Box without that neighbour, and unit tests cannot see it. Ownership
(§ 3.4) is reported as a warning.

It cannot prove a data migration against real rows; every table it creates starts empty. That is
what `box db backup` and a rehearsal on a restored copy are for
([working rules](../WAREHOUSE.md#working-rules-for-an-agent-changing-schema)). Run it after
changing a model, a baseline or a migration; the full verification chain also runs it.

### 3.6 Feature-private stores

`CoreFeature.migrations` is for the DuckDB warehouse only. A feature whose access pattern the
single-writer warehouse is wrong for (many tiny interactive writes plus point reads) may own a file
of its own, entirely inside its directories: its own path under the instance dir through core's
`dataPath()`, its own ledger, its own migration chain, and `manifest.models` lists only what it
puts in the warehouse. The `chat` feature is the one that does this, with `chat.db` on
SQLite and `models: []`. The consequence to know: core's backups and pre-migration snapshots cover
the warehouse, not a feature's private file; the feature owns that too.

---

## 4. Cross-feature dependency

### 4.1 The mechanism: direct import and declared prerequisite

A feature that needs another imports its public source surface and records that prerequisite in its
core manifest. The dependency controls migration order and tells the integrating agent what must be
present before wiring the feature. Typecheck catches missing import targets. The maintainer must also update registration; an
unregistered source file alone does not produce a compiler error.

A feature never optionally imports another with a runtime try/catch. Optional integration is a glue
feature that depends on both sides, as described in section 4.2. Cross-feature ports handle cases
where many contributors register into one owner's surface.

### 4.2 Glue features for optional integration

Where A and B are each useful alone and also useful together, the together-part is a third feature
that depends on both, so both stay deletable and every dependency stays a compile-time fact.
`notifications` in the Stack's recipes is the shape: `dependsOn: ['chat', 'automation']` (with
Automation's `alerts` powerup), no tables, and it carries the bell that merges chat mentions with
alerts, web and FCM push, and alert delivery into chat rooms. Without it, chat has no bell and
alerts deliver nowhere but their own feed; both
true and both fine.

The direction of every registration follows from this: **the dependent registers into the
dependency, never the reverse.** `notifications`' server module registers a chat transport into
the alerts powerup's `registerAlertTransport` from `onModuleInit`; automation never imports the feature that
provides it. A dependency that needs to know about its dependents has a port (§ 4.3), not an
import.

### 4.3 The ports (N contributors, one consumer)

Core-owned, filled from the manifest:

| Port | Filled by | Consumer |
|---|---|---|
| `CoreFeature.models` / `baseline` / `migrations` | every feature with tables | `warehouse/schema.ts` |
| `CoreFeature.background` | features with their own background work | `background.ts` (`isBackgroundEnabled`, the boot check; [CONFIGURATION.md](../CONFIGURATION.md)) |
| `CoreFeature.presetModules` | features whose boards have a view bar | `presets/presets.ts` (saved views, [SIGNALS.md](../SIGNALS.md#saved-views-presets)) |
| `CoreFeature.actions` | any feature with runnable ops | `ops/registry.ts`; from there the `OpsController`, the `run-now` MCP tool, `bun run cli`, and automation's scheduler |
| `ServerFeature.module` | every feature | `app.module.ts` |
| `WebFeature.routes` / `nav` / `settings` / `shell.topbar` / `onSession` / `slots` / `docs` | every feature with UI | `router.tsx`, `lib/nav.ts`, `SettingsView.tsx`, `lib/shell.tsx`, `App.tsx`, `lib/slots.ts`, `lib/useDoc.ts` (§ 5) |

Core-owned, filled at runtime from a server module's `onModuleInit`, unregistered on destroy:

| Port | What a feature registers |
|---|---|
| `onEvent(listener)` (`events.ts`) | a subscriber to FRESH events, after the row is committed (§ 4.4) |
| `onRunOutcome(listener)` (`ops/run.ts`) | what happens after a run finalizes; best-effort, never affects the run |
| `registerAgentSessionRule(id, rule)` (`agent-session.ts`) | a rule that WIDENS who may read an agent session; core knows ownership and nothing else |
| `registerUserCleanup(id, cleanup)` (`users/cleanup.ts`) | what to do with the feature's own rows when a user is deleted; a throw aborts the delete |
| `registerPathMount({ id, prefix, handle })` (`path-mounts.ts`) | a top-level URL prefix such as `/artifacts/` that the feature serves itself, ahead of the SPA in dev and production; core authenticates every request first and the bare prefix stays the SPA's (§ 5.1) |

Core's signals add ports of the same shape ([SIGNALS.md](../SIGNALS.md)): `registerSignalHooks`
(planning and automation register into it), `registerBoardNodeKind` (planning),
`registerProvider` and `registerPlatformClient` (the Data Sync recipe's powerups) and
`registerPublishedPostSource` (a feature that publishes posts). Core's event ports (`event-ports.ts`) are the same:
`registerEventInterest` (automation answers whether a trigger listens for a kind),
`registerDeliveryFlusher` (the alerts powerup) and `registerEventLinker` (a feature linking an event kind to its own page).

A feature may own a port of the same shape for its own dependents, and the Stack's features do:
`automation` exposes `registerDeliverRunner` (its alerts powerup) and, with that powerup,
`registerAlertTransport` (notifications).
Each is a small module in the owner's core directory: a typed record, a list keyed by the
registering feature's id, a `register*` that throws on a duplicate id and returns the unregister.
A CLI or test that never boots those modules simply sees the owner alone, which is the point.

An action is `ops/types.ts`'s `ActionInfo` (`id`, `label`, `group`, `description`,
`parameterized?`) plus `run: (opts: ActionRunOpts) => AsyncGenerator<IngestProgress>`. Its `id` is
unique across the Box: `ops/registry.ts` throws at index time naming both owners.

### 4.4 `changes.ts`: the right seam for one job, a red herring for the other

`packages/core/src/changes.ts` carries `{ scope, detail }` with no payload, no persistence and no
ordering across restarts, and is deliberately safe to fan out to any authenticated principal
because it says nothing beyond "something in `table:x` changed". Every feature emits into it for
free through `upsertRecord` / `deleteRecord`, and a web store consumes it through
`registerStoreReloads`. **For UI live refresh it is exactly right and needs no change**: a new
feature's stores register the scopes they read and are live on day one.

**For domain integration it is the wrong seam.** "A ticket was closed, tell the requester" needs
the ticket id, needs to happen once, and needs to survive being observed by a process that was not
listening. That is the events spine, `packages/core/src/events.ts`: `recordEvent` persists,
dedupes on `(kind, dedup_key)` and returns whether the event was fresh; `onEvent(listener)` is
invoked only on the fresh path, after the row is committed, and awaited. Listeners are best-effort
in-process subscribers (a throw is logged, never propagated into the writer, the same contract
`emitChange` has); there is no outbox and no replay across restarts, and a subscriber that needs
at-least-once semantics reads the table instead. Two spines, two jobs; the side-by-side table is in
[WAREHOUSE](../WAREHOUSE.md#changests-is-not-eventsts).

The spine being core is what keeps the graph acyclic: every feature's writers emit into it, and the
policy that reacts (alert rules, pod automation) is a subscriber in a feature. Fold the policy into
`recordEvent` and core grows a dependency on a feature.

---

## 5. The web side

The file-by-file reference, the routing details and the data path from tRPC to a view are
[WEB](../WEB.md)'s. This section is the seam.

### 5.1 Code-based routing, one router, feature-contributed subtrees

File-based routing would need a single `routesDirectory` that puts a feature's route files OUTSIDE
its directory, or a second code generator with its own layout conventions. Code-based routing
composes without any of that: a feature's `routes` are `Route` objects whose parent is the exported
`rootRoute`, and `router.tsx` spreads `WEB_ROUTES` between its own two routes:

```ts
// apps/web/src/router.tsx (the composition)
const routeTree = rootRoute.addChildren([
  indexRoute,                                        // `/`: the app dashboard
  settingsRoute.addChildren([settingsSectionRoute]), // legacy `/settings/...` redirects
  ...WEB_ROUTES,
])
export const router = createRouter({ routeTree, history: createBrowserHistory() })
```

`rootRoute` lives alone in `apps/web/src/router-root.tsx` so a feature's `routes.tsx` can name
its parent without importing `router.tsx`, which imports the features: that would be a cycle at
module load. It accepts a dependency-light injected root component; `router.tsx` supplies the
app-owned `AppLayout` before composing the route tree. `AppLayout` remains outside recoverable
route content boundaries and owns the one `AppShell` for the authenticated router's lifetime.

Each section parent declares `staticData.shellGroup` with its navigation entry id. Its layout wraps
the routed body in `RouteChrome`, publishing the complete set of secondary items, active id,
selection callback, breadcrumbs/actions, and optional group action. The shell host matches that
publication against both the deepest section route and the committed location. Until it matches,
the host renders empty secondary navigation and a breadcrumb derived from the static group. This
keeps old route callbacks out of a new destination while its data is loading. Publication is owned:
a departing layout can remove only its own snapshot, so delayed cleanup cannot erase its successor.

`RouteChrome` is route-local state, distinct from the manifest's global `shell.topbar` contribution.
Feature providers and dialogs stay in the routed subtree. Existing `TopBarActions` and
`TopBarCenter` portals remain the right seam for leaf controls that need route-local context.
Descriptor React nodes render under the shell host rather than under those providers, so they must
receive required state explicitly. Writers share a stable controller but do not subscribe to its
snapshot, avoiding publication loops. Only the shell persists; inactive routed bodies still unmount.

Typed links across features fall out of § 2.1: `typeof router` contains planning's paths iff
planning's directory is present, so `navigate({ to: '/initiatives/$id' })` inside another feature is a type
error on a Box without planning. That is the compile-time dependency check on the web side, and it
needs no declaration to work; that feature's `dependsOn: ['planning']` is still required by
`typecheck` when it also imports planning's components.

One thing the seam cannot check: the SPA shares one URL namespace with the server, so a feature's
top-level route may not collide with `/api`, `/trpc`, `/mcp`, `/agent` (`RESERVED` in
`apps/server/src/main.ts`), with a file the SPA ships, or with what Vite owns in dev. Nothing in
the validation chain looks; a feature that adds a top-level route re-checks by hand.

### 5.2 Nav: contributed entries, numeric order bands

`lib/nav.ts` reads feature navigation lazily, alongside core's Dashboard (order 0). Each entry
declares its sidebar section (`NavSection`: id, label, order); core declares only Workspace, for
Dashboard, and names no feature. The UI library renders supplied section labels without owning their
domain vocabulary. Dashboard at `/` is the default landing page, including a featureless Box. See
[WEB.md](../WEB.md) for the section rules and the sections this Stack's recipes declare.
A nav entry may set `expandable: false` for a destination without sub-navigation.

Bands are fixed by convention so that integrating or removing a feature never reorders the others. The
Stack's features use core's signals 100-199, `planning` 200-299, `chat` 500, `artifacts` 510,
`crm` 600, `support` 650, `sink` 700, `reminders` 750, `automation` Settings 800. A new feature picks a
free band; a collision is a tie broken by id, not an error. Entry order also places an entry inside
its section.

### 5.3 Settings sections

`views/SettingsView.tsx` hosts a dialog addressed by `#settings/<section>/<subpath>` over the
current application page. Core owns Profile (0, the default) and Users (100). Feature sections
use the same order bands as § 5.2 and receive their subpath through `render(params: string[])`.
Unknown or unavailable sections fall back to Profile. `useSettingsDialog().open(path)` preserves
the current page and its query state. See [WEB.md](../WEB.md) for links, legacy redirects, and
inline editor composition. Settings uses `InlineDialogScope` so editors and confirmations occupy
the pane rather than another modal.

### 5.4 Shell slots, and the rule that comes with them

The shell itself is not core's: `AppShell` lives in `@silkweave/box-ui`, which knows nothing about
tRPC, auth, the registry or the agent stack, and takes what it needs from the app through
`ShellExtensions`. `apps/web/src/lib/shell.tsx` fills that value once, app-wide: the top-bar
cluster (every feature's `shell.topbar` contributions by ascending `order`, then the user menu,
then the agent toggle), the agent panel as the `aside`, the home link, the Settings footer control, and the storage prefix. In
the Stack's features, `notifications` contributes the `NotificationBell` at 200.

`ShellExtensions` supplies persistent app-wide additions; `RouteChrome` supplies the active
section's replaceable navigation and actions. Keeping these seams separate is what lets Assistant
and global controls retain their component identity while a route's callbacks are released on
departure.

The rule that comes with every reader of the web registry: **no module that a feature's
`index.tsx` can pull in may touch `WEB_FEATURES`, `WEB_FEATURE_LIST` or `WEB_ROUTES` at module
scope.** The registry sits on an import cycle with every view, so a module-scope read runs while
the binding is in its temporal dead zone and white-screens the whole SPA, and the validation chain has no
runtime step to see it. `lib/nav.ts`, `lib/shell.tsx`, `lib/slots.ts`, `lib/useDoc.ts` and
`SettingsView.tsx` all read lazily, inside a function, and cache; `router.tsx` may spread
`WEB_ROUTES` at module scope only because it is the registry's importer, not its import. The full
account is [WEB's TDZ rule](../WEB.md#the-tdz-rule-never-read-the-registry-at-module-scope).

### 5.5 Session hook

`App.tsx`'s auth gate starts core's change feed once a session exists, then calls every present
feature's `onSession` and keeps the returned teardowns for when the session goes away. In the
Stack's features `chat` starts its feed there, and `notifications` its poller and push-click
listener. The hook exists so that a feature's per-session process starts on the same gate as
core's, and never before a session, when its subscription would only 401.

### 5.6 `slots` and `docs`: registering into a dependency, on the web

`slots` is the web form of § 4.2's rule. The owner of a surface names a slot and types the props it
renders with, and reads contributions through `slotComponents<P>(name)` (`lib/slots.ts`, feature
order); a contributor lists components under that name and never edits the owner. `crm` owns four slots (`crm.account.card`, `crm.account.actions`,
`crm.touch.actions`, `crm.overview.alerts`) and, for contributions that are not components, two
registries of the § 4.3 shape on its web side (`registerCrmColumn`, `registerCrmAttention`); its
SPEC.md, "Extension points", is that contract. `support` owns `support.ticket.panel`, `support.tickets.banner` and
`support.settings.section`; their SPECs, "Extension points", are those contracts.

`docs` exists because of a concrete break: core's `useDoc` once named three features' tRPC
procedures, which made a core web module depend on three features and broke the web typecheck on a
Box with none of them. A markdown doc `kind` is now a feature's: `planning` provides `initiative`
and `task`, `sink` provides `sink`, and `useDoc` resolves a kind through
the registry and names no procedure itself. A kind no present feature provides resolves to `error`,
the same verdict a failed read gets, because to a reader it is the same thing.

---

## 6. The agent-facing contract

### 6.1 The files of a feature

```text
features/<id>/core/manifest.ts                 required CoreFeature
features/<id>/core/index.ts                   required public barrel
features/<id>/core/{types,models,state}.ts    domain code and ModelSpecs
features/<id>/server/index.ts                  required ServerFeature and Nest module
features/<id>/server/<id>/                     controllers and runtime registrations
features/<id>/web/index.tsx                    required WebFeature
features/<id>/web/{routes,views,components,lib}/ web code and stores
features/<id>/skills/<name>/SKILL.md           optional feature skills
```

The feature's documentation lives with its recipe, not in the feature tree, and ships to every Box:

```text
recipes/<id>/RECIPE.md                         catalog entry
recipes/<id>/SPEC.md                           runtime contract and behavior
recipes/<id>/INSTALL.md                        agent adaptation instructions
recipes/<id>/AGENT.md                          adaptation and customisation guide
recipes/<id>/GOTCHAS.md                        recipe-specific operational findings
```

An agent adapts the source and updates maintained registration, root workspace package imports, and
exports as needed. It records completed upstream SHA, path mapping, skipped changes, validation, and
unresolved work in docs/UPSTREAM.md and _docs/INTEGRATION.md. Runtime contracts and package manifests
remain source contracts; no feature package or release catalogue is created.

### 6.2 `box verify`

Run the receiving Box's normal build, typecheck, tests, lint, and schema check, then boot a
disposable instance and exercise the feature's documented surface. Type generation checks tRPC and
MCP namespace collisions. Migration work additionally requires a backup rehearsal, ledger inspection,
and boot verification before unrelated changes continue. Record actual commands and results in the
integration log; a passing lockfile build is not evidence of latest dependency testing.

### 6.3 What the checks cannot see

- **A module-scope read of a web registry** (§ 5.4). Runtime only: load the SPA and read the
  console after touching `App.tsx`, `router.tsx`, `lib/shell.tsx`, `lib/nav.ts` or a feature's
  `index.tsx`.
- **Anything that only runs at boot**: a module's `onModuleInit`, a registered port, the agent
  host. A controller change is covered by `typegen`; a registration is proven by booting a
  throwaway Box.
- **A top-level route colliding with a server prefix or a shipped file** (§ 5.1).
- **A core web module naming a feature's tRPC procedure** (§ 1): only a featureless consumer's
  typecheck sees it. Stack registers every recipe's feature, so its ordinary typecheck cannot prove
  that core works without them.
- **A migration against real rows** (§ 3.5): `box db backup`, a throwaway Box, a restored copy.
