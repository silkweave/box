# `mcp` - outside MCP servers connected once, shared through the Box

An administrator connects an outside MCP server (Stripe first; Linear, Google and others later)
**once** on the Box. The Box holds the credential and relays every call. People reach the server's
tools through the Box's own `/mcp` endpoint, which their Claude and Codex clients already use;
server-owned agent sessions (chat, triggers) reach them through the toolsets they are granted. No
person and no session ever holds the upstream credential.

- **Feature id**: `mcp` (the recipe id). Settings `features.mcp`, secrets
  `credentials.mcp.<connection>` in `box.local.json`, one table `mcp_calls`, action ids `mcp-*`.
  Distinct from core's `mcp` section (`mcp.url`, `mcp.token`: the `box` CLI's own connection).
- **Builds on**: core only. Chat and automation use it through core's toolsets, not by import.
- **Agent skill**: `features/mcp/skills/mcp/SKILL.md` (finding a connection's tools, reading its
  failures, never asking anyone for an upstream credential).
- **Powerups**: none (see Owner question 11). **Scope**: MCP tools only; upstream prompts,
  resources, sampling and elicitation are not relayed.
- **Removal**: remove `features/mcp/` and its registration; toolsets that still name a connection
  then fail closed (see "Agent sessions"). Disconnect first, so upstream grants are revoked.

## Decision: a recipe that takes over `agentMcp.servers`

Today core's `agentMcp` holds both **servers** (url plus a static bearer token, hand-edited) and
**toolsets** (the grant). This recipe **replaces `agentMcp.servers`** and leaves toolsets in core.
There is one mechanism afterwards: a server is a connection of this recipe, granted by a toolset.

Why a recipe and not a core extension: the OAuth client, the relay, tool review, rate limiting and
the audit log are a sizeable optional capability that a Box with no outside servers should not
carry, and the seam pattern for it already exists (core ports such as the account directory, see
`docs/core/SEAM.md`). Why not keep `agentMcp.servers` beside it: two places to define a server, one
of which hands its static token to every session it is granted to (readable by the session's
shell), is exactly the parallel mechanism to avoid.

Core changes this requires (made in the same Stack change as the reference implementation):

1. **Connection directory port** (`packages/core/src/mcp-connections.ts`):
   `registerMcpConnections(owner, port)` with `list()` (id, label), `sessionProblem(id)` (why a
   session may not start with it, or null) and `serve(request)` (the session endpoint).
   `agent-tools.ts` drops `servers` parsing, `saveAgentMcpServer` and `deleteAgentMcpServer`, and
   validates a toolset's `servers` against the port. Without the recipe the port is empty: toolsets
   can still carry deny lists and built-ins, and Settings > Agent tools names the recipe where
   connections would be.
2. **Passthrough hook on `/mcp`** (`apps/server/src/agent/mcp-passthrough.ts`): core's `mcp()`
   adapter options in `app.module.ts` gain `filterActions` (the silkweave adapter recomputes the
   tool list per request and accepts added actions). Core calls a registered `McpActionSource` with
   the authenticated principal and the surface (`cli` when the request carries
   `x-box-surface: cli`, which the `box` CLI sends); without one, `/mcp` is unchanged. An added
   action never shadows a Box action.
3. **Connection endpoint**: `main.ts` dispatches `POST /mcp/connections/<id>` with a bearer token to
   the port's `serve`, and answers 404 without the recipe. It is not an adapter `transportPaths`
   entry, because the adapter publishes every action in PascalCase and sessions need the upstream
   tool names.
4. **Session wiring** (`apps/server/src/agent/box-mcp.ts`): a session's own `box` server URL
   carries `?passthrough=0`; each toolset connection becomes a loopback server at
   `/mcp/connections/<id>` with the session principal's token, after `sessionProblem` allows it.
   `docs/AGENT-TOOLS.md` and `docs/CONFIGURATION.md` then describe servers as connections of this
   recipe.

Existing Boxes move `agentMcp.servers` with a one-off, backed-up transition script (INSTALL.md);
no compatibility path in code (alpha).

## Settings (`features.mcp`)

Shared shape in `box.json`; edits made in Settings are written to `box.local.json`, as with
`agentMcp`. A `null` connection in `box.local.json` removes one from `box.json`.

```json
{
  "features": {
    "mcp": {
      "connections": {
        "stripe": {
          "label": "Stripe",
          "url": "https://mcp.stripe.com",
          "type": "http",
          "auth": "key",
          "audience": "everyone",
          "tools": { "stripe_api_read": "on", "stripe_api_search": "on", "stripe_api_write": "off" },
          "rateLimit": 60
        }
      },
      "auditDays": 90
    }
  }
}
```

