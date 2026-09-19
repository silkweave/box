# The server - NestJS, tRPC, MCP, one port

`apps/server` (`@silkweave/box-server`) is the Box's **single front door**. One process serves the
SPA, the REST routes under `/api`, the tRPC transport at `/trpc`, the MCP transport at `/mcp`, and
the agent mount at `/agent`. The browser only ever talks to one origin, so the SPA uses relative
URLs and there is no CORS anywhere.

This file describes **core's server**: what a blank Box (no features installed) already is. A
feature's own controllers, tables and tools are described in its `features/<id>/SPEC.md`; how to
install and customise one is its `AGENT.md`.

- **Stack:** NestJS 11 + `@silkweave/nestjs` v4 (the `trpc()`, `mcp()` and `typegen()` adapters).
  Dev and `pnpm start` run the TypeScript directly through `@swc-node/register` (decorator metadata,
  no build step); `pnpm build` emits a plain SWC `dist/` for `pnpm start:prod`.
- **ESM-native** (`"type": "module"`), so relative imports carry **`.js` specifiers** - NodeNext
  resolves them to the `.ts` source, SWC leaves them alone.
- **`packages/core` is source-linked** through the `@silkweave/box-source` export condition:
  `node --conditions=@silkweave/box-source` resolves `@silkweave/box-core` to `packages/core/src/`,
  a plain `node` resolves it to the tsdown-built `packages/core/build/`. A stale `build/` after a
  rename fails the server tests with a confusing resolution error; `pnpm build` fixes it.
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
  core's `authenticatePrincipal`.
- **CLI:** `pnpm cli` (`packages/cli/src/mcp-proxy.ts`) runs `@silkweave/mcp`'s `cliProxy` against
  a running server's `/mcp` - one subcommand per tool. Configure its URL and bearer token in the
  client config. It duplicates the default port number because its import graph
  is deliberately thin - no `@silkweave/box-core`, so no DuckDB - and cannot reach `DEFAULT_PORT`;
  keep the two in step.
- Incidental REST routes sit behind a global `/api` prefix (`setGlobalPrefix('api')`) so they do not
  shadow the SPA's client routes. `/trpc` and `/mcp` are registered by the adapters and are **not**
  prefixed.

## 2. The typed contract reaches the SPA without a boot

The `typegen()` adapter writes the `AppRouter` type to `apps/web/src/generated/appRouter.d.ts`, and
`apps/web/src/lib/trpc.ts` builds a typed `@trpc/client` against it. A `.d.ts` on purpose: the web
app's `skipLibCheck` then ignores typegen's always-on import list, which would otherwise trip
`noUnusedLocals` on `TRPCMutation`/`TRPCSubscription` in a query-only router.

**`pnpm typegen` regenerates it without starting a server** (`apps/server/scripts/typegen.ts`). That
matters more than it sounds: until it existed, `appRouter.d.ts` only changed when somebody ran the
server, so a controller edit plus `pnpm typecheck` type-checked the SPA against a **stale** router -
a renamed or deleted procedure passed every check and broke in the browser. `pnpm typegen` now runs
inside `pnpm verify`, ahead of `typecheck`. **A controller change no longer needs a boot.**

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
everything that could arm, so a run never touches the real warehouse, the scheduler, the chat agent or workerdeck. Two
extra jobs it does while it has the controller graph in hand:

- it fails on a **duplicate action name within one adapter's list**. A method carrying both `@Trpc`
  and `@Mcp` yields two actions that share a name, one per adapter, so a clash only matters inside
  one transport's list - and there it silently shadows an action and drops a key from the router;

`pnpm typegen --check` fails instead of writing and restores the file, so a `--check` run never
dirties the tree.

## 3. Auth, at the server level

The design and operator reference is [`AUTH.md`](./AUTH.md). What
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
  Bearer-authed clients carry no ambient cookie and are exempt by construction. The authorization
  check runs *before* the CSRF check deliberately, so a member calling an admin route hears "admin
  only" rather than a header complaint that suggests one more header would have worked.
- **Reading the principal:** `@Req() req: PrincipalRequest` on `@Trpc`/`@Mcp` methods; the
  `@CurrentPrincipal()` param decorator only runs on plain REST handlers. `req.credential` records
  whether the principal proved itself by `session` or `bearer` - the one distinction a
  human-in-the-loop gate can key on.

`main.ts` also sets strict security headers on every response and applies a coarse per-IP rate limit
to `/api`, `/trpc`, `/mcp` and `/agent`. CSP and HSTS are production-only (a strict CSP breaks Vite's
HMR client), keyed off whether the dev proxy is on. Static asset loads are not rate-limited.

Before Nest is created at all, `bootstrap()` awaits `ensureSystemPrincipal()`. It seeds the machine
account (identity and role from host config, fresh default Nova/admin) and, as a side effect, applies the warehouse schema, which is
otherwise lazy. It is deliberately **not** wrapped in a try: a Box that cannot write its own
warehouse should fail at boot, loudly, rather than at the first request.

