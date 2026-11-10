# Auth

The operator and developer reference for authentication: what exists and how to use it.

Token or sign-in-link login, a signed session cookie, and two trust tiers, applied uniformly across
every surface the server exposes: REST, tRPC and `/mcp`.

## The model

**The Box's own access token is the trust anchor.** One token per user, and it is the credential
for the browser login *and* for every MCP connection that person configures, on every machine. Not
tailscale, not a network position: the code can verify a signature and a table row, and that is
what an anchor has to be when the repo is public and the Box may be run on a LAN, in Docker, behind
Caddy or behind `tailscale serve`.

A request is resolved to a principal by the first of these that yields one
(`apps/server/src/auth/auth.guard.ts`):

| # | Source | Credential kind | Who uses it |
|---|---|---|---|
| 1 | `Authorization: Bearer <access token>` | `bearer` | MCP clients, `bun run cli`, scripts, the agent |
| 2 | the `box_session` cookie | `session` | the SPA |
| 3 | *(none)* | - | the five `@Public()` routes on `AuthController` only |

Path mounts (`/artifacts/<slug>/`, a feature's sign-in mount, see SERVER.md) resolve the same two credentials in `main.ts`
before their handler runs; they are never public.

`Principal` is `{ id, display, role }` (`packages/core/src/auth/principal.ts`). The credential kind
is recorded alongside it, because one route family has to tell a person at a browser from an API
client: chat's destructive operations key their approval gate on it.

**The public surface is exactly six routes**, all on `apps/server/src/auth/auth.controller.ts`:

- `POST /api/auth/login {token}` - exchange an access token for a session cookie. Per-IP
  rate-limited, 10/min.
- `POST /api/auth/logout` - clear the cookie.
- `GET /api/auth/me`, also tRPC `authMe` - the current principal or null, so the SPA can probe
  login state without a 401.
- `POST /api/auth/link {grant}` - spend a **sign-in link** grant for a session cookie. Per-IP
  rate-limited, 20/min. The grant is short-lived (15 min default) and single-use; see § 1.7.

  A POST, not a GET, for two independent reasons. **Scanners:** link unfurlers (Lark, Slack) and URL
  detonators (SafeLinks, Defender) fetch a pasted URL immediately, and a GET that consumed the grant
  would burn the link before the human clicked, then tell them it was already used. **CSRF:** a GET
  could be triggered by any page that could make the browser navigate; a JSON body cannot be sent
  cross-origin without a preflight this Box refuses.

  The link itself points at the SPA (`<APP_URL>/login/<grant>`), so a bot that follows it just
  gets `index.html`. `/login` is not a client route: before the router reads the URL, the SPA takes
  the grant out of the address bar into memory and normalizes the path to `/`
  (`apps/web/src/lib/signinGrant.ts`), signed in or not, so a grant never stays in the URL or the
  history. Signed out, `LoginView` shows "Continue as &lt;user&gt;" behind a button and never
  auto-submits: the click is what a scanner will not do. Signed in, see § 1.7 "Opened while signed
  in".
- `GET /api/auth/instance` - this process's random per-boot id, and deliberately nothing else. Its
  only consumer is the loopback guard, which asks `127.0.0.1` "are you me?" before the chat agent
  runs a turn (see `apps/server/src/agent/loopback-guard.ts`).

**Sessions** (`packages/core/src/auth/session.ts`): `box_session` is a stateless HMAC-SHA256
signature over `{ sub }`, HttpOnly, `SameSite=Lax`, and `Secure` **derived from the request** -
set iff the login arrived over TLS, or from a loopback proxy sending `x-forwarded-proto: https`
(`requestIsSecure`). A cookie that can only ever be set over `http://` gains nothing
from `Secure` and loses everything: the browser drops it and the sign-in fails back to the login
screen with no error. Chromium hides that by treating `localhost` as a secure context; Safari does
not, so local HTTP must use a non-Secure cookie.
There is **no server-side expiry**. `Max-Age` is 400 days (Chrome's ceiling) purely
so the cookie survives a browser restart; it is a browser hint, not a server expiry. Revocation is
still exact: the guard re-reads the `users` row on every request, so a revoked user's live session
dies on its next call. Agent WebSockets (`/agent` attach and room reader relays) authenticate once,
so revoking, deleting or demoting a user also closes every socket they hold.

**CSRF:** a cookie-authed mutating request must carry `x-box-csrf`. Bearer callers carry no ambient
cookie and are CSRF-exempt by construction. The Box is single-origin by design, so there is no
CORS.

**`/mcp` is gated at the transport** (`app.module.ts`), not only per tool: the adapter accepts a
bearer only if it resolves to a principal. A per-tool guard cannot gate `tools/list`, so without
this an anonymous client could enumerate every tool.

## The two tiers

`users.role` names a role: the built-in `admin` or `member`, or a custom role ("Roles and areas"
below). Between the two built-ins the line is one sentence, applied by every feature:

> **An operation is admin-only when its blast radius is another person's identity or credential,
> the service itself, or configuration wired to credentials.**

Everything else is a member's, and that is the entire working surface: reading anything, running an
action, and every feature's own records. Admin-gating the primary interaction makes the tool
unusable, so when in doubt the answer is member.

**In core** (`apps/server/src/users/users.controller.ts`): `user-link`, `user-invite`,
`user-invite-reveal`, `user-access-revoke`, `user-set-role` and `user-delete` carry `@Admin()`. `user-upsert` is
self-or-admin, checked in the method rather than with the decorator because the answer depends on
the body: a member may edit their own profile fields, may not create a user (that would be minting
a second identity), and may not set `tailscale_login` on any row or change any `email` or `phone`.
Each decides who a person is somewhere else: a tailscale login, a single sign-on feature that
signs people in by their email, or a phone number (a messaging channel treats a sender whose number
is a user's phone as a team member). Emails are unique across users, case-insensitively, and phones are
unique in E.164 (`upsertUser`, which normalizes a typed number such as `0043 660 ...`).

**In core's signals** (`apps/server/src/signals/`): `signal-rename`, `signal-delete`,
`signal-archive`, `signal-unarchive`, `signal-owner-set`, `data-source-upsert` and
`data-source-delete`. Re-keying, removing and owning signals is configuration, and a data source is
configuration wired to credentials; creating or editing a definition (`signal-upsert`) and manual
point entry are a member's ([SIGNALS.md](SIGNALS.md#procedures-and-tools)).

**In features**, by the same rule and listed in each recipe's `recipes/<id>/SPEC.md`: automation's triggers and restart, planning's initiative
kinds and chat's `moderate` flag on `chat-message-delete` - the last
through `assertAdmin(req, ...)`, for a branch a decorator cannot express.

### Work sessions

The sidebar's **Work** is the person's own agent session. An admin's runs in the checkout, as
Builder's do. A member's is guarded, and the guard is a check, not a prompt:

- The working directory is the person's sandbox, `data/work/<id>/`, never the checkout.
- File tools (Read, Write, Edit, Glob, Grep and the rest) work only inside the granted folders:
  the sandbox and the admin-set folders. The checkout and `data/config/` are outside every grant.
- Shell commands that name the checkout, `data/config`, walk up with `..`, write git history
  (`commit`, `push`, `add`, `reset`, `checkout`, `stash`, `rebase`, `merge`, ...) or run the `box`
  CLI are refused.
- Builder is refused by the server for a member (`/builder` answers 403, and the worker refuses
  a `kind: builder` session to a non-admin), not only hidden in the UI.

The capabilities are per user, admin-set in Settings > Users (the edit dialog's Work section) and
stored on the row (`users.work`):

| Checkbox | Default | Effect |
|---|---|---|
| Work sessions allowed | on | off refuses a new session (`work_disabled`) and every tool call in a running one |
| Work with all data and modules | on | on gives the session the Box's own `box` MCP server (Box tools, no passthrough) acting as the person; off refuses every MCP tool call in the session apart from WorkerDeck's own peer server |
| Work in their sandbox folder | on | `data/work/<id>/` is a granted folder |
| Work in selected folders | off | the listed absolute host folders are granted; each must exist and lie outside the checkout and `data/`. The picker completes a typed path from the directories that pass the same check (`usersWorkFolders`) and can create one missing folder whose parent exists (`usersWorkFolderCreate`), both admin-only; Save re-checks every path |

The settings are read when the session starts and again on every guarded tool call, so a change
applies to a running session on its next call.

With data on, the server injects `box` (this Box's `/mcp?passthrough=0` on 127.0.0.1) each time
the session's runner is built, a woken session included, with a fresh session credential for the
person (see "Session credentials" below). The persisted session record holds only the header
`Bearer ${BOX_SESSION_CREDENTIAL}`; the credential itself is in the runner's environment, which
Claude Code expands into the header and WorkerDeck never writes to disk. A `box` entry in the
person's own profile config is replaced for the session; their other MCP servers stay. The
credential ends with the runner, on a restart, after 12 hours, and as soon as a policy revision or
any request with it finds the person revoked or their Work or data turned off (so a session woken
from its saved config after such a change holds a credential that admits nothing). A new session first checks that 127.0.0.1 is
this server (`work_box_unreachable` otherwise). Agents (`kind = 'agent'`) are not users here: their
sessions keep their own rules. The guard is a Claude Agent SDK hook, so a member's Work session
runs on a Claude profile only; a Codex profile is refused (`work_engine_unsupported`) rather than
run unguarded.

The guard runs in the server process as a PreToolUse hook of the engine
(`apps/server/src/agent/work-session.ts`; the classification is `packages/core/src/work-access.ts`).
It is strong but not absolute: the shell still runs as the server's OS user, and a command can be
written that the heuristics do not recognise. A hard guarantee needs a separate OS user or a
container per person.

### `@Admin()` is read inside `AuthGuard`

```ts
// apps/server/src/auth/auth.decorators.ts
export const Admin = (): MethodDecorator & ClassDecorator => SetMetadata(IS_ADMIN, true)
```

The check lives in `AuthGuard` and **not** in a second `AdminGuard`, because the silkweave adapters
run exactly the guards named in `@UseGuards` - so a separate guard would be a second decorator to
forget on a method, and forgetting it fails open and silently. Putting the tier where the principal
is resolved means a method cannot be authenticated without also being authorized, on every
transport, by construction. The adapters build an `ExecutionContext` whose `getHandler()` is the
real method, so `@Admin()` on an `@Mcp` tool or a `@Trpc` mutation is read exactly as on a REST
route.

**The role is never in the cookie.** It is re-read from the `users` row on every request, so a
demotion lands on the demoted user's next call rather than at their next sign-in. An unknown stored
value narrows to `member`, not to a throw: least privilege, not a broken Box.

Three refusals live in core (`packages/core/src/auth/principal.ts`), because they are about the
*shape* of the admin set rather than one call:

- **The last human admin cannot be demoted, revoked or deleted.** `activeAdminCount()` is checked first.
  Recovery for a Box that somehow has none is `box auth token <id> --admin` on the host.
- **Nobody changes their own role.** Demoting yourself is a lockout by accident; promoting yourself
  is the thing the tier exists to prevent.
- **Host config owns the system principal role.** User-management calls cannot override it.

**Policy changes are serialized and take effect at the next transaction.** Role rows, a user's
role, a user's activation, revocation and deletion, and an observed agent retirement each run as
one policy command (`policyCommand`, `packages/core/src/warehouse/pg/boot.ts`): the policy lock
first, so these changes and the last-admin rule never race, then the rows, the role logins, the
committed policy revision and its announcement, in one transaction. Within a process, policy
commands take turns before they connect (one policy session, a bounded queue; a command inside
another is refused), apart from the ordinary connection budget. Every process runs on one
published snapshot of that revision (routing and role definitions together); every database
transaction first compares the committed revision with the snapshot and with the revision the
request's access was resolved at, and a newer one re-resolves the request's identity and access
before any work (a principal that no longer resolves is refused). Changes that live in files
(toolsets, connection tool levels, agent reconciliation) commit a revision bump before they report.

**A new user is `pending` until it holds its role.** The row is created insert-only (an id taken
meanwhile refuses) and activated with its role in one policy command; a pending row cannot sign in
or be given a credential, and only an explicit role activates it. A role change never rides with
an identity change: a save that changes the role and names an email, phone or tailscale login is
refused, and a save writes only the fields it was given. Display fields saved with a role change
are not atomic with it.

### Agent identity and role

The system principal is the `agent` block of `box.json`, the one file a Box is configured in
([CONFIGURATION](CONFIGURATION.md)). `bun install` writes the file
on a fresh checkout; edit it before the first boot or auth command:

```json
{"agent":{"id":"nova","name":"Nova","role":"admin"}}
```

Without the file, a fresh Box persists these defaults before opening its warehouse. Choose a
lowercase slug ID and a display name. Core's lazy `systemUserId()` is shared by scheduling, chat,
notifications and auth; the browser receives the same identity through `/api/auth/me`.

The generated `data/config/agent-identity.lock.json` binds the ID. Editing `agent.id` on an
initialized Box is refused: restore the original config if the ID changed by accident. Keep this lock
with instance backups.

**Changing an agent's id is a replacement**, never an in-place rename, because every feature's history
points at the id. On a stopped Box, after `box db backup`, run
`box auth replace <old> <new> [--name "Name"]`. It records its progress in
`data/config/agent-replace.json`; if it is interrupted, boot, backups and restores refuse until the
same command is run again, which completes it. The new agent takes over the old one's configuration:
the system principal in `box.json` and the identity lock (or its agent file), its instructions file,
and its `agentProfiles` and `browsers.users` entries. The old agent is retired like a removed file:
its token stops and its row stays as the author of its messages and runs. The command lists the
warehouse rows that still name the old id, so configuration kept in feature tables (an automation
trigger's `run_as`, for example) can be moved deliberately. Then mint the new agent's token and
update every client that used the old one.
Display name and role come from config; boot reconciles those fields in the directory without
replacing credentials or other profile fields. Role changes apply on the next authenticated
request, including an already-issued token. Set `agent.role` to `member` or a custom role to restrict it.
The last-admin guard counts humans, so the system account cannot be used to remove the last human
admin. The system account still has no sign-in links and cannot be disabled through user management.

A populated Box whose configured agent row does not exist refuses startup. Repair the choice; do not
delete the identity lock to rename users.

**Admin is the fresh-Box default.** It permits credential changes, user administration,
service restart and credential-wired configuration.
Untrusted chat and ingested content can prompt an admin-credentialed agent. The chat agent is off
by default; its configuration is in `box.json`. `user-invite-reveal` is not exposed over MCP;
destructive chat operations retain
their human approval cards. These do not protect every admin action. Choose `member` when that
restriction is wanted. A teammate's sidebar session still uses that teammate's own token and role.

The system principal starts without a token. Mint deliberately with `box auth token nova --quiet`
(or your configured ID). It prints no permanent token and no browser link for the machine account;
reveal the credential privately with `box auth reveal nova` when wiring its profile.

### More agents: `data/config/agents/`

Each further agent is one file, `data/config/agents/<id>.md`. The file is the agent: the file name is
its id (the same slug rule as `agent.id`), the front matter its identity, the body its instructions
(`agentInstructions(id)` in core `agents.ts`).

```md
---
name: Stella
role: member
---
You are Stella, the team's research agent.
```

`name` and `role` (`admin`, `member` or a custom role id) are required and are the only keys; any other key is refused
with its name. An admin changes an agent's role in Settings -> Users (`agent-set-role`), which
previews coverage and rewrites the file through the policy journal ("Agents and coverage"). The
system principal stays in `box.json`; a `data/config/agents/<system-id>.md` may
exist for its instructions only, and setting `name` or `role` there is refused. Engine and model
come from the agent's default profile (`agentProfiles` in `box.json`), as for a person. An agent is
added by its file: on the host, or with Settings -> Users -> New agent, which writes the file and
reconciles at once (`usersAgentCreate`, core `createAgent`). That procedure is tRPC only and needs a
person who is an admin at a browser session: an agent (the admin system principal included) and a
bearer token are refused, so no agent can mint agents. It refuses a person's id and an active
agent's; a retired agent's id brings that agent back. Editing or retiring an agent stays a file
edit on the host, and its engine profile stays host configuration.

Every agent is a full principal: a `users` row with `kind = 'agent'` and its own token. The files
say which agents exist; the column is the durable record, so a deleted file never turns an agent
into a person with a working token. Boot (`ensureAgentPrincipals`) reconciles the rows:

- **Upsert** each configured agent: name and role from config, other profile fields and credentials
  kept. Boot refuses while an agent file does not parse, and refuses before any write when a file
  names the id of an existing person (an agent id must be new; converting an account is a
  deliberate transition script, never automatic).
- **Retire** an agent row whose file is gone: revoked (tokens stop, `run_as` refused), kept as the
  author of its messages and runs. Agent rows are never deleted.
- **Restore** a retired row whose file is back: active again, with its old token dropped, so its
  next session gets a fresh one. A maintenance boot skips retirement.

**Eligibility** is one predicate, read at call time: an agent may act only while its row is
`kind = 'agent'`, not revoked, and its file exists and parses (the system principal: `box.json`).
Bearer authentication, the session token a server-owned session carries, and automation `run_as`
all apply it, so deleting a file stops the agent at once; a missing or invalid file never falls
back to the stored role. The first check that finds an agent's file missing or invalid also retires
its row, so putting the file back takes effect at the next boot, with a fresh token, never by
reviving the old one. Only regular files count: a symlink is not an agent file. The host commands
(`box auth token`, `reveal`, `login`, `bun setup`) reconcile the agents like a boot.

The rules that held for the system principal hold for every agent: role from config (user
management cannot change it), no sign-in links and no session (`/api/auth/login` refuses an agent
token, a sign-in grant for an agent is refused, and every cookie transport resolves persons only),
`user-invite` and `user-access-revoke` refuse agent rows, `user-delete` refuses them
retired or not, and they are excluded from the human and last-admin counts. An agent's token is
rotated on the host (`box auth token <id> --rotate`), never reissued for a retired agent.
**Approval decisions are a person's:** an agent, the system principal included, never answers an
approval card. `/api/auth/me` lists the active agents as `agents: [{ id, name }]`, system principal
first.

Backups carry the files: every warehouse backup writes them beside the restore point and a restore
puts them back ([WAREHOUSE](WAREHOUSE.md#the-commands)).

## Roles and areas

An **area** is every installed feature id plus two core areas: `signals` (signals no feature owns,
data sources, providers) and `ops` (actions no feature owns). A role grants each area `none`,
`read` or `write`.

- `admin`: every area at write, plus admin authority (`@Admin()`). Built in, never stored.
- `member`: every area at write, no admin authority. Built in, never stored.
- A custom role (core table `roles`): `{ id, label, description, default, areas }`. `default`
  covers every area the role does not name, including areas installed later. Managed with
  `roles-list`, `role-upsert`, `role-delete` (admin) and explained with `access-explain` (yourself,
  or anyone for an admin).

A role id that names nothing (deleted, hand-edited) grants no area and no admin authority. A role
is assigned with `user-set-role` and only when it exists; it cannot be deleted while a person or an
agent config names it. Agent config (`box.json` `agent.role`, `data/config/agents/<id>.md`) may name
a custom role, and boot refuses one that does not exist. `/api/auth/me` returns the caller's
`access`: the level per area, admin authority and the policy revision, which moves on every role,
user-role or agent change. The web app keeps it in `apps/web/src/lib/access.ts` (`canAccessArea`,
`useAccess`): only features whose area the principal reads contribute navigation, settings
sections, top-bar controls, slots and `onSession` starters, and a starter that loads another
area's data checks that area first.

**Delivered copies.** What leaves a store for a person is checked against that person's access
when it is delivered, not against the job that produced it: chat push needs the recipient to read
`chat`; an alert carries its source event's areas and reaches a route only when every reader of
the target reads all of them, and the bell and Alerts history show it only to such readers
(recipes/automation/powerups/alerts/POWERUP.md).

**Handlers.** Every REST route, tRPC procedure and MCP tool is classified, and boot refuses one that
is not (`apps/server/src/auth/handler-map.ts`, built from the module that declares each controller
or provider):

| Category | Rule |
|---|---|
| Feature handler | its feature's area: `read` reaches it with `@Read()`, every other one needs `write` |
| `@Resource(kind)` (core) | passes the guard; the handler authorizes the actual resource |
| `@Authenticated()` (core) | any signed-in principal; the handler applies its own rule (`me`, own profile, directory, roles list) |
| `@Area('signals' \| 'ops')` (core) | decided like a feature handler |
| `@Admin()` / `@Public()` | as before |

`@Read()` marks a handler that changes nothing shared, judged by its code, never by its HTTP verb or
tRPC kind; a GET route and a tRPC query must carry it. Two narrow cases are reads with a written
reason: updating only the caller's own state (a read pointer, their push subscription), commented
above the decorator, and `@Read({ upkeep })`, housekeeping no caller input steers (expiring stale
approvals, refreshing a cached upstream list). A refusal, by the guard or by a core
accessor inside the handler, is 403 `{ error: 'area_access', area, needed }` on REST, `FORBIDDEN` on
tRPC, and an MCP tool error with `code: 'area_access'` (MCP tool errors carry no HTTP status), with
no record names. A handler's catch-all that turns domain failures into 400s throws
`inputError(e)` (`apps/server/src/auth/input-error.ts`) so a refusal passes through.

`AuthGuard` decides every transport from the same map, and `/mcp` lists only the tools the caller's
role reaches (`apps/server/src/agent/mcp-passthrough.ts`); a missing or invalid bearer lists
nothing, and outside connections' tools need `mcp` read for tools an administrator marked Reads
and `mcp` write for every other tool, on `/mcp`, `/mcp/connections/<id>` and in sessions alike
(recipes/mcp/SPEC.md).

**Request context.** Core carries who the current code runs for in one AsyncLocalStorage
(`packages/core/src/request-context.ts`). The transport opens an empty holder (the first Express
middleware per HTTP request, and one per tRPC or MCP action call, because a tRPC batch runs several
calls in one request and WebSocket messages arrive outside Express) and `AuthGuard` fills it. A
stream is rebound on every step. No frame, or an unfilled one, reaches no area. Boot, jobs and other
system work enter `asSystem(reason, fn)` explicitly; authentication runs in a narrow bootstrap
scope. A request that needs fixed system SQL after authorizing (a signal rename or delete
cascading into other areas) uses `coreCommand(reason, authorize, fn)`: the system transaction
carries the requester, and a policy change committed after `authorize` ran makes it authorize
again on re-resolved access (docs/WAREHOUSE.md "Owning areas and row security"). A read that must
see rows the caller's frame cannot and filter them by the caller's access (the bell's alerts) uses
`coreRead(reason, authorize, fn)` the same way. Every kind of entry is listed in
`system-entries.test.ts`.

**Recipients.** Delivery to someone other than the caller (an alert's room readers or DM peer, a
push) judges each recipient right before it dispatches, never from a cache: identities come with
the committed policy revision they were read at and roles are read at exactly that revision
(`auth/recipients.ts`: `recipientById`, `activeRecipients`), so nobody is judged as a new role with
that role's old grants. The check is the recipient read made just before the transport is
called; the transport's own preparation (resolving the sender, opening a DM) can still run between
that check and the post, the accepted point-in-time boundary. A message already sent is not
recalled. Each entry point that runs outside a request (boot step, CLI script, scheduler, relay,
maintenance pass, event or job listener, timer) names its own scope, `'<area>: <job>'`, and
nothing inherits a process-wide system scope, so a forgotten frame fails with `NO_CONTEXT` instead
of running with every area. The reason goes into each transaction as `box.principal`
(`system:<reason>`). In tests, code with no frame runs as system (`setFramelessScopeForTests`, test
setup only) so test bodies can seed and assert directly; tests of a runner start its lifecycle
hooks and deliver its job events inside `withoutContext`, so the runner must open its own scope.

**Session credentials.** Every server-owned agent session (chat room and DM agents, a
feature's own agent jobs, automation agent triggers) reaches the Box with `bx-session-<jws>`
(`packages/core/src/auth/session-credential.ts`), never a reusable token. It is signed with a key
made at boot (a restart ends every one), names what the session serves (`scope`: `room:<id>` or
`job:<app>:<id>`) and its toolset, and is valid only while its session is live in the server's
registry. It resolves to its principal's own access, re-read per request, and reaches only the Box
MCP tools of its toolset, on REST and tRPC too. `apps/server/src/agent/box-mcp.ts` opens it with
the session (a revoked principal is refused), and the caller closes it when the session ends: a
chat session when it is dropped, a job when it completes, fails, is cancelled or is lost. It
also ends at its lifetime bound (12 h for a chat session, which is retired between turns before
that; a job's stall limit plus a margin), and on any policy revision whose recheck refuses it: its
principal revoked or gone, or its toolset changed or removed since the session started.

The scope binds job and room controls: a session credential reports or files only for what it
serves (`sessionServes`). The tools through which a job reports its answer or files its work
(and only for the conversation or record its current run serves) are refused for any other job,
even one of the same agent.
A session never starts sessions, with one opening for chat. Handlers marked `@StartsJob()`
(automation's `TriggerRun` and the agent jobs a feature offers) are refused to session credentials
by `refusalFor`, on every transport, and left out of a session's MCP list.
`@StartsJob({ fromChat: true })` admits a chat serving session (`kind: 'serving'`,
`scope: room:<id>`): a room or DM agent may hand a question or material to the feature's own job.
The job runs as the feature's configured principal with its own `job:` credential, which starts
nothing, so delegation is one level deep. Work sessions and job sessions stay refused, and
`TriggerRun` is refused to every session credential. The chat agent still needs the handler's
area level and its toolset's list, and it is a relay (see "Agents and coverage"). Chat
posting is not bound to the session's room (an agent may be asked to post elsewhere); the
double-post guard counts only the room the session serves. A caller without a session credential
keeps the handler's own rules (the job's run-as principal, admin authority).

A session may also carry an admission check run on every request with its credential
(`admitSessionCredential`, called from `authenticatePrincipal`); a refusal ends the session. A
registry entry is dropped once its newest credential has expired, whether or not it was ever used.

A member's Work session gets one too (`kind: 'work'`, `scope: work:<user>`, no toolset: their
role's full Box surface, nothing more). See "Work sessions".

## Agents and coverage

An agent's output is shown only to readers who **cover** the agent (`packages/core/src/auth/covers.ts`):

- on every area, the reader's level is at least the agent's. Where the destination is read by an
  area's readers (artifacts, a feature's file tree), that area itself
  compares at read: everyone who reads the area covers an agent that writes there. Every other
  area the agent reaches compares exactly, so an agent that writes artifacts and also reads `crm`
  needs every artifacts reader to read `crm`;
- an agent with admin authority is read by admins only;
- for every outside MCP connection the agent can use there (its toolset's), the reader is in that
  connection's audience.

| Destination | Readers |
|---|---|
| A members room | its members with `chat` read |
| An open room | everyone with `chat` read; no coverage check (it trusts its seated agents, below) |
| A DM with an agent, or with an agent guest | the people in it |
| Artifacts, a feature's file tree | everyone with read on the area (area destinations, `registerAreaDestination`) |
| A tool's answer that returns to the caller alone (`answersCaller`) | the asker |

**Rooms.** A named room is `open` (every active person with `chat` read) or `members` (its member
list). An agent answers in a room only from a **seat** (`chat.chat_room_agents`). An open room
trusts the agents seated in it: it is no coverage destination, so everyone with `chat` read sees
what they write there, whatever they reach (an admin agent included). In exchange, only an admin
seats or enables an agent in an open room, or opens a room that has enabled seats. In a members
room, a seat a policy change or the boot check found uncovered is disabled with its reason until an
admin enables it.
Removing a seat never opens a room; opening a room drops its member rows. Admins and the room's
creator manage mode, members and seats in the room's settings (`chat-room-access`,
`chat-room-access-set`); the member picker greys out people who would not cover a seated agent,
with the reason. A member removed from a room gets `room.left` on their feed.

**The policy service** (`packages/core/src/auth/policy-service.ts`) applies every change that can
move coverage, serialized on the `box_policy` lane: roles, user roles, new and reactivated users (issuing a token to a revoked user; seats they do not cover are disabled and reported), agent roles,
toolsets and room access. It judges the destinations as they would be after the change, and reports
only the violations the change adds ("Dita (viewer) lacks crm write held by Scout in #pipeline").
With none the change applies. A violation at a members room can be confirmed: the second call
repeats the preview's `revision` with `confirm: 'remove-members'` and also removes those members,
and is refused when the policy moved since the preview. A violation at an area destination, or by a
person being added, cannot be removed that way: the change is refused (409 `coverage`) with the
options to cancel or change the grants. `policy-preview` (admin) previews a role edit, a user's role or an agent's
role; Settings > Roles and the role picker in Settings > Users show it before saving. Agent role and
toolset changes rewrite files through the policy journal (docs/WAREHOUSE.md "The policy journal")
and end the live sessions of the changed agents and toolsets; new session requests wait at the
policy gate meanwhile. At boot, `checkCoverageAtBoot` disables seats whose readers no longer cover
their agent (a hand-edited agent file) and logs the rest.

**Write-time checks.** A serving session's output is checked where it lands, whatever its scope:
`AuthGuard` checks an agent principal's write handler in an area destination against every reader of
the area (403 `{ error: 'coverage', area, message }`), except a job whose output returns to the
caller only (`@StartsJob({ answersCaller: true })`, `WikiAsk`: its answer is judged where it is
read); a room post or agent turn checks the room's
seat and readers (`roomWriteProblem`), and a live `room:` session ends on the policy revision that
breaks it; an answer that returns to the caller alone is refused when the asker no longer covers the job's agent, and
withheld when they fetch it.

**Relays.** An agent that reads another agent's output passes it on to its own readers, so it must
cover that agent itself (`relayCoverageProblem`): a room agent calling `WikiAsk` must cover the ask
job's agent (checked before the job starts, on the answer and on each fetch, the waiting `WikiAsk`
response included), and one calling `WikiUpdate` must cover the upkeep agent (checked on submit and
again for whoever reads the record with `WikiUpdateGet` or `WikiUpdates`). Everyone who covers the
room agent then covers the source on areas. A delegated job adds no connection reach: its toolset's
connections must all be in the relaying session's toolset, which is the room's and is judged
against every reader of the room (`delegatedOutputProblem`); a person reading an answer directly
must be in each connection's audience. A withheld record keeps only status metadata: the answer,
summary, pages, questions, progress, failure text, warnings and log are all removed.

## First run and the commands that exist

A fresh Box has no users and every way to create one sits behind the login. The primary path is the
host-only guided setup:

```bash
bun setup
```

It names the configured machine principal (`--review` asks to confirm it), creates the first human as an administrator, stores
their permanent token in mode-0600 `box.local.json` for the local CLI without printing it, and
issues a short-lived single-use sign-in link. It refuses a populated Box rather than changing an
existing profile or rotating a credential. The lower-level host commands remain available:

```bash
box auth token <id> --name "Full Name"   # on a Box with NO human users: creates <id> as an ADMIN
box auth token <id> --quiet              # ...and does not print the token
box auth reveal <id>                     # re-print the CURRENT token, non-destructive
box auth token <id> --rotate             # replace a live token (a password reset)
box auth token <id> --admin              # promote an existing user - the break-glass
box auth token <id> --create --quiet     # add a MEMBER on a populated Box, without printing a token
box auth token <id> --create --admin --quiet # explicitly add an admin
```

"No human users" excludes the configured system principal from the users count, so a Box whose only row is the system
principal still counts as fresh. On a populated Box, a missing ID requires `--create` and defaults
to **member**; add `--admin` explicitly to create an admin. Without `--create`, the script still
refuses missing IDs and points at Settings -> Users or `user-upsert`. `--create` refuses an existing
ID, including a revoked user, without changing its profile, role or credential. On an empty Box,
`--create` keeps the first-human-as-admin rule. There is **no network-reachable bootstrap window** at
any point; the host was always the trust boundary, and nothing here changes that.

The signed-out dashboard makes the fallback host step visible when it detects a fresh Box. Its public
`GET /api/auth/me` probe returns only `needsOwner: true`; it exposes no user count or identity and
does not create an account. Guided setup instead lands the owner through its short-lived link, so
the signed-in onboarding dashboard begins with the owner quest already complete.

`--quiet` prevents a token from appearing in command output or agent transcripts.

**Access tokens, the contract:** one per user (`users.token_ciphertext` is a single column), no
expiry (nothing sets or checks one; a token dies only when rotated or revoked), AES-256-GCM
encrypted at rest **reversibly** precisely so a lost one can be re-read rather than reset. Two
equivalent non-destructive reveals: Settings -> Users -> View access token, and `box auth reveal`.
Minting is a password reset, so `box auth token` refuses to rotate a live token without `--rotate`.
Rotate only on a leak, and name what breaks first: every MCP config and script holding the old value.

A token is **never** put in a URL. It is the MCP/CLI bearer and what the dashboard login box
accepts, and nothing else. To get a person signed in, mint a sign-in link (§ 1.7).

`user-invite-reveal` is tRPC-only. It returns another person's permanent credential and remains
admin-only.

### 1.7 Sign-in links

A **grant** (`packages/core/src/auth/link.ts`) is a signed assertion that its bearer may become one
user, once, before an expiry. The compact `bl2` format packs the millisecond issue time, lifetime and
UTF-8 user ID into a binary payload and authenticates it with a 160-bit truncated HMAC-SHA256. It is
typically about 50 characters, lasts 15 minutes by default and 24 hours at most. It carries no
secret of the user's and cannot be exchanged for an access token,
which is what makes it safe to send in a message or mint on someone's behalf inside an agent
transcript. Mint with `box auth login <id>` (the id may be left out on a Box with one person), Settings -> Users -> Send sign-in link, or the
admin-only `user-link` tool.

The verifier continues to accept the earlier `bl1.<JSON>.<HMAC-SHA256>` format so an already-issued
link remains usable for its short lifetime. New links are always `bl2`.

**Its key is derived, not separately configured:** HKDF-SHA256 from `auth.sessionSecret` with the
`info` string `silkweave-box/signin-link/v1`. Rotating the session secret invalidates outstanding
links.

**A grant must never be confusable with a session cookie**, and the naive `{sub, exp}` HMAC signed
with the session secret *is* a valid one, because session payloads accept an `exp`. Four
locks, all tested in both directions: the derived key, the format prefix inside the signed string, a
strict three-part parse, and `verifySession` rejecting any payload carrying `iat`.

**Single use** is one `users.link_watermark` column holding the `iat` of the last consumed grant; a
grant is spendable only if its own `iat` is newer, and spending it moves the watermark in the same
conditional UPDATE, so two clicks cannot both win. Two consequences worth knowing: signing in kills
every OLDER outstanding link for that person (stale links in old messages go dead), and revoking a
user bumps the watermark so a pre-revoke link cannot outlive the revocation. The column is a BIGINT
of epoch milliseconds rather than a TIMESTAMP because the record layer truncates timestamps to whole
seconds, which would move a watermark backwards on an ordinary profile edit and re-arm a spent
link.

**Opened while signed in.** The auth gate (`apps/web/src/App.tsx`) compares the grant's subject with
the signed-in person. A link for the same person is dropped unspent. A link for someone else shows
"Switch account?" with both names: **Switch** spends the grant, whose session cookie replaces the
current one, and reloads the app so nothing loaded for the previous person stays on screen; **Stay**
drops the grant unspent. It never switches silently, because a forwarded or planted link would
otherwise move a person into another account without their noticing, and what they typed next would
land there. Legitimate switches: an admin checking a member's view, a test account, a shared machine.
The subject is read from the grant without verifying it, for display and this choice only; the
server alone decides who the bearer becomes.

### User management, from the app or an agent

`apps/server/src/users/users.controller.ts` exposes user management through tRPC and selected
MCP tools. Settings -> Users, `box <tool-name>` and an admin's agent session share the same handlers;
the table identifies operations available only through tRPC:

| MCP tool | tRPC | Tier |
|---|---|---|
| `users-list` | `usersList` | any principal (`has_token`, never a token) |
| `user-get` | `usersGet` | any principal (one profile by id) |
| `user-link` | `usersLink` | admin (short-lived sign-in link) |
| `user-upsert` | `usersUpsert` | self-or-admin (`work` is admin-only) |
| `user-invite` | `usersInvite` | admin |
| *(none)* | `usersInviteReveal` | admin |
| `user-access-revoke` | `usersAccessRevoke` | admin |
| `user-set-role` | `usersSetRole` | admin |
| *(none)* | `usersWorkFolders` | admin |
| *(none)* | `usersWorkFolderCreate` | admin |
| *(none)* | `usersAgentCreate` | admin person at a browser session |
| `user-delete` | `usersDelete` | admin |

## Secrets

`auth.sessionSecret` signs the cookie; `auth.tokenSecret` encrypts stored access tokens. Keep both
in gitignored `box.local.json`; the Box creates them when absent. No database restore point may ever include that file (`box db backup` and
`box db snapshot` hold the database dump and the agent files, nothing else): a backup carrying
the key that decrypts the tokens inside it is not a backup, it is a second copy of the credential.

Secrets must be at least 32 characters and must not use placeholder values. Invalid secrets are
refused before the Box signs a cookie or token.

Rotating `auth.sessionSecret` signs everyone out. Rotating `auth.tokenSecret` makes every stored
access token unreadable - it is the key they are encrypted with - so keep it stable.

## Identity guards that are not authorization

Two checks are regularly mistaken for access control and must not be removed as such. Both answer
"does this person exist", never "may they":

- `assertKnownActor` (`packages/core/src/users/state.ts`) runs in the **record layer**, so every
  path - REST, tRPC, MCP, a script calling core directly - is covered at once. An unvalidated
  `actor` leaves `created_by` naming a person who does not exist, and nothing in the tool surface
  can rewrite that afterwards. No actor at all is still legal: an unattributed write is a real
  thing.
- `assertKnownUser` (`packages/core/src/users/state.ts`) validates an **ownership** assignment.