- **Connection id**: lowercase letters, digits and `_`, 1 to 24 characters; `box` is reserved. It
  is the tool prefix on `/mcp`, the server name in sessions (`mcp__<id>__<tool>`) and the
  credentials account.
- `url` (https; `http` only for loopback), `type` (`http`, default, or `sse`), `label`.
- `auth`: `oauth`, `key` (a static bearer, such as a Stripe agent API key) or `none`. Optional
  `oauth: { clientId, scopes }` for a server that needs a pre-registered client.
- `audience`: who sees the connection's tools on `/mcp`: `admins` (default for a new connection),
  `everyone` (every human user) or a list of user ids.
- `tools`: upstream tool name to level: `on` (the audience), `admins` (administrators in the
  audience), `off`. **A tool not listed is held**: hidden until an administrator reviews it.
- `rateLimit`: calls per minute per principal on this connection (default 60).
- `auditDays`: how long `mcp_calls` rows are kept (default 90).

Secrets, `box.local.json` only, under `credentials.mcp.<connection>`: `key`, or the OAuth state
`accessToken`, `refreshToken`, `expiresAt`, `clientId`, `clientSecret`, `issuer`, `connectedBy`,
`connectedAt`. Core's `writeCredentials` (atomic, mode 0600) is the only writer.

## Connecting

Only an administrator connects, reconnects, sets a key or disconnects, in Settings > Connections
(tRPC, `@Admin()`, refused for agent principals, no MCP tool): the blast radius is configuration
wired to credentials (docs/AUTH.md).

**OAuth** follows the MCP authorization specification (2026-07-28), with the Box as the client.
The server side runs on `@modelcontextprotocol/sdk`'s client auth with a Box `OAuthClientProvider`.

1. **Discover** (`mcpOauthStart`): an unauthenticated request to `url` yields the 401
   `WWW-Authenticate` (`resource_metadata`, `scope`); then protected resource metadata (RFC 9728)
   and authorization server metadata (RFC 8414, path-inserted form
   `/.well-known/oauth-authorization-server/<path>`, then OpenID discovery). All https.
2. **Client**: a configured `oauth.clientId`, else Dynamic Client Registration (RFC 7591):
   `client_name` "Silkweave Box (<brand name>)", the redirect URI below, `authorization_code` and
   `refresh_token`, auth method `none`. Not Client ID Metadata Documents: they need a public,
   internet-reachable Box route.
3. **Redirect URI**: `<server.dashboardUrl>/api/mcp/oauth/callback`, one for all connections. The
   browser reaches it with the admin's session cookie (a top-level GET carries a `SameSite=Lax`
   cookie), so it is an ordinary admin route, not a new public one.
4. **Request**: PKCE S256, `state`, `resource` (the canonical `url`), the challenged scope or
   `scopes_supported` (plus `offline_access` when offered). The verifier, state, issuer, admin id
   and connection id are kept in server memory for 10 minutes, single use.
5. **Callback**: state matches the same admin; `iss` checked per RFC 9207; code exchanged with
   verifier and `resource`; tokens and `connectedBy` written; tools listed; back to Settings with
   the result and the tool review.
6. **Refresh**: on demand when the access token expires within 60 seconds or an upstream call
   answers 401; single flight per connection; a rotated refresh token is written atomically before
   use. `invalid_grant` marks the connection `reauth`.
7. **Disconnect**: revoke at the `revocation_endpoint` when one is advertised (RFC 7009), then
   delete `credentials.mcp.<id>`. Settings names where the upstream lists the grant (Stripe:
   Dashboard user settings, OAuth sessions).

**Key**: pasted by an administrator into a write-only field (`mcpConnectionKeySet`) or set by hand
in `credentials.mcp.<id>.key`; sent as `Authorization: Bearer`. Settings shows only whether it is set.

**Status** (Settings, `mcp-connections`): `connected`, `not_connected` (no credential), `reauth`
(refresh refused, or 401 after refresh), `unreachable` (last error, last success), and the tool
count. No timer: every upstream call and `mcp-connection-check` update it.

## The relay

All upstream traffic goes through one relay in the server process (`features/mcp/server/relay`).
It holds one MCP client per connection, adds the credential, refreshes it, enforces tool levels and
rate limits, writes the audit row and never forwards the caller's Box token upstream.

**Tool list**: fetched at connect, by `mcp-connection-check`, and lazily when older than 10
minutes; the last good list (names, descriptions, schemas, annotations, a digest per tool) is kept
in `data/mcp/tools/<id>.json`. A fetch that takes over 3 seconds or fails serves the last good list.
Tools that appear later are held (unlisted in `tools`) and Settings shows "N new tools to review";
a changed description is flagged with the old and new text and stays usable; an administrator
reviews the flag in Settings.

