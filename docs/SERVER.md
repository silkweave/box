# The server - NestJS, tRPC, MCP, one port

The Builder supervisor (`apps/server/src/builder/supervisor.ts`) is the Box's **single public front
door**. It serves the stable Builder snapshot and assets, the control routes, and an authenticated
proxy to the managed editable application, whose Nest process serves REST under `/api`, tRPC at
`/trpc`, MCP at `/mcp` and the agent gateway. The browser only ever talks to one origin, so the
SPA uses relative URLs and there is no CORS anywhere.

This file describes **core's server**: what a blank Box (no features installed) already is. A
feature's own controllers, tables and tools are described in the recipe it came from,
`recipes/<id>/SPEC.md`; how to adapt and customise one is that recipe's `AGENT.md`.

- **Stack:** NestJS 12 + `@silkweave/nestjs` v5 (the `trpc()`, `mcp()` and `typegen()` adapters).
  Dev and `box start` run the TypeScript directly through Bun (including decorator metadata,
  no runtime loader); `box build` emits a plain SWC `dist/` for `box start --prod`.
- **ESM-native** (`"type": "module"`), so relative imports carry **`.js` specifiers** - NodeNext
  resolves them to the `.ts` source, SWC leaves them alone.
- **`packages/core` is source-linked** through the `@silkweave/box-source` export condition:
  `bun --conditions=@silkweave/box-source` resolves `@silkweave/box-core` to `packages/core/src/`,
  Bun without that condition resolves it to the tsdown-built `packages/core/build/`. A stale `build/` after a
  rename fails the server tests with a confusing resolution error; `box build` fixes it.
- **Warehouse access** goes through core's ephemeral-connection layer
  (`packages/core/src/warehouse/db.ts`): reads open `read_only`, writes open `read_write`
  serialized in-process and retried on a file-lock conflict, and both close immediately. The server
  never holds the DuckDB lock, so a read-only `duckdb` CLI or MCP server keeps working in between.
  See [`WAREHOUSE.md`](./WAREHOUSE.md).

---

## 1. One method, three transports

Controllers are plain NestJS. Decorators on a method decide which transports it appears on:

```ts
@Controller('ops')
@UseGuards(AuthGuard)
export class OpsController {
  @Get('actions')
  @ApiOkResponse({ type: ActionsDto })
  @Trpc()                                  // → tRPC query `opsActions`
  actions(): ActionsDto { ... }

  @Trpc({ kind: 'subscription', chunk: IngestProgressDto })
  @Mcp({ name: 'run-now' })                // → tRPC subscription `opsRunNow` + an MCP tool
  async *runNow(@Body() body: RunNowDto, @Req() req: PrincipalRequest) { ... }
}
```

- **Input** reflects from `@Param` / `@Query` / `@Body` plus class-validator DTOs; **output** from
  `@ApiOkResponse({ type })`. The DTO classes are not ceremony - they are the schema all three
  transports share.
- **Procedure keys** are `controllerBase + method`, camelCased: `@Controller('ops')` + `runs()` →
  `opsRuns`. A no-input query is still called with an empty object: `trpc.opsRuns.query({})`.
- **Kind inference gotcha:** the kind is reflected from the HTTP verb - `@Get` gives a query,
  `async *` gives a subscription, anything else gives a mutation. A **verb-less** method defaults to
  a query, so pin an action with `@Trpc({ kind: 'mutation' })`. The repo convention for an
  input-carrying read is a mutation (`opsRun` takes an id and is a mutation for exactly that
  reason).
- **Streaming is one shape everywhere.** A `chunk` schema plus an `async *` generator makes the
  adapters switch to per-chunk delivery: a tRPC subscription over SSE, MCP `notifications/progress`,
  NDJSON on the CLI. MCP buffers the chunks into a final result for hosts that pass no
  progressToken.
