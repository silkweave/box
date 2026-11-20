# `mcp` - people connect their own MCP clients to the Box

A person adds the Box to their MCP client (Claude Code, Codex, Cursor, VS Code, Gemini CLI and
others) with one address, the MCP URL. The client discovers the Box's OAuth sign-in, the person
approves it in their signed-in Box browser session, and the client receives tokens bound to that
person. Role, areas, row security and the role-filtered tool list apply exactly as they do for a
Box access token; nothing is configured by an administrator and no token is copied by hand.

- **Feature id**: `mcp` (the recipe id). Warehouse keys `mcp:<name>`, tables `oauth_clients`,
  `oauth_grants`, `oauth_refresh_tokens` and `mcp_calls`. Distinct from core's `mcp` section
  (`mcp.url`, `mcp.token`: the `box` CLI's own connection).
- **Builds on**: core only. Core owns the `/mcp` transport, the access-token check, the consent and
  Connected apps routes and pages, and `box auth connections`; this recipe supplies the OAuth
  server and the grant store behind them.
- **Powerups**: `servers` (MCP Servers: outside MCP servers relayed through the Box, see
  [powerups/servers/POWERUP.md](powerups/servers/POWERUP.md)). Planned, not yet available:
  `desktop-extension` (Claude Desktop through a bridge) and `public-endpoint` (cloud clients such as
  claude.ai and ChatGPT).
- **Agent skill**: the feature's `mcp` skill belongs to the `servers` powerup. The base adds no
  agent-facing tools: sign-in is for people's clients, and Box agents, the CLI and scripts keep
  using access tokens.
- **Removal**: remove `features/mcp/` and its registration. `/mcp` then takes access tokens only and
  serves no OAuth routes; clients that were connected must use a token. Grants stay in the
  warehouse unused.

## Without the recipe

Core keeps `/mcp` bearer-only: a person's access token (admin-handed, rotatable) opens it, as
[docs/AUTH.md](../../docs/AUTH.md) describes. Core's Connect and Connected apps pages say MCP
sign-in is not set up. Everything below applies only once the recipe is adapted.

## The MCP URL

One canonical address: `server.dashboardUrl` + `/mcp`, no trailing slash. It is the OAuth issuer,
the protected resource and the token audience, built from configuration and never from a request's
Host header.

- **Offered only where tokens may travel**: `https://` addresses, or `http://localhost` and
  `http://127.0.0.1` when the client and the Box share a machine. On any other `http://` address the
  Box does not offer sign-in: the log says to set `server.dashboardUrl` to an https address, Connect
  an AI client does not appear, and `/mcp` keeps taking access tokens only.
- **Changing it is a reconnect.** Each grant records the URL it was issued for. When the Box starts
  with another URL, every grant for the old one is revoked with reason `url_changed`, and everyone
  connects again. Tokens are never valid for a second audience.

## Who may connect

Any signed-in person who is an active or invited human: not an agent, not the system principal. They
approve a client for themselves only, whatever their role's areas. Consent, Connected apps and
`box auth connections` are core routes, so a person on a custom role without the `mcp` area can
still connect and manage their own connections. The `mcp` area keeps meaning access to outside
servers (the `servers` powerup). Administrators see and revoke anyone's connections; nobody
consents on behalf of someone else, and the person a grant belongs to always comes from the
approving session, never from an id a client sends.

## Sign-in flow

1. The person runs the client's add command with the MCP URL (Connect an AI client shows it). The
   client fetches the discovery documents under `/mcp` and starts an authorization request.
2. The Box stores the request (10 minutes, in server memory, single use) and sends the browser to
   the dashboard's `/connect?request=<id>`.
3. Signed out, the login comes first and returns to the same request. An uninvited person cannot
   sign in. The consent page shows the signed-in person with Switch account, the client's name
   (shown escaped, and self-declared), who publishes it when it is identified by a metadata
   document ("published by claude.ai") or "Unverified app" when it registered itself, the host the
   browser returns to, and the plain statement that the app can use the person's current Box
   permissions, including changes they can make, and that this follows later role changes. With
   the `servers` powerup, and when the person has `mcp` read access, it also names the outside
   services the app could use as them.
4. Allow or Deny is a click, never automatic. It is a session-only request: a browser session
   credential (never an access token or an OAuth token), the CSRF header, and a same-origin check.
   The page is `no-store`, sends no referrer and refuses framing. An expired, already decided or
   unknown request says so and tells the person to start again in the client.
5. Allow returns the browser to the client's redirect with a one-use code; the client exchanges it
   for tokens. Deny returns `access_denied`.

Consent authorizes the client and redirect that the page displays. The Box does not bind a request
to the browser that started it: the controls are the fixed redirect list, explicit consent, the
session-only decision and single use. A loopback code reaches whichever local process owns the
port, so a client's own state and PKCE checks matter; hosted callbacks rely on the vendor's.

## Clients and redirects

The redirect list is fixed in the recipe (no setting):

- `http://localhost:*` and `http://127.0.0.1:*` (any port; the two hosts are not interchangeable):
  Claude Code, Codex, the ChatGPT desktop app, Cursor, VS Code, Gemini CLI and other local clients
- `https://claude.ai/api/mcp/auth_callback`
- `https://chatgpt.com/connector_platform_oauth_redirect`

Clients identify themselves either by a Client ID Metadata Document (their `client_id` is the https
URL of the document, which the Box fetches and caches for a day) or by Dynamic Client Registration
(unverified: no secret is issued). Registration is open to anyone who reaches `/mcp/register`, so
it is capped at 5 registrations per 10 minutes per caller address and 50 for the whole Box,
answering 429 beyond that. The address is the one the Box's rate limits use (a loopback proxy's
last forwarded hop, otherwise the peer).

