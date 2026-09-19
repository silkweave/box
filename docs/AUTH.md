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
| 1 | `Authorization: Bearer <access token>` | `bearer` | MCP clients, `pnpm cli`, scripts, the agent |
| 2 | the `box_session` cookie | `session` | the SPA |
| 3 | *(none)* | - | the five `@Public()` routes on `AuthController` only |

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

  The link itself points at the SPA (`<APP_URL>/login?link=<grant>`), so a bot that follows it just
  gets `index.html`. `/login` is not a client route - the auth gate renders the login screen on any
  path, and the SPA normalizes `/login` back to `/` on boot while KEEPING the query
  (`apps/web/src/router.tsx`). `LoginView` shows "Continue as &lt;user&gt;" behind a button and
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
not, so the old env-var default made a local Box unusable in Safari.
There is **no server-side expiry**. `Max-Age` is 400 days (Chrome's ceiling) purely
so the cookie survives a browser restart; it is a browser hint, not a server expiry. Revocation is
still exact: the guard re-reads the `users` row on every request, so a revoked user's live session
dies on its next call.

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
a second identity), and may not set `tailscale_login` on any row.

**In features**, by the same rule and listed in each feature's `SPEC.md`: data's signal definitions
and sources, automation's schedules and restart, content's channel profiles, planning's initiative
kinds, engagement's pod membership, and chat's `moderate` flag on `chat-message-delete` - the last
through `assertAdmin(req, ...)`, for a branch a decorator cannot express.

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
  Recovery for a Box that somehow has none is `pnpm auth:token <id> --admin` on the host.
- **Nobody changes their own role.** Demoting yourself is a lockout by accident; promoting yourself
  is the thing the tier exists to prevent.
- **Host config owns the system principal role.** User-management calls cannot override it.

### Agent identity and role