- **MCP** is mounted by `mcp({ basePath: '/mcp' })` in `app.module.ts` over Streamable HTTP. **The
  transport itself demands a bearer token**, not just the individual tools: a per-tool guard cannot
  gate `tools/list`, which is a transport route rather than a controller method, so without
  transport auth an anonymous client could enumerate every tool the Box has. `verifyToken` calls
  core's `authenticatePrincipal`. The adapter's `filterActions` is the passthrough hook
  (`agent/mcp-passthrough.ts`): a registered source (the `mcp` recipe) adds, per request, the outside
  MCP servers' tools the calling person may use. Without one, and for a request carrying
  `?passthrough=0` (a server-owned session's own `box` server), `/mcp` is the Box's own actions; a
  passthrough action never shadows a Box action.
- **Connection endpoints:** `POST /mcp/connections/<id>` serves one connection's tools under their
  upstream names to agent sessions (core port `mcp-connections.ts`, dispatched in `main.ts` with a
  bearer token, answered by the `mcp` recipe's relay; 404 without the recipe).
- **CLI:** `box <tool-name>` (`packages/cli/src/mcp-proxy.ts`) runs `@silkweave/mcp`'s `cliProxy` against
  a running server's `/mcp` - one subcommand per tool. Configure `mcp.url` and `mcp.token` in
  `box.local.json`. Without an explicit URL, the proxy uses the configured `server.port`. Its
  requests carry `x-box-surface: cli`, which the `mcp` recipe's audit log records.
  Its `@silkweave/box-core/box-json` import reads configuration without loading the warehouse.
- Incidental REST routes sit behind a global `/api` prefix (`setGlobalPrefix('api')`) so they do not
  shadow the SPA's client routes. `/trpc` and `/mcp` are registered by the adapters and are **not**
  prefixed.

## 2. The typed contract reaches the SPA without a boot

The `typegen()` adapter writes the `AppRouter` type to `apps/web/src/generated/appRouter.d.ts`, and
`apps/web/src/lib/trpc.ts` builds a typed `@trpc/client` against it. A `.d.ts` on purpose: the web
app's `skipLibCheck` then ignores typegen's always-on import list, which would otherwise trip
`noUnusedLocals` on `TRPCMutation`/`TRPCSubscription` in a query-only router.

**`bun run typegen` regenerates it without starting a server** (`apps/server/scripts/typegen.ts`).
It runs inside `box verify`, ahead of `typecheck`, so the SPA is checked against current controller
contracts. Generating types does not require listening on a port.

It rests on two facts:

1. The silkweave adapters register in `SilkweaveModule.configure()` - the `NestModule` middleware
   hook - which Nest runs during `app.init()`. `listen()` is not needed, so nothing binds a port and
   a typegen run cannot collide with a Box that is already running.
2. The typegen adapter's `register()` is **fire-and-forget**: it starts an async import and write and
   returns. `init()` resolving does not mean the file is on disk, so the script deletes the target
   first, waits for it to reappear, and fails loudly on a 30s timeout rather than leaving a stale
   file behind a green check.

The script also redirects the instance directory in-process with `setInstanceDir()` from
`@silkweave/box-core/testing` and disables
everything that could arm, so a run never touches the real warehouse, the scheduler, the chat agent
or workerdeck. It also checks the discovered controller graph:

- it fails on a **duplicate action name within one adapter's list**. A method carrying both `@Trpc`
  and `@Mcp` yields two actions that share a name, one per adapter, so a clash only matters inside
  one transport's list - and there it silently shadows an action and drops a key from the router;

`bun run typegen --check` fails instead of writing and restores the file, so a `--check` run never
dirties the tree.

## 3. Auth, at the server level

The design and the operator's view are in [`AUTH.md`](./AUTH.md). What
belongs here is **where the guard sits and why**.

`AuthGuard` (`apps/server/src/auth/auth.guard.ts`) resolves the principal from a `Bearer` token
(API, MCP, CLI) or the session cookie (SPA), attaches it to the request, and requires one.

**It is registered twice, and both are necessary.** `main.ts` calls `app.useGlobalGuards(...)`, which
covers **plain REST routes only** - the silkweave adapters do **not** run global guard instances for
`@Trpc` procedures or `@Mcp` tools. The `changesFeed` subscription leaked anonymously until that was
proven. The real boundary for the adapters is class-level `@UseGuards(AuthGuard)` on every
controller; put it on any new one.

- **`@Public()`** bypasses the guard entirely - login, logout, the sign-in link, `GET /api/auth/me`,
  and `GET /api/auth/instance`. Nothing else.
- **`@Admin()`** additionally requires `principal.role === 'admin'`. The check lives *inside*
  `AuthGuard` rather than in a second `AdminGuard`, because the adapters run exactly the guards
  named in `@UseGuards` - a separate guard would be a second decorator to forget on a method, and
  forgetting it fails open and silently. Putting the tier where the principal is resolved means a
  method cannot be authenticated without also being authorized, on REST, tRPC and MCP alike. The
  role is re-read from the users row on every request (it is not in the cookie), so a demotion takes
  effect on the demoted user's next call.
- **`assertAdmin(req)`** (`auth.decorators.ts`) is the same check for a branch a decorator cannot
  express - admin-only when a particular *field* is set.
- **CSRF**: a cookie-authed state-changing request must carry the `x-box-csrf` header. `SameSite=Lax`
  already blocks cross-site cookie sends on those methods; the header is the second layer.
- **Path mounts** (`registerPathMount`, `packages/core/src/path-mounts.ts`) are served by plain
  middleware in `main.ts`, ahead of the agent mount, the dev proxy and the release SPA fallback, so a feature-owned prefix behaves the same in both topologies. That middleware resolves
  the principal itself (bearer token, then session cookie) before the handler runs: a mount is never
  public. A signed-out browser asking for HTML is redirected to `/?next=<path>` and the SPA returns it
  there after sign-in (`apps/web/src/lib/returnPath.ts`); anything else gets a 401. Bearer requests
  share the API rate limit. Mounted responses carry `setTrustedContentHeaders` instead of the strict
  CSP, for trusted feature-served content such as artifacts. Mount prefixes may not shadow core's
  reserved roots (`/api`, `/trpc`, `/mcp`, `/agent`, `/builder*`, `/login`, `/assets`, `/settings`, Vite's).
  Bearer-authed clients carry no ambient cookie and are exempt by construction. The authorization
  check runs *before* the CSRF check deliberately, so a member calling an admin route hears "admin
  only" rather than a header complaint that suggests one more header would have worked.
- **Reading the principal:** `@Req() req: PrincipalRequest` on `@Trpc`/`@Mcp` methods; the
  `@CurrentPrincipal()` param decorator only runs on plain REST handlers. `req.credential` records
  whether the principal proved itself by `session` or `bearer` - the one distinction a
  human-in-the-loop gate can key on.

`main.ts` also sets strict security headers on every response and applies a coarse per-IP rate limit
to `/api`, `/trpc`, `/mcp` and `/agent`. CSP and HSTS are production-only (a strict CSP breaks Vite's
HMR client), keyed per request off whether it is served by Vite. Static asset loads are not rate-limited.

In development the dev proxy puts Vite, a file server, on the Box origin before anyone signs in,
because the login page is the SPA and loads the whole dashboard module graph anonymously. Two
layers keep that from becoming a read of instance state. `server.fs.allow` in
`apps/web/vite.config.ts` limits Vite itself to apps/web, packages/, features/ and node_modules/ and
denies `box.json`, `box.local.json`, `.env` files, key material and `.git`. Independently,
`auth/dev-proxy-guard.ts` in the server decides every proxied request before Vite sees it: an
`/@fs/` path is percent-decoded once, refused on any `..` or `.` segment, empty segment, residual
`%`, backslash, colon, control character or `#`, resolved through symlinks, and forwarded only if
it lands inside apps/web, packages/, features/ or node_modules/ (never node_modules/.cache, where
tests park throwaway instance directories). The verdict ignores the query string, so `?raw`,
`?url`, `?inline` and `?import` cannot widen it, and it does not depend on a session: a member
needs the same directories as the login page, and a session-gated hole would let any member cookie
read the session secret the day Vite's own check regressed. Only Vite's `/__open-in-editor` hook
requires a signed-in session. Refusals answer 403 and log `dev-proxy.refused`. The HMR websocket
is proxied without a guard: Vite creates the browser environment with `fetchModule` disabled, so
the socket carries no file reads. Widen `DEV_SOURCE_DIRS` and `fs.allow` together, never the
guard alone.

Before Nest is created at all, `bootstrap()` awaits `ensureAgentPrincipals()`. It seeds the agent
principals (the system principal from `box.json` `agent`, fresh default Nova/admin, and one per file
in `data/config/agents/`), retires agent rows whose file is gone and, as a side effect, applies the
warehouse schema, which is
otherwise lazy. It is deliberately **not** wrapped in a try: a Box that cannot write its own
warehouse should fail at boot, loudly, rather than at the first request.

## 4. The ops kernel and the run funnel

Core owns the kernel (`packages/core/src/ops/`) and its server surface
(`apps/server/src/ops/ops.controller.ts`). The trigger scheduler over the same registry is the
`automation` feature, outside core. The Stack carries it as a recipe; consumers adapt it
separately. See `recipes/automation/SPEC.md`.

**An action** is `{ id, label, group, description, run }` (`ops/types.ts`), where `run` is an
`async function*` yielding `IngestProgress` chunks (`{ channel, phase, message, result? }`) and
ending with a `done` chunk carrying the final `PullResult`. That one shape is why an action is
simultaneously a dashboard button, an MCP tool and a CLI subcommand.

**The registry is not a hand-maintained list.** `ops/registry.ts` is core's own `CORE_ACTIONS` plus
`FEATURE_LIST.flatMap(f => f.actions ?? [])`, indexed once and cached. Two ids from two different
owners throw at index time, naming both owners. A blank Box has core's own actions:
`warehouse-backup`, `sources-sync` and `source-sync` (the data source syncs, see
[SIGNALS.md](SIGNALS.md)). **A feature contributes an action by listing it in `actions` on its core
manifest** (`defineCoreFeature`) - nothing outside the feature is edited.

**The funnel** is `ops/run.ts`. Every execution - a cron fire, a dashboard "Run now", an MCP call
from an agent, the CLI - goes through `executeRecorded()`, which wraps the generator in an
`automation_runs` row (`queued` → `running` → `success`/`error`) and keeps the progress stream as
the run's live log (`ops/run-log.ts`, shared with agent trigger runs): `readRun` serves it from
memory while the run is active, a throttled flush writes it to the row at most every 5 seconds
(never per line: the warehouse is single-writer), and finalization writes it in full (capped at the
last 2000 lines - backfills stream thousands; each line has a per-run `seq`). `onRunLog` hands
each new line to `opsRunTail`, and every row state change emits `table:automation_runs` (with the
run id) on the change bus. The queue is in-process FIFO with
concurrency 1, because the warehouse is single-writer. A caller that wants skip-instead-of-queue
checks `isActionBusy()` first and records a `skipped` row.

**"Run now" is detached from its viewer.** `startDetachedRun(actionId, meta)` starts the run and
returns a `tail()` generator; `opsRunNow` yields from it. Unsubscribing - navigating away, closing
the tab, hanging up an MCP client - only stops the live tail. The run continues to completion and
finalizes normally.

**What happens after a run is not core's business.** Features subscribe with `onRunOutcome(listener)`
from their server module's `onModuleInit`. Listeners are best-effort, awaited, logged on throw, and
can never affect the run's own outcome.

The controller's four procedures, present in every Box:

| procedure | what |
|---|---|
| `opsActions` (query) | the catalogue: every action this Box has, minus the runner |
| `opsRuns` (query) | the latest 100 runs, no logs; an active run carries its newest line as `latest` |
| `opsRun` (mutation, MCP `run-get`) | one run including its log, live while it runs; `after` (seq) and `tail` (n) narrow the log |
| `opsRunTail` (subscription) | follow one run: its log so far (or after `after`), each new line, then a `done` chunk with the outcome; same access as `opsRun` |
| `opsRunNow` (subscription, MCP `run-now`) | run any action now, streaming, recorded as `trigger: 'manual'` and attributed to the authenticated principal unless the caller names someone |

## 5. Changes and events

Two separate spines. Neither carries row data across the wire.

**`packages/core/src/changes.ts` is the invalidation seam.** Write paths emit a scope string when
they commit - `table:<name>`, `docs:<section>`, `config:<file>`, or the generic `warehouse` - and
`emitChange` fans it to in-process listeners. It never throws; a bad listener cannot break a write.
Two producers feed it:

- **precise and immediate**: the warehouse record layer emits a per-table event for every in-process
  write, so the web UI, MCP tools, REST and scheduled runs all funnel through the one producer;
- **coarse and watched**: `apps/server/src/changes/changes.watcher.ts` runs a recursive fs watcher
  over the Box's data directory for edits that bypass the server entirely (a local agent session
  editing markdown, an editor, an external DuckDB writer), debounced 300ms per scope. Its
  `data.db*` events are suppressed within 3s of an in-process write (`lastWarehouseWriteAt()`), so
  the precise `table:` events are not doubled by a generic `warehouse` one. A missing data directory
  degrades the feed to in-process events rather than taking the server down.

`ChangesController` exposes one long-lived tRPC subscription, `changesFeed`. Its first event is a
`hello` carrying a per-process `BOOT_ID`: a client that sees a **second** hello (a reconnect, a
server restart) knows events may have been missed and reloads its stores instead of replaying. A
`ping` every 45s keeps idle connections off the reaper. The web app subscribes over the `/trpc`
WebSocket (see [WEB.md](WEB.md), "The client"); the mobile app over SSE. Events are invalidation hints only, so
fanning them out to any authenticated principal leaks nothing beyond "something in `<scope>`
changed".

**`packages/core/src/events.ts` is the persisted spine.** The server-relevant half: `recordEvent()`
is idempotent on `(kind, dedup_key)` and returns whether the event was **fresh**; `onEvent(listener)`
subscribes to fresh events only, after the row is committed, awaited before `recordEvent` resolves.
Best-effort, in-process, no outbox, no replay across restarts - a subscriber that needs
at-least-once semantics reads the `events` table instead. Features register their listeners from a
server module's `onModuleInit`; a listener that starts funnel work queues it and returns, never
awaits it. `withEventDepth` / `outsideEventChain` carry an event chain's depth onto the events its
work records. The spine itself, and the table, are the warehouse doc's:
[`WAREHOUSE.md`](./WAREHOUSE.md).

## 6. The agent host

`apps/server/src/agent/` is core. A blank Box has it. Only the agent's *seat in chat* belongs to the
`chat` feature, documented in `recipes/chat/` and present only once that recipe is adapted.

**Builder has a dedicated WorkerDeck host in the supervisor.** Its shared session stays outside
the restartable editable application. Ordinary agent and chat sessions still use a separate
WorkerDeck host inside Nest, booted by `agent/workerdeck.host.ts` before application initialization.
The WorkerDeck web dashboard is not installed; the Box supplies its own workspace UI.

The supervisor serves the Builder snapshot at **/builder**, its **/builder-assets/** assets and
the narrow control plane. The editable application remains a separate managed process. A provider
or application failure must leave the stable Builder/recovery surface reachable.

**`agent.mount.ts` is a mount, not a proxy.** The Box authenticates the caller, gates the request,
rewrites `/agent/...` → `/...`, and hands the **same** `req`/`res` to `worker.server` with
`emit('request')` / `emit('upgrade')`. No second socket, no second HTTP parse, no shared secret on
the browser path. The Box keeps the upgrade listener rather than handing the socket to workerdeck's
own `fallback` option, deliberately: workerdeck's upgrade listener `socket.destroy()`s every upgrade
that is not a session WS, which would need exactly the surgery that avoids for Vite's HMR socket.
`main.ts` stays the one upgrade dispatcher. The mount runs as plain express middleware ahead of
Nest's router, so it re-implements the guard's rules itself (principal required, CSRF header on
cookie-authed mutations).

**Enforcement is two independent layers, and the second one is why it holds.**

- **Layer A** is the mount's pre-handler gate: the URL lists and the create stamp. It matches URLs as
  strings, which is exactly the kind of check one extra `/` can slip past - so it compares a
  **normalized** path (`gatePath`, collapsing duplicate and trailing slashes). That is load-bearing:
  the worker's own `parseRoute` treats `/v1/sessions/` as the same collection as `/v1/sessions`, so
  a raw-string gate let one extra slash through unstamped, i.e. a create with a client-chosen
  profile. Two refusal lists sit beside it: `UNSTAMPED_WRITE` (`/agent/v1/jobs`, `/agent/v1/queue`)
  because a job body carries its own session config that the create gate never sees, and
  `NOT_EXPOSED` (`/agent/v1/fs`) on **any** method, because those routes mount on `allowedCwdRoots`
  alone and a roots change would otherwise publish the checkout to every signed-in user. It is a
  separate list from `UNSTAMPED_WRITE` because the exposure is a `GET`, and a write-only gate on a
  read hole is the wrong shape. Anything added to the worker that can start work, or read a file,
  belongs in one of those lists. The job queue is on (agent triggers use it, see
  `recipes/automation/SPEC.md`), and only the loopback listener's host principal submits to it.
- **Layer B** lives *inside* workerdeck, driven by the `AgentAuth` the mount stashes on the request
  under a module-private **symbol**. A signed-in principal is handed their own `allowedProfiles`,
  `scope: { user }`, `operator: false`, `canManageProfiles: false` and an `authorizeSession`.
  workerdeck consults those in `resolveProfile`, `applyScope` and `canSee` wherever they happen to
  run, so the binding is **path-independent** in a way a string gate can never be. A symbol rather
  than a header on purpose: it cannot ride the wire, so a request arriving on the loopback listener
  can never forge a principal, and a mounted request that reaches `authenticate` without one falls
  through to the boot-key check and 401s - fail closed.

**Whose account runs a session is stamped, never taken from the client.** The profile is resolved
from the authenticated principal *and* the requested engine. The browser may send `engine` on
create - safe where naming a profile is not, because it only selects among that user's own profiles
and can never widen who they are - and the mount consumes it, strips it, and stamps the mapped name. An
engine the user has no profile for is `403 agent_engine_unmapped`, naming the engines they do have,
never a silent fall back to another engine. An unmapped user is `403 agent_profile_unmapped`. **No
mapping at all means unpinned**: nothing is stamped and the worker resolves its own profile.
`GET /api/agent/config` (`AgentController`, any signed-in principal) is the policy endpoint the SPA
reads, so the browser never invents a cwd or names a config dir; `permissionMode` and `model` are
returned as `null` on purpose, because the worker owns the per-profile default and naming one here
would override it for whichever engine the session lands on.

**Agent accounts.** The profiles from `box.json` `workerdeck.profiles` reach WorkerDeck as a
memory profile store rebuilt on every boot, not as declared profiles, because WorkerDeck refuses
account connect for declared ones. `allowedConfigDirRoots` is the set of each config dir's parent.
No principal may manage profiles over the API, so `box.json` stays the only place they are defined.
`box setup` declares the owner's profiles on config dirs inside the Box,
`data/agent/accounts/<owner>/{claude,codex}` (0700), so connecting never touches the person's own
`~/.claude` or `~/.codex` login; reusing those is an explicit setup choice (docs/SETUP.md).
Every profile carries `connectors: false` (claude.ai connectors never run in Box sessions).
A profile's `defaults` (`model`, `permissionMode`, and `efforts`, the reasoning effort per model)
reach WorkerDeck for both engines and apply when a session names no value of its own; an unknown
key or permission mode fails the boot of the agent surface. The chat agent names its own model and
effort (`features.chat.agentModels`, recipes/chat/SPEC.md), so profile defaults govern Work and
Builder sessions and unattended runs.
Settings > Profile (your own) and the Users detail (an admin, for anyone including the agent) list
a person's profiles from `GET /api/agent/accounts?user=<id>` (another person's list is an
admin's) and connect them with WorkerDeck's `AccountConnectDialog` over the mount:
`POST /agent/v1/profiles/<name>/account/connect` and `.../complete`, `DELETE .../account`.
WorkerDeck runs the official `claude setup-token` in a PTY, keeps
the one-year token in `<configDir>/workerdeck-account.json` (0600) and injects it as
`CLAUDE_CODE_OAUTH_TOKEN` into that profile's sessions, the Builder gateway's included. Its
`accounts.canConnect` allows a Box principal on their own profiles and an admin on anyone's; the
mount lifts an admin's profile pin on exactly these account routes. Codex profiles connect by
device sign-in (WorkerDeck 3.10): the dialog shows a user code for the ChatGPT page and `complete`
long-polls until the login lands in the profile's `CODEX_HOME`; it stores no `account` record, so a
Codex profile reads as connected from its availability. `requireApiKey` must stay off. Under Bun,
WorkerDeck's own PTY loader picks Bun's PTY (`@lydell/node-pty` loads under Bun but never starts
the child); without a PTY the routes answer 501.

**Default profile.** Each user's `users.agent_profile` (migration `core:006-users-agent-profile`)
names one of their `agentProfiles`. The first account connected on the panel becomes the default
when no connected default exists; "Use as default" and "Clear" appear only once a second account is
connected (or the chosen default is no longer connected). Null keeps the deployment rule (Claude
first). `preferredAgentEngine` returns its engine, so it is the default for
a new sidebar session (the browser's last pick still wins there; choosing your own default sets it),
the engine a trigger runs on when it names none, and the Work panel's default. For the agent
principal it is the only profile: chat replies and every trigger that runs as the agent use it
(a trigger's own engine is ignored and a model chosen for another engine is dropped), and a room's
live chat session is retired between turns when it changes. The server reads the users table at boot
to warm the in-process cache (`agent-defaults.ts`) that the synchronous rule reads.

**`agentSessionAccess` is core's, and it is a port** (`packages/core/src/agent-session.ts`, tested).
Core knows exactly one rule - **ownership is `scope.user` and nothing else** - which is the only rule
a featureless Box needs. Anything that *widens* access beyond the owner is a rule a feature
registers with `registerAgentSessionRule(id, rule)`; the first non-`none` verdict wins, a rule that
throws is logged and skipped rather than trusted, and with no feature installed the registry is
empty and every non-owner is `none`. Today exactly one rule exists: chat's "a room's readers may
read that room's agent turn", registered from `ChatModule`.

The `reader` verdict is about **reading**, and turning it into "may attach" would be a serious
mistake, because workerdeck's attach socket is bidirectional: it honours `user_message`,
`permission_decision`, `interrupt`, `clear_context`, `set_permission_mode`, `set_model`,
`tool_call_result` and `close` from any attached socket without re-checking who is attached. So the
split is enforced in two places:

- **REST**: layer A stamps `readOnly: true` on the `AgentAuth` for `GET`/`HEAD` only - by **method**,
  not by URL, so it holds on a worker route the mount has never heard of - and layer B's
  `authorizeSession` admits a `reader` only when `readOnly === true`.
- **The socket**: readers never get the worker's socket at all. The upgrade handler recognizes a
  reader on `/agent/v1/sessions/:id/ws` and serves a **relay** (`session-relay.ts`) that terminates
  the browser's socket here, opens the Box's own attach to the loopback listener as the host,
  forwards every upstream frame and forwards **nothing** inbound. The guarantee is structural -
  there is no code path that forwards a browser frame, rather than a list of refused frame types.
  Inbound frames are dropped rather than punished with a close, because a well-behaved viewer
  legitimately sends some (a `tool_call_error` when it has no tool host). The upgrade path stamps
  `readOnly: false` unconditionally, so a reader who reaches the worker's own upgrade handler is
  refused there.

**The loopback listener and its boot key.** The host also binds an OS-assigned port on `127.0.0.1`.
That listener is *not* the browser's path; it exists for server-side callers that need a real
`WorkerDeckClient` because the attach protocol (replay-from-seq, outbox, permission frames) is what
they are built on. Loopback is **not** a trust boundary: other services share it, and every agent
session the Box spawns can reach it, so without a credential a session under one profile could
create a session under another. Hence `BOOT_KEY` - 32 random bytes minted per boot, held only in
that module's closure, never on disk, never in `process.env`, never in a session's environment, so
unlike a configured secret it cannot be read by a session that can already `cat` the repo. Compared
by SHA-256 digest with `timingSafeEqual`. A client holding it is `via: 'host'` to layer B: an
operator, which is correct - it owns the sessions it creates and there is no user to scope it to.
Use the client helper that returns `headers` **and** a WS URL builder together: REST takes an
`authorization: Bearer` header while the attach socket takes the key in the query string, because a
socket handshake cannot carry a custom header, and passing only headers fails *silently* - the REST
create succeeds, the socket is rejected at the handshake, and `send()` buffers into a socket nobody
reads.

**`loopback-guard.ts` answers "is `127.0.0.1:<port>` actually us?"** The check is a nonce, not a hostname or a port: the
process mints `INSTANCE_ID` at import and serves it at the `@Public()` route `GET
/api/auth/instance`, so "is that me?" is a string comparison that cannot be faked by a second Box, a
proxy, or a tunnel to a machine running this same code. It is re-checked rather than checked once,
because the hazard is dynamic (a tunnel appears and vanishes while the Box keeps running), with a
15s cache and a 2s timeout. **A failed probe counts as "not ours"**: the point is to gate
credentialed writes on a positive identification, and "I could not tell" is not one. `main.ts` prints
a loud warning at boot when the verdict is negative; a caller that is about to spend credentials
calls `verifyLoopback()` itself.

**Draining on shutdown.** `SIGTERM`/`SIGINT` ask the supervisor to drain the managed application
and WorkerDeck host before exiting, once. A bare host exit can cut live turns mid-flight. Test
shutdown and recovery for each configured engine; idle-session recovery does not establish that an
active turn survives application restart.

## 7. Running and serving

```bash
box dev          # start the supervisor with the editable dev app and Vite (:5190)
box build        # core (tsdown → build/) + web (vite → dist/) + server (swc → dist/)
box start        # built mode: promoted web release for everyone, Vite only for a Builder Preview
box start --prod # the same supervisor; kept as the production spelling
box app promote  # typecheck, build and publish a new web release (built mode)
box verify       # the full check chain - see the root AGENTS.md
```

**No build step type-checks.** swc (server), tsdown (core) and vite (web) all strip types without
checking them. **tsgo** is the sole type-checker and runs in `bun run typecheck`, inside `box verify`.

**The public supervisor port is `8190`; the managed Nest and dev Vite ports are internal**, from
`box.json` (`server.port`, `server.vitePort`). Set different values in the gitignored
`box.local.json` when running another instance. The supervisor listener and its loopback probe use
the configured public value. The public listener binds `server.host`, `127.0.0.1` by default;
exposing a Box to other machines is an explicit `box.local.json` choice (see CONFIGURATION.md).

**The supervisor is the single public origin.** It listens on the configured server port and
serves the stable Builder snapshot, Builder assets, control routes and authenticated proxy to the
managed editable application. The Nest process uses an internal port owned by the supervisor.
The browser still talks to one origin; the process boundary is internal to the Box.

- **dev:** **box dev** starts the supervisor, Vite and the editable Nest application. The
  supervisor owns the public port, serves **/builder** and **/builder-assets/**, and proxies
  ordinary application traffic to the managed internal port.
- **built (box start, box start --prod):** the same supervisor boundary without `--dev`. Everyone
  loads the promoted web release; Vite runs only for the Builder Preview while a Builder session
  is open. See [Built mode](#built-mode-one-release-for-everyone-vite-for-the-builder-preview).
  The Builder snapshot and control plane remain available when the editable application is
  restarting or needs repair.
- **Upgrades:** WorkerDeck Builder sockets terminate at the supervisor. Application WebSocket
  traffic is proxied only to the managed application while it is available.
- **Routing:** **/api**, **/trpc**, **/mcp** and **/builder-control** are control-plane routes;
  **/builder-agent** is the authenticated Builder gateway. Editable application routes are
  proxied separately and must not claim the Builder snapshot paths.
- **Tailscale:** the supervisor binds the public port on `server.host`, `127.0.0.1` by default.
  The recommended way to reach a Box over the tailnet is `tailscale serve`, which terminates HTTPS
  on the tailnet and proxies to loopback, so `server.host` can stay at its default:
  `tailscale serve --bg --https=443 http://localhost:8190` (use the Box's `server.port`), and
  `tailscale serve --https=443 off` to stop. Put the resulting `https://<machine>.<tailnet>.ts.net`
  in `server.dashboardUrl` in `box.local.json`; sign-in links and the mobile app scripts use it, so
  the mobile app gets the HTTPS address ([MOBILE.md](MOBILE.md)). Binding `server.host` to `0.0.0.0` and using
  `http://<machine>.<tailnet>.ts.net:<port>` also works but is plain HTTP. The supervisor forwards
  managed application traffic internally; Vite host checks apply only to its development child.

### Built mode: one release for everyone, Vite for the Builder Preview

Vite's dev server sends hundreds of unminified modules per page load (tens of megabytes), which is
fine on a LAN and unusable over a remote link. Built mode keeps everyone on a compact release while
an administrator still edits with hot reload in Builder.

- **One application process.** The Builder edits the live checkout in place, and the Nest process
  always runs that source, so backend changes reach every user on `box app restart`, in either mode.
  Only the web frontend is split. Between promotions the release talks to whatever backend was last
  restarted; additive API changes are harmless, breaking ones show until the next promotion.
- **Releases.** `data/web/releases/<uuid>/` holds each published build, `data/web/current` names
  the live one, and `release.json` records the source revision and whether the checkout had
  uncommitted changes. A release is built with `vite build --mode=release` (the application entry
  only), gets a `box-web-release` meta tag, and is precompressed once (brotli quality 9 and gzip) so
  serving costs no CPU. The five newest releases are kept, and a hashed `/assets/*` request falls
  back through them, so a tab opened before a promotion still loads its lazy chunks. `apps/web/dist`
  is never served once a release exists, because Builder's checked restart rebuilds it.
- **Serving.** The supervisor answers `/assets/*` from the releases directly (`immutable`, negotiated
  `br`/`gzip`, `Vary: Accept-Encoding`), so assets load even while the application restarts. Nest
  serves the SPA fallback (`index.html` with `no-cache`, other release files, a 404 for a missing
  hashed chunk) from plain middleware in `main.ts`; reserved prefixes and path mounts take
  precedence.
- **Per-request routing.** The supervisor strips any client `x-box-frontend` header and sets
  `x-box-frontend: dev` only when a signed-in administrator has a Builder session open, Vite is
  running, and the request is either a framed document load (`Sec-Fetch-Dest: iframe`, which only the
  Builder Preview produces) or one of Vite's own paths (`/@vite/`, `/@fs/`, `/@id/`, `/src/`,
  `/node_modules/`, `/@react-refresh`, `?html-proxy`, and the `vite-hmr` socket). Nest proxies those
  to Vite and serves everything else from the release. Vite paths are a 404 for anyone else, so in
  built mode Vite is never reachable anonymously. A browser without Fetch Metadata gets the release
  in the Preview, which is safe. The admin decision is cached for ten seconds per session cookie, so
  a Preview load costs one `/api/auth/me` call rather than hundreds.
- **Vite lifecycle.** Vite starts with a Builder session (and at boot when one is open) and stops
  when the session ends or finishes, so an idle Box runs only the supervisor and Nest.
- **Promotion.** Builder's **Promote** control and `box app promote` typecheck, then build and
  publish a release. **Finish** in Wrap Up promotes after integration without a second typecheck,
  because verification already passed. A failed build keeps the previous release. At boot outside a
  Builder session the checkout is the integrated state: the supervisor builds a release when none
  exists or the current one does not match a clean `HEAD`. During a session it keeps the last
  release. Open tabs learn about a new release through `/api/box-status/events` and offer a reload;
  nothing reloads by force.
- **Compression in development.** Vite responses (JavaScript, CSS, HTML, JSON, SVG) are gzipped on
  the way out for non-loopback clients, in `box dev` and for the Builder Preview alike. `/api`,
  `/trpc`, `/mcp` and `/agent` are left alone, so event streams are never buffered.
- **Dependency pre-bundling.** `optimizeDeps.entries` scans every feature's web source and the UI
  library at startup. Otherwise a dependency first met in a lazily loaded view is optimized mid
  session, and Vite answers with a full reload of every open Preview.

**Boot a throwaway Box** without touching your real data. The instance directory is always
`<checkout>/data` and no variable moves it, so a throwaway is a SECOND CHECKOUT of the repo. In it,
give `server.port` and `server.vitePort` in its gitignored `box.local.json` unused numbers, leave every
`background` switch false, then:

```bash
bun install && bun run --filter @silkweave/box-web build
bun --no-env-file --conditions=@silkweave/box-source \
  apps/server/src/main.ts
```

`bun install` writes that checkout's `box.json`; put local auth secrets in its gitignored
`box.local.json`. The first user on a fresh Box comes from
`box auth token <id> --name "Full Name"`, which mints an **admin** and only ever on a Box with no
users yet.

## 8. How a feature plugs into the server

`apps/server/src/feature.ts` is the whole contract:

```ts
export interface ServerFeature {
  id: string
  module: Type<unknown>                                          // imported into AppModule verbatim
}
```

`features/<id>/server/index.ts` default-exports one `defineServerFeature({...})`. The
maintained registration `apps/server/src/generated/features.ts` is the **only** file outside the feature that names it, and `app.module.ts`
spreads `SERVER_FEATURE_LIST.map(f => f.module)` into its imports after core's own modules
(`AuthModule`, `UsersModule`, `ChangesModule`, `OpsModule`, `AgentModule`, `SignalsModule`) and before
`SilkweaveModule.forRoot`.

The smallest possible feature is one line:

```ts
export default defineServerFeature({ id: 'sink', module: SinkModule })
```

- **The module is a normal Nest module.** Its controllers are discovered by the adapters like core's,
  so a feature's `@Trpc`/`@Mcp` methods land in the same two flat namespaces - which is why typegen
  fails on a name collision across features.
- **Registering into a port** - `onEvent`, `onRunOutcome`, `registerAgentSessionRule`,
  `registerUserCleanup` - happens in the module's `onModuleInit`, and the module unregisters on
  destroy. This is the direction the seam prescribes: a dependent registers into a dependency, never
  the reverse. See [`docs/core/SEAM.md`](./core/SEAM.md) § 4.3.
- **A feature may own a store outside the warehouse.** DuckDB is single-writer across processes and
  every query opens an ephemeral connection with lock-conflict backoff - right for "one UPSERT plus
  a re-derive", wrong for many tiny writes at interactive latency plus point reads, and a feature
  contending for that lock would degrade every read-only reader of the warehouse too. So a feature
  with that access pattern is allowed its own file, entirely inside its own directories; the `chat`
  feature is the one that does it today.
- **Actions, tables and migrations** are declared on the *core* manifest (`defineCoreFeature`), not
  this one. A feature with no schema of its own ships `migrations: []` - the ledger is append-only
  and starts empty. See [`docs/core/SEAM.md`](./core/SEAM.md) § 3 and [`WAREHOUSE.md`](./WAREHOUSE.md).

After adding or removing a feature, update the maintained registration imports, then run `box verify`.

## 9. What `box verify` does not cover

It has **no runtime step**. It cannot see a module-scope read of a generated registry, which throws
at load because the registry is on an import cycle with every view. Type-checking, linting and both
test suites pass; the SPA white-screens. Read a registry lazily, inside a function, and load the app
in a browser after touching the app's root files. The server half of that rule: a controller change
is covered by `bun run typegen` inside `verify` and needs no boot, but anything that only runs at boot -
a module's `onModuleInit`, a registered port, the agent host - is proven by booting a throwaway Box
(§ 7) and nothing else.


## Runtime diagnostics

The supervisor and application emit structured JSON diagnostic records to standard output, alongside
normal Nest, Vite and Builder command output. Each record includes UTC time, PID, component and event.
Capture a diagnostic session with `box dev > _docs/box-runtime.log 2>&1` after creating `_docs/`.
The capture belongs in local developer notes, not committed product documentation. Stop the process
before removing its capture; this explicit capture is not automatically rotated.

- `process.heartbeat` reports uptime, RSS and event-loop delay every 10 seconds. A gap followed by a
  large delay indicates that process could not service its loop on schedule.
- `http.start`, `proxy.headers` and `http.finish` carry matching request IDs across the supervisor
  and application. `http.wait` means no headers have been sent after 10 seconds; `http.open` means
  headers were sent and the connection remains open, which is normal for SSE. Premature closure and
  upstream errors have distinct events.
- `ws.upgrade-request`, `ws.upgraded`, `ws.upgrade-refused`, upstream/peer closure and socket errors
  show where a live-reload or agent connection stopped. No WebSocket payloads are logged.
- `operation.queued`, `operation.start` and `operation.finish` expose Builder queue delay and work
  duration. Control actions, UI refreshes and child build commands have separate start/end records.
- Lifecycle logs identify child PIDs, readiness attempts, unexpected exits, restart requests, stop
  signals and forced termination. Application boot logs bracket schema, Nest and WorkerDeck setup.

Diagnostic records exclude request bodies, cookies, authorization headers and query strings.
Dynamic paths and document IDs become route categories; errors record their kind/code rather than
potentially sensitive messages. Existing framework and child-command output retains its own format.
These logs do not change restart behavior or HTTP timeouts.

The supervisor forwards WebSocket upgrades on dedicated HTTP connections (`agent: false`).
Keep them out of the ordinary HTTP connection pool: under Bun, reusing a warmed connection across
both proxy hops can stall the upgrade until the development client's timeout, causing a reload.
The regression test exercises HTTP warm-up followed by repeated upgrades through a second proxy
using the Bun runtime.

### Maintenance mode

Maintenance is one file the supervisor owns, `data/builder/maintenance.json`: the switch
(`enabled`), whether admins are locked out too (`lockAdmins`), and a public notice (a short
`status`, a checklist of `tasks` that are pending, active, done or skipped, an `eta` and when it
started). Builder changes it through its control API (`/api/builder-control/maintenance`), the host
through `box maintenance` on the local supervisor socket; both send the same change document, so a
task tick and a revised estimate land together. Switching on or off restarts the app into or out
of its paused boot (background work off); editing the notice only rewrites the file. Switching off
clears the notice and the lock.

While it is on, the supervisor answers signed-out documents with a branded, self-contained page
(name, logo and accent from `box.json`, light and dark) that renders the notice, counts down to the
estimate, follows the status stream and reloads once the Box answers again. Other requests get a
503. Admins pass unless `lockAdmins` is set; then everything except the page, its logo, release
assets and the status stream is refused, including Builder, and open admin connections are
dropped. Only the host can set or clear the lock. A document request that reaches the app while it
is restarting gets the same page in a "restarting" state instead of a JSON error. The notice is
public: write it for the team, without internal detail.

Open app tabs, signed in or not, follow maintenance through `/api/box-status/events`, a WebSocket
endpoint owned by the supervisor (a WebSocket does not take one of the browser's six HTTP/1.1
connections per host). A tab that maintenance blocks (signed out, a member, or an admin
while admins are locked out) moves to the page's own address, `/api/box-status/page?return=<path>`,
which serves the same page while maintenance lasts and then sends the tab back to the same-origin
path it came from. A tab opened on `/login` keeps the sign-in form while admins are not locked out,
so the page's Admin sign-in link works. The page and its logo sit under `/api` and `/builder-assets`,
which the bare Vite port proxies to the supervisor, so the page looks the same on either port in
`box dev`. The socket sends the current maintenance flag and public notice as a JSON frame on connection and after
changes to the maintenance file, including atomic replacements. One shared 500ms file-stat watcher serves all connected tabs without native filesystem watchers;
a 15-second heartbeat also reconciles missed filesystem notifications and pings each socket,
dropping one that missed the previous pong. Tabs and the page reconnect after 3 seconds and receive
a fresh snapshot. The endpoint remains available
during application restarts. Slow clients are disconnected instead of accumulating buffered data.
The JSON `/api/box-status` snapshot remains available for diagnostics. Both expose only the
maintenance flag and the public notice (never its author); application access and admin
exceptions remain independently authenticated.