## 4. The ops kernel and the run funnel

Core owns the kernel (`packages/core/src/ops/`) and its server surface
(`apps/server/src/ops/ops.controller.ts`). The cron scheduler over the same registry is the
`automation` reference app, which is not in this repo: adopt it and read the `features/automation/SPEC.md`
that arrives with it.

**An action** is `{ id, label, group, description, run }` (`ops/types.ts`), where `run` is an
`async function*` yielding `IngestProgress` chunks (`{ channel, phase, message, result? }`) and
ending with a `done` chunk carrying the final `PullResult`. That one shape is why an action is
simultaneously a dashboard button, an MCP tool and a CLI subcommand.

**The registry is not a hand-maintained list.** `ops/registry.ts` is core's own `CORE_ACTIONS` plus
`FEATURE_LIST.flatMap(f => f.actions ?? [])`, indexed once and cached. Two ids from two different
owners throw at index time, naming both owners. A blank Box has one action of its own,
`warehouse-backup`. **A feature contributes an action by listing it in `actions` on its core
manifest** (`defineCoreFeature`) - nothing outside the feature is edited.

**The funnel** is `ops/run.ts`. Every execution - a cron fire, a dashboard "Run now", an MCP call
from an agent, the CLI - goes through `executeRecorded()`, which wraps the generator in an
`automation_runs` row (`queued` → `running` → `success`/`error`) and buffers the progress stream as
the run's log, written once at finalization so a run costs one warehouse write rather than one per
line (capped at the last 2000 lines - backfills stream thousands). The queue is in-process FIFO with
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
| `opsRuns` (query) | the latest 100 runs, no logs |
| `opsRun` (mutation, MCP `run-get`) | one run including its full log |
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
`hello` carrying a per-process `BOOT_ID`: a client that sees a **second** hello (SSE reconnect, a
server restart) knows events may have been missed and reloads its stores instead of replaying. A
`ping` every 45s keeps idle SSE connections off the reaper. Events are invalidation hints only, so
fanning them out to any authenticated principal leaks nothing beyond "something in `<scope>`
changed".

**`packages/core/src/events.ts` is the persisted spine.** The server-relevant half: `recordEvent()`
is idempotent on `(kind, dedup_key)` and returns whether the event was **fresh**; `onEvent(listener)`
subscribes to fresh events only, after the row is committed, awaited before `recordEvent` resolves.
Best-effort, in-process, no outbox, no replay across restarts - a subscriber that needs
at-least-once semantics reads the `events` table instead. Features register their listeners from a
server module's `onModuleInit`. The spine itself, and the table, are the warehouse doc's:
[`WAREHOUSE.md`](./WAREHOUSE.md).

## 6. The agent host

`apps/server/src/agent/` is core. A blank Box has it. Only the agent's *seat in chat* belongs to the
`chat` reference app, whose `SPEC.md` arrives with it when you adopt it.

**workerdeck runs in this process.** `workerdeck.host.ts` boots `@workerdeck/server` in-process when
`box.json`'s `workerdeck` section declares at least one profile, API-only: `@workerdeck/web` is not installed, so there is no
second dashboard and no second cookie login. A boot failure is caught and logged - the agent surface
is optional, the rest of the Box is not. It boots **before** `app.listen()`, because a feature's
module init may sweep sessions against it immediately.

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
  belongs in one of those lists.
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

**Draining on shutdown.** `SIGTERM`/`SIGINT` call `shutdownWorkerdeck()` before exiting, once. The
sessions are in *this* process now, so a bare exit would cut live turns mid-flight, and a codex
session cannot be rebuilt from a park.

## 7. Running and serving

```bash
pnpm dev          # turbo run dev: Nest (:8190, started with --dev) + Vite (:5190) together
pnpm build        # core (tsdown → build/) + web (vite → dist/) + server (swc → dist/)
pnpm start        # no build: swc-node register runs apps/server/src/main.ts
pnpm start:prod   # from the compiled output: node apps/server/dist/main.js
pnpm verify       # the full check chain - see the root AGENTS.md
```

**No build step type-checks.** swc (server), tsdown (core) and vite (web) all strip types without
checking them. **tsgo** is the sole type-checker and runs in `pnpm typecheck`, inside `pnpm verify`.

**Ports are Nest `8190` and Vite `5190`**, from `box.json` (`server.port`, `server.vitePort`).
Set different values in the gitignored `box.local.json` when running another instance. The listener
and loopback probe use the same configured value.

**Nest is the single origin.**