**Failures** are tool errors (`isError`) that say what to do, never an empty list: "Stripe is
unreachable (timeout); last worked 2026-10-17 09:12", "Stripe needs an administrator to reconnect
it (Settings > Connections)", "Rate limit: 60 calls per minute on stripe". An upstream 429 passes
through with its retry hint. Tools stay listed while the upstream is down.

## Tools for people (`/mcp`)

The Box's `McpActionSource` adds, per request, one action per visible upstream tool:

- **Who**: human principals (`kind = 'user'`) in the connection's audience, for tools at `on`, and
  also at `admins` for administrators. Agent principals never get passthrough tools on `/mcp`, and
  neither does any request carrying `?passthrough=0` (server-owned sessions): sessions get
  connections only through toolsets.
- **Naming**: action `<connection>-<tool in kebab case>`, so the MCP name follows the Box
  convention (`stripe_api_read` on `stripe` is `StripeStripeApiRead`, `mcp__<box>__StripeStripeApiRead`
  in Claude Code) and the CLI subcommand is `box stripe-stripe-api-read`. The description is the
  upstream one prefixed "[Stripe] ". A name that collides with a Box tool or another passthrough
  tool is skipped and listed in Settings.
- **Schemas**: the upstream JSON Schema is converted with zod 4 `fromJSONSchema`; the
  implementation tests that the schema `tools/list` publishes round-trips. Annotations
  (`readOnlyHint`, `destructiveHint`) pass through so clients ask before writes.
- **Freshness**: recomputed per request, but clients cache the list: a new tool appears after
  the client reconnects.
- **Approval**: the Box cannot show an approval card inside someone's Claude; writes are governed
  by the tool level and the client's own permission prompt.
- **Work sessions**: a member's Work session gets the Box's tools from their profile, so the
  "Work with all data and modules" switch covers passthrough tools too.

`/mcp/connections/<id>` serves one connection's visible tools under their upstream names, with the
same rules. Sessions use it (below); a person may add it as a separate client entry, but `/mcp` is
the documented path.

## Agent sessions

Toolsets stay core's grant layer, unchanged in shape: `servers` lists connection ids, `allow` and
`deny` use `mcp__<connection>` and `mcp__<connection>__<tool>` with upstream tool names.

- The session's server is `http://127.0.0.1:<port>/mcp/connections/<id>` with the **session
  principal's** Box token (the one its `box` server already carries, behind the same loopback
  check) and an `x-box-via` header naming the room or trigger run. The upstream credential never
  enters a session.
- The session sees tools by the same levels as its principal (the system agent is an
  administrator). A toolset's connections are granted whatever the audience: the session's server
  carries core's signed `x-box-grant` header, so a person calling the endpoint with their own
  token cannot claim it. Then the toolset's `deny` removes and `allow` auto-approves. A tool not in
  `allow` asks in chat and is refused in an unattended trigger, as today.
- A session acting as a person (a trigger that runs as a person) also gets that person's own
  connections, the ones whose audience includes them, auto-approved since the person could call
  those tools themselves; the toolset's `deny` still applies. One that cannot be used is left out
  rather than failing the session. An agent principal has no own connections, and neither does a
  session under a built-in toolset that keeps only some Box tools (outside content).
- A toolset naming a connection that does not exist, is `not_connected` or `reauth` refuses the
  session and says why (fail closed). `unreachable` starts the session; calls fail as above.

## Identity

Every call reaches the upstream with the Box's single credential. Consequences, stated in Settings:
upstream logs show the Box (the key, or the admin who signed in), never the person or agent, so
Stripe cannot tell Ana's refund from Ben's; an OAuth connection breaks when the admin who connected
leaves the upstream team, a service key does not; and everyone in the audience can read whatever
the credential can read.

Mitigations: the narrowest credential (a read-only restricted key; Stripe "agent API keys" carry
exactly the permissions chosen), write tools `off` or `admins`, tool review, and the Box audit log,
which is the only per-person record of who called what.

## Audit

`mcp_calls` (created from its ModelSpec on boot, no migration): `id`, `called_at`, `connection`, `tool`,
`principal`, `surface` (`mcp`, `cli`, `session`), `via` (room or trigger run, for sessions),
`outcome` (`ok`, `error`, `denied`, `rate_limited`, `unavailable`), `duration_ms`, `error`, `args`
(JSON, truncated to 4 KB, keys named like secrets removed). Results are not stored. Rows older than
`auditDays` are pruned on write. Settings > Connections > Activity lists them with filters;
`mcp-calls` returns them.

## Procedures and tools