Claude Code and Codex are tested end to end against this sign-in. Other local clients that speak
the MCP authorization standard work from the URL; Connect an AI client says so. Cloud clients (the
claude.ai and ChatGPT web apps, mobile, Claude Desktop Connectors) call from the vendor's servers,
so they need a Box reachable from the internet, which this recipe does not provide: the planned
`public-endpoint` powerup would.

## Tokens and lifetimes

- **Access token**: a signed JWT valid for one hour, accepted on `/mcp` only. It is refused on REST,
  tRPC, path mounts, `/mcp/servers/<id>` and the login box. It never outlives its grant.
- **Refresh token**: 30 days absolute from the first sign-in, rotated on every use. A token a client
  presents again after rotation (beyond a 30 second grace for concurrent refreshes) is a replay: the
  whole grant is revoked (reason `replay`). Connected apps shows the date the person must connect again.
- **Signing key**: derived from `auth.sessionSecret` (HKDF-SHA256, `silkweave-box/oauth/v1`).
  Rotating the secret ends access tokens; refresh tokens do not depend on it, so clients refresh and
  carry on. Rotating the session secret is not "disconnect all apps"; revoking is.
- **A person's access token**: rotating it changes nothing for their connections.

## Revocation

A grant is usable only while all of these hold, checked on every token use, code exchange and
refresh: it is not revoked and not expired; the subject and client match the grant; the MCP URL is
the one it was issued for; and the person is still an eligible human at the same `auth_epoch`. The
epoch (core, `users.auth_epoch`) is replaced by every revoke and by delete, so restoring access or
re-creating the same id never revives an old connection. Restoring a backup taken before a revoke
rolls the revoke back with it (the old epoch and the old grants return), so revoke again after such
a restore.

| Cause | Result |
|---|---|
| Revoke in Connected apps, by the person | that grant ends at once, reason `revoked` |
| Revoke by an administrator (one, or all of a person's) | the same, with the administrator recorded |
| `box auth connections revoke <grant-id>` or `revoke-all <user-id>` | the same, actor `cli` |
| The person's access is revoked, or the person is deleted | all their grants end (`user_revoked`; the epoch check ends them even if recording fails) |
| Replay of a rotated refresh token | that grant ends (`replay`) |
| The Box's MCP URL changed | every grant for the old URL ends (`url_changed`) |
| Rotating the person's access token | nothing |
| Rotating `auth.sessionSecret` | access tokens end; clients refresh |
| Removing the app inside the vendor's own settings | nothing in the Box: revoke it here too |

Revoking stops future access; it cannot recall data already returned.

## Data

Tables in the `mcp` schema, created on boot from the feature's ModelSpecs (there are no shipped migrations; the feature id and any `mcp:<name>` warehouse keys are unchanged):

- `oauth_clients`: client id, kind (`cimd` or `dcr`), declared name, redirect URIs, fetched and created times
- `oauth_grants`: grant id, person, the person's epoch at approval, client, MCP URL, consented,
  the approving browser ("Chrome on macOS", from its User-Agent: a hint for telling connections
  apart, not proof), connected, expires, last used, revoked at, reason and actor. The revoked mark outlives every
  token of the grant and later saves never clear it.
- `oauth_refresh_tokens`: SHA-256 of the token, grant, client, subject, scopes, resource, the
  consent context, created, expires, rotated and the sealed successor. Spent tokens stay until
  their expiry so a replay of any older one identifies the grant.
- `oauth_events`: the audit trail, kept 90 days. One row per client registration, consent,
  completed connection (code exchange), refresh and revoke (with actor and reason: `revoked`,
  `user_revoked`, `replay`, `url_changed`), with the person, client, grant and caller address where
  there is one. Never tokens, codes or cookies. `box auth connections log [<user-id>]` reads it.

Pending requests and one-use codes live in server memory: a restart drops them and the person
starts the sign-in again. The consent context (person, epoch, consent time, MCP URL) is captured at
approval and travels with the code to the grant's first token, so a revoke between approval and
exchange leaves the code unusable. `mcp_calls` belongs to the `servers` powerup.

## Surfaces

| Where | What |
|---|---|
| `/connect?request=<id>` | the consent page, outside the app shell, for any signed-in person |
| Settings > Profile | Connect an AI client (the MCP URL, `claude mcp add --transport http <box-name> <url>`, `codex mcp add <box-name> --url <url>`, and the URL to paste into other clients) and Connected apps (your own, with Revoke) |
| Users detail | the person's Connected apps and Revoke all, for administrators |
| `box auth connections [<user-id>]` | list; `revoke <grant-id>` and `revoke-all <user-id>` |
| tRPC `connectStatus`, `connectRequest`, `connectDecide`, `connectApps`, `connectAppRevoke`; admin: `connectAppsOf`, `connectAppAdminRevoke`, `connectAppsRevokeAll` | the page and panels (REST under `/api/connect/*`); never MCP tools |
| `/mcp/authorize`, `/mcp/token`, `/mcp/register`, the `.well-known` discovery documents under and beside `/mcp` | the OAuth server, called by clients |

The Profile panels appear only where sign-in is set up and offered at this address. `<box-name>` is
the Box's brand name as a lowercase slug.

## Security notes

- OAuth tokens are delegated credentials: minted only from a signed-in browser session with
  explicit consent, scoped to `/mcp`, revocable one by one, dead when the person's access is.
- The access token stays the anchor for the browser, the host, the CLI and admin-handed scripts.
- A connected client holds the person's permissions, including writes. The consent page says so.
  A client's name is whatever it declares; only the publishing host of a metadata document is
  shown as identified.
- Approvals, revokes and URL-change sweeps are written to the server log with the person, client
  and grant. Tokens, codes and cookies are never logged.
