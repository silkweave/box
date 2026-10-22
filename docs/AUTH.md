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
  gets `index.html`. `/login` is not a client route: the auth gate renders the login screen on any
  path, and the SPA moves the path grant into transient query state before normalizing to `/`
  (`apps/web/src/router.tsx`). `LoginView` immediately reads and scrubs that state, then shows
  "Continue as &lt;user&gt;" behind a button and
  never auto-submits: the click is what a scanner will not do.
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

`users.role` is `'admin' | 'member'`. The line between them is one sentence,
applied by every feature:

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

**In core's signals** (`apps/server/src/signals/`): `signal-upsert`, `signal-rename`,
`signal-delete`, `signal-owner-set`, `data-source-upsert` and `data-source-delete`. Signal
definitions and owners are configuration, and a data source is configuration wired to credentials;
manual point entry is a member's ([SIGNALS.md](SIGNALS.md#procedures-and-tools)).

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
stored on the row (`users.work`, migration `core:009-users-work`):

| Checkbox | Default | Effect |
|---|---|---|
| Work sessions allowed | on | off refuses a new session (`work_disabled`) and every tool call in a running one |
| Work with all data and modules | on | off refuses every MCP tool call in the session apart from WorkerDeck's own peer server. The Box's tools come from the person's profile config under whatever name they gave the server, so the Box cannot single its own out by name |
| Work in their sandbox folder | on | `data/work/<id>/` is a granted folder |
| Work in selected folders | off | the listed absolute host folders are granted; each must exist and lie outside the checkout and `data/`. The picker completes a typed path from the directories that pass the same check (`usersWorkFolders`) and can create one missing folder whose parent exists (`usersWorkFolderCreate`), both admin-only; Save re-checks every path |

The settings are read when the session starts and again on every guarded tool call, so a change
applies to a running session on its next call. Agents (`kind = 'agent'`) are not users here: their
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
`box auth replace <old> <new> [--name "Name"]`. The new agent takes over the old one's configuration:
the system principal in `box.json` and the identity lock (or its agent file), its instructions file,
and its `agentProfiles` and `browsers.users` entries. The old agent is retired like a removed file:
its token stops and its row stays as the author of its messages and runs. The command lists the
warehouse rows that still name the old id, so configuration kept in feature tables (an automation
trigger's `run_as`, for example) can be moved deliberately. Then mint the new agent's token and
update every client that used the old one.
Display name and role come from config; boot reconciles those fields in the directory without
replacing credentials or other profile fields. Role changes apply on the next authenticated
request, including an already-issued token. Set `agent.role` to `member` to restrict its admin tools.
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

`name` and `role` (`admin` or `member`) are required and are the only keys; any other key is refused
with its name. The system principal stays in `box.json`; a `data/config/agents/<system-id>.md` may
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

## First run and the commands that exist

A fresh Box has no users and every way to create one sits behind the login. The primary path is the
host-only guided setup:

```bash
bun setup
```

It confirms the configured machine principal, creates the first human as an administrator, stores
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
transcript. Mint with `box auth login <id>`, Settings -> Users -> Send sign-in link, or the
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
in gitignored `box.local.json`; the Box creates them when absent. No warehouse copy may ever include that file (`box db backup` and
`box db snapshot` copy `data.db` and nothing else): a backup carrying
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