| Action | Transports | Who | Does |
|---|---|---|---|
| `mcp-connections` | MCP, CLI, tRPC | member | connections visible to the caller: label, status, tools and levels; admins get all, with problems |
| `mcp-connection-check` | MCP, CLI, tRPC | admin | re-list tools, update status, report new or changed tools |
| `mcp-calls` | MCP, CLI, tRPC | admin | the audit log, filtered by connection, principal, tool, outcome, period |
| `mcpConnectionSave`, `mcpConnectionDelete` | tRPC | admin, human | define, edit, remove a connection (delete refuses while a toolset names it) |
| `mcpConnectionKeySet` | tRPC | admin, human | write the key (write only) |
| `mcpOauthStart`, `GET /api/mcp/oauth/callback`, `mcpDisconnect` | tRPC, REST | admin, human | OAuth connect, callback, revoke and delete |
| `mcpToolsReview` | tRPC | admin, human | set tool levels, accept new or changed tools |

"Human" means refused for agent principals, like toolset edits: a session cannot widen its own
reach through the Box. Event `mcp.connection.status` (dedup `<id>:<status>:<hour>`) lets
automation alert on a failing connection.

**Views**: Settings > Connections lists connections with status; a connection's page has Connect or
Key, audience, the tool review (held and changed tools first), the identity notice, Disconnect and
Activity. Members see their connections and tools, read only. Settings > Agent tools keeps toolsets.

## Security

- **At rest**: secrets only in `box.local.json` (owner-only, atomic writes), backed up with the
  instance, never published.
- **Never printed or forwarded**: no API returns a secret; logs and errors redact tokens, keys and
  codes. The caller's Box token and the upstream credential both stop at the relay.
- **Prompt injection**: upstream results are outside data (a Stripe customer can name themselves
  anything) and descriptions come from the upstream too. Hold new tools, flag changed descriptions,
  keep write tools off where read is enough, and never grant a connection with write tools to a
  toolset whose runs read outside content (Comms auto-drafts, for one).
- **SSRF**: only admins set URLs; OAuth endpoints must be https; redirects are not followed across
  hosts during discovery.

## Rollout on the Team Box with Stripe

1. Builder adapts this recipe, runs the transition script for the existing `agentMcp.servers`, and
   passes `box verify` (INSTALL.md).
2. **Owner**: in the Stripe Dashboard, create an agent API key (the "Agent" badge) on a sandbox
   with read permissions (customers, charges, invoices, subscriptions, products, prices, payment
   intents, balance). Non-agent restricted keys stop working on Stripe MCP after 2026-11-30.
3. **Owner**: Settings > Connections > Add: `stripe`, `https://mcp.stripe.com`, auth Key, paste
   the key. (OAuth instead: auth OAuth, Connect, sign in to Stripe, pick the account and
   environment.) Status turns `connected` with the tool list.
4. **Owner**: review tools: `stripe_api_search`, `stripe_api_details`, `stripe_api_read`,
   `get_stripe_account_info`, `search_stripe_documentation` on; `stripe_api_write`, Treasury
   (`send_money`, `transfer_money`, ...), `atlas_company_formation` and `send_stripe_feedback` off.
   Audience `everyone`.
5. Verify: `box stripe-get-stripe-account-info` answers; a member's Claude lists
   `StripeStripeApiRead` after reconnecting; `box mcp-calls` shows both calls with their principals.
6. Agents: add `stripe` to a toolset (allow `mcp__stripe__stripe_api_read`) and pick it in a room;
   ask the agent for last week's charges; the call shows in the audit log with the room.
7. Repeat steps 2 to 5 with a live-mode read key once the sandbox works.

## Owner questions

Each with the recommendation (2026-10-17, phase 1).

1. **Recipe or core?** A recipe `mcp` replacing `agentMcp.servers`; core keeps toolsets, gains a
   directory port and a passthrough hook.
2. **Tool names on `/mcp`.** `StripeStripeApiRead` (Box convention, `box stripe-stripe-api-read`)
   rather than `stripe__stripe_api_read`, which needs an adapter change and breaks CLI naming.
3. **Stripe credential.** A read-only agent API key, not OAuth: independent of any person, narrowest
   permissions, Stripe's own advice for persistent agent access. OAuth for servers with no keys.
4. **Sandbox first.** Yes: verify on a sandbox key, then a live read key.
5. **Who sees Stripe.** Audience `everyone` for read tools; `stripe_api_write` off (or `admins`
   later, with Stripe's own confirmation for refunds and payouts still in place).
6. **Pasting a key in Settings.** Allow a write-only field for admins (the OAuth flow writes
   credentials anyway); hand-editing stays possible.
7. **Arguments in the audit log.** Keep them, truncated to 4 KB, for 90 days; never results.
8. **Hold new upstream tools until reviewed.** Yes (Stripe adds tools such as `send_money`).
9. **Existing `agentMcp.servers` on the Team Box.** Move them with the transition script: auth
   `key` or `none`, audience `admins`, tools reviewed.
10. **Default rate limit.** 60 calls per minute per principal per connection.
11. **Per-person upstream accounts** (each person's own Google). Out of scope; a later `personal`
    powerup if a server should act as each person.