- **dev:** `pnpm dev` starts the server with `--dev`, which builds the Vite URL from
  `server.vitePort` in `box.json`. `main.ts` registers an
  `http-proxy-middleware` handler **before** Nest's router that reverse-proxies every **non-reserved**
  route to Vite; `RESERVED = /^\/(api|trpc|mcp|agent)(\/|$)/` falls through to Nest and the agent
  mount. The query string is stripped before the test, so `/mcp?session=...` still matches.
  `changeOrigin: false` preserves the Host, which is what makes Vite's `allowedHosts` and its HMR
  client origin work. Vite's own reciprocal proxy in `apps/web/vite.config.ts` exists only so that
  hitting the bare Vite port directly still reaches the backend.
- **That dev proxy is built with `ws: false`, and must be.** In http-proxy-middleware v3, passing
  `ws: true` *and* driving `.upgrade()` manually are mutually exclusive: `ws: true` subscribes the
  library's own catch-all upgrade listener to the raw `http.Server` on the first request through the
  middleware and sets `wsInternalSubscribed`, which silently turns the explicit `devProxy.upgrade()`
  into a no-op - so every upgrade was handled twice. It only bites *after* the first REST call, so a
  WS test straight after a restart passes even when it is broken. Always send a REST request first
  when verifying this.
- **Upgrades** bypass the express pipeline, so `main.ts` dispatches them on the raw `http.Server` by
  path: `/agent/*` to the agent mount, everything else to the Vite HMR proxy. In production a
  non-agent upgrade is destroyed.
- **prod:** without `--dev` no dev proxy is registered and `ServeStaticModule` serves the
  built `apps/web/dist` from a path resolved off `repoRoot()`. `/api`, `/trpc`, `/mcp` and `/agent`
  are excluded from the static catch-all so they 404 as JSON rather than as `index.html`. That
  catch-all is the SPA fallback the browser-history router relies on (`docs/WEB.md`
  § Routing): every other path serves `index.html`, so `/crm/acme` survives a refresh - except
  `/assets/{*path}`, excluded so a stale hashed chunk 404s instead of arriving as HTML. In dev the
  same fallback is Vite's own (`appType: 'spa'`), behind the proxy above. Because the SPA and the
  server now share one URL namespace, a top-level client route may not reuse a reserved prefix or a
  file name under `apps/web/public`.
- **Tailscale:** Nest binds all interfaces, so a Box is reachable at
  `http://<host>.<tailnet>.ts.net:8190`. Vite's `allowedHosts` carries `.ts.net` for exactly this
  reason - Nest proxies with `changeOrigin: false`, so the tailnet Host reaches Vite, which would
  otherwise answer "Blocked request" with a blank page.

**Boot a throwaway Box** without touching your real data. The instance directory is always
`<checkout>/data` and no variable moves it, so a throwaway is a SECOND CHECKOUT of the repo. In it,
give `server.port` and `server.vitePort` in its own `box.json` unused numbers, leave every
`background` switch false, then:

```bash
pnpm install && pnpm -F @silkweave/box-web build
node --conditions=@silkweave/box-source --import @swc-node/register/esm-register \
  apps/server/src/main.ts
```

`pnpm install` writes that checkout's `box.json`; put local auth secrets in its gitignored
`box.local.json`. The first user on a fresh Box comes from
`pnpm auth:token <id> --name "Full Name"`, which mints an **admin** and only ever on a Box with no
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
(`AuthModule`, `UsersModule`, `ChangesModule`, `OpsModule`, `AgentModule`) and before
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
  the reverse. See [`core/SEAM.md`](./core/SEAM.md) § 4.3 and
  [`FEATURES.md`](FEATURES.md).
- **A feature may own a store outside the warehouse.** DuckDB is single-writer across processes and
  every query opens an ephemeral connection with lock-conflict backoff - right for "one UPSERT plus
  a re-derive", wrong for many tiny writes at interactive latency plus point reads, and a feature
  contending for that lock would degrade every read-only reader of the warehouse too. So a feature
  with that access pattern is allowed its own file, entirely inside its own directories; the `chat`
  reference app is the one that does it today.
- **Actions, tables and migrations** are declared on the *core* manifest (`defineCoreFeature`), not
  this one. A feature with no schema of its own ships `migrations: []` - the ledger is append-only
  and starts empty. See [`core/SEAM.md`](./core/SEAM.md) § 3 and [`WAREHOUSE.md`](./WAREHOUSE.md).

After adding or removing a feature, update the maintained registration imports, then run `pnpm verify`.

## 9. What `pnpm verify` does not cover

It has **no runtime step**. It cannot see a module-scope read of a generated registry, which throws
at load because the registry is on an import cycle with every view. Type-checking, linting and both
test suites pass; the SPA white-screens. Read a registry lazily, inside a function, and load the app
in a browser after touching the app's root files. The server half of that rule: a controller change
is covered by `pnpm typegen` inside `verify` and needs no boot, but anything that only runs at boot -
a module's `onModuleInit`, a registered port, the agent host - is proven by booting a throwaway Box
(§ 7) and nothing else.