The system principal is the `agent` block of `box.json`, the one file a Box is configured in
([SETUP](SETUP.md#configuration)). `pnpm install` writes the file
on a fresh checkout; edit it before the first boot or auth command:

```json
{"agent":{"id":"nova","name":"Nova","role":"admin"}}
```

Without the file, a fresh Box persists these defaults before opening its warehouse. Choose a
lowercase slug ID and a display name. Core's lazy `systemUserId()` is shared by scheduling, chat,
notifications and auth; the browser receives the same identity through `/api/auth/me`.

The generated `data/config/agent-identity.lock.json` binds the ID. **Renaming an initialized agent is
unsupported**: restore the original config if the ID changes. Keep this lock with instance backups.
Display name and role come from config; boot reconciles those fields in the directory without
replacing credentials or other profile fields. Role changes apply on the next authenticated
request, including an already-issued token. Set `agent.role` to `member` to restrict its admin tools.
The last-admin guard counts humans, so the system account cannot be used to remove the last human
admin. The system account still has no sign-in links and cannot be disabled through user management.

A populated Box whose configured agent row does not exist refuses startup. Repair the choice; do not
delete the identity lock to rename users.

**Admin is the fresh-Box default, by decision.** It removes the previous member boundary against
credential changes, user administration, service restart and credential-wired configuration.
Untrusted chat and ingested content can prompt an admin-credentialed agent. The chat agent is off
by default; its configuration is in `box.json`, and no equivalent role boundary
replaces the one removed. `user-invite-reveal` remains off MCP; destructive chat operations retain
their human approval cards. These do not protect every admin action. Choose `member` when that
restriction is wanted. A teammate's sidebar session still uses that teammate's own token and role.

The system principal starts without a token. Mint deliberately with `pnpm auth:token nova --quiet`
(or your configured ID). It prints no permanent token and no browser link for the machine account;
reveal the credential privately with `pnpm auth:reveal nova` when wiring its profile.

## First run and the commands that exist

A fresh Box has no users and every way to create one sits behind the login, so the one path in is a
process on the host (`apps/server/scripts/auth-token.ts`):

```bash
pnpm auth:token <id> --name "Full Name"   # on a Box with NO human users: creates <id> as an ADMIN
pnpm auth:token <id> --quiet              # ...and does not print the token
pnpm auth:reveal <id>                     # re-print the CURRENT token, non-destructive
pnpm auth:token <id> --rotate             # replace a live token (a password reset)
pnpm auth:token <id> --admin              # promote an existing user - the break-glass
pnpm auth:token <id> --create --quiet     # add a MEMBER on a populated Box, without printing a token
pnpm auth:token <id> --create --admin --quiet # explicitly add an admin
```

"No human users" excludes the configured system principal from the users count, so a Box whose only row is the system
principal still counts as fresh. On a populated Box, a missing ID requires `--create` and defaults
to **member**; add `--admin` explicitly to create an admin. Without `--create`, the script still
refuses missing IDs and points at Settings -> Users or `user-upsert`. `--create` refuses an existing
ID, including a revoked user, without changing its profile, role or credential. On an empty Box,
`--create` keeps the first-human-as-admin rule. There is **no network-reachable bootstrap window** at
any point; the host was always the trust boundary, and nothing here changes that.

`--quiet` prevents a token from appearing in command output or agent transcripts.

**Access tokens, the contract:** one per user (`users.token_ciphertext` is a single column), no
expiry (nothing sets or checks one; a token dies only when rotated or revoked), AES-256-GCM
encrypted at rest **reversibly** precisely so a lost one can be re-read rather than reset. Two
equivalent non-destructive reveals: Settings -> Users -> View access token, and `pnpm auth:reveal`.
Minting is a password reset, so `pnpm auth:token` refuses to rotate a live token without `--rotate`.
Rotate only on a leak, and name what breaks first: every MCP config and script holding the old value.

A token is **never** put in a URL. It is the MCP/CLI bearer and what the dashboard login box
accepts, and nothing else. To get a person signed in, mint a sign-in link (§ 1.7).

`user-invite-reveal` is tRPC-only. It returns another person's permanent credential and remains
admin-only.

### 1.7 Sign-in links

A **grant** (`packages/core/src/auth/link.ts`) is a signed assertion that its bearer may become one
user, once, before an expiry. `bl1.<b64url{sub,iat,exp}>.<HMAC-SHA256>`, 15 minutes by default and
24 hours at most. It carries no secret of the user's and cannot be exchanged for an access token,
which is what makes it safe to send in a message or mint on someone's behalf inside an agent
transcript. Mint with `pnpm auth:link <id>`, Settings -> Users -> Send sign-in link, or the
admin-only `user-link` tool.

**Its key is derived, not separately configured:** HKDF-SHA256 from `AUTH_SESSION_SECRET` with the
`info` string `silkweave-box/signin-link/v1`. Rotating the session secret invalidates outstanding
links.

**A grant must never be confusable with a session cookie**, and the naive `{sub, exp}` HMAC signed
with the session secret *is* a valid one, because session payloads accept an `exp`. Four
locks, all tested in both directions: the derived key, the `bl1.` prefix inside the signed string, a
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

`apps/server/src/users/users.controller.ts` exposes each of these as **both** a tRPC procedure and
an MCP tool, so Settings -> Users, `pnpm cli` and an admin's own agent session are the same surface:

| MCP tool | tRPC | Tier |
|---|---|---|
| *(none)* | `usersList` | any principal (`has_token`, never a token) |
| `user-link` | `usersLink` | admin (short-lived sign-in link) |
| `user-upsert` | `usersUpsert` | self-or-admin |
| `user-invite` | `usersInvite` | admin |
| *(none)* | `usersInviteReveal` | admin |
| `user-access-revoke` | `usersAccessRevoke` | admin |
| `user-set-role` | `usersSetRole` | admin |
| `user-delete` | `usersDelete` | admin |

## Secrets

`AUTH_SESSION_SECRET` signs the cookie; `AUTH_TOKEN_SECRET` encrypts stored access tokens. Keep both
in the gitignored `box.local.json` under `auth`; the Box creates them when absent. No warehouse copy may ever include that file (`pnpm db:backup` and
`pnpm db:snapshot` copy `data.db` and nothing else): a backup carrying
the key that decrypts the tokens inside it is not a backup, it is a second copy of the credential.

Secrets must be at least 32 characters and must not use placeholder values. Invalid secrets are
refused before the Box signs a cookie or token.

Rotating `AUTH_SESSION_SECRET` signs everyone out. Rotating `AUTH_TOKEN_SECRET` makes every stored
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
