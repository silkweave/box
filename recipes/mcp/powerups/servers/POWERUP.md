# MCP Servers

Connect an outside MCP server such as Stripe to the Box once, signed in by an administrator, and every person and agent the team allows can use its tools through the Box, without anyone holding the credential themselves.

## Highlights

- One administrator connects a server once: OAuth sign-in in Settings, or a restricted key where the server offers one
- The server's tools appear on the Box's own MCP endpoint, so people's Claude and Codex clients and the box CLI get them with no new setup (people connect those clients with MCP sign-in, the base recipe)
- Chat rooms and agent triggers grant a server through the existing toolsets, with their allow and deny lists and approvals
- Per-tool levels (on, admins only, off), new upstream tools held until an administrator reviews them, and a per-person rate limit
- Every call recorded in an audit log with who made it, through which surface, and how it ended

## Needs

- Core's server directory port and the `/mcp` passthrough hook, and a revision that no longer
  reads `agentMcp.servers`
- `@modelcontextprotocol/client`, `@modelcontextprotocol/server` and `@modelcontextprotocol/node` in the root package
- For an OAuth server, `server.dashboardUrl` over https (GOTCHAS below)

## How it works

Feature id `mcp` (the recipe's), settings `features.mcp`, secrets `credentials.mcp.<server>` in
`box.local.json`, table `mcp_calls`, action ids `mcp-*`. Agent skill:
`features/mcp/skills/mcp/SKILL.md` (finding a server's tools, reading its failures, never
asking anyone for an upstream credential). Scope: MCP tools only; upstream prompts, resources,
sampling and elicitation are not relayed. Removal: see Remove in [INSTALL.md](INSTALL.md).

### Decision: a powerup that takes over `agentMcp.servers`

Today core's `agentMcp` holds both **servers** (url plus a static bearer token, hand-edited) and
**toolsets** (the grant). This powerup **replaces `agentMcp.servers`** and leaves toolsets in core.
There is one mechanism afterwards: a server is an MCP server of this powerup, granted by a toolset.

Why a powerup and not a core extension: the OAuth client, the relay, tool review, rate limiting and
the audit log are a sizeable optional capability that a Box with no outside servers should not
carry, and the seam pattern for it already exists (core ports such as the account directory, see
`docs/core/SEAM.md`). Why not keep `agentMcp.servers` beside it: two places to define a server, one
of which hands its static token to every session it is granted to (readable by the session's
shell), is exactly the parallel mechanism to avoid.

Core ports this relies on (in core, present with or without the powerup):

1. **Server directory port** (`packages/core/src/mcp-servers.ts`):
   `registerMcpServers(owner, port)` with `list()` (id, label), `sessionProblem(id)` (why a
   session may not start with it, or null) and `serve(request)` (the session endpoint).
   `agent-tools.ts` drops `servers` parsing, `saveAgentMcpServer` and `deleteAgentMcpServer`, and
   validates a toolset's `servers` against the port. Without the powerup the port is empty: toolsets
   can still carry deny lists and built-ins, and Settings > Agent tools names the powerup where
   servers would be.
2. **Passthrough hook on `/mcp`** (`apps/server/src/agent/mcp-passthrough.ts`): core's `mcp()`
   adapter options in `app.module.ts` gain `filterActions` (the silkweave adapter recomputes the
   tool list per request and accepts added actions). Core calls a registered `McpActionSource` with
   the authenticated principal and the surface (`cli` when the request carries
   `x-box-surface: cli`, which the `box` CLI sends); without one, `/mcp` is unchanged. An added
   action never shadows a Box action.
3. **Server endpoint**: `main.ts` dispatches `POST /mcp/servers/<id>` with a bearer token to
   the port's `serve`, and answers 404 without the recipe. It is not an adapter `transportPaths`
   entry, because the adapter publishes every action in PascalCase and sessions need the upstream
   tool names.
4. **Session wiring** (`apps/server/src/agent/box-mcp.ts`): a session's own `box` server URL
   carries `?passthrough=0`; each toolset server becomes a loopback server at
   `/mcp/servers/<id>` with the session's own credential (docs/AUTH.md "Session credentials"),
   after `sessionProblem` allows it.
   `docs/AGENT-TOOLS.md` and `docs/CONFIGURATION.md` then describe servers as the MCP servers of this
   recipe.

A Box that defines `agentMcp.servers` moves them with a one-off, backed-up transition script
(INSTALL.md); there is no compatibility path in code.

### Settings (`features.mcp`)

Shared shape in `box.json`; edits made in Settings are written to `box.local.json`, as with
`agentMcp`. A `null` server in `box.local.json` removes one from `box.json`.

```json
{
  "features": {
    "mcp": {
      "servers": {
        "stripe": {
          "label": "Stripe",
          "url": "https://mcp.stripe.com",
          "type": "http",
          "auth": "key",
          "audience": "everyone",
          "tools": { "stripe_api_read": "on", "stripe_api_search": "on", "stripe_api_write": "off" },
          "marks": { "stripe_api_read": "read", "stripe_api_search": "read" },
          "rateLimit": 60
        }
      },
      "auditDays": 90
    }
  }
}
```

- **Server id**: lowercase letters, digits and `_`, 1 to 24 characters; `box` is reserved. It
  is the tool prefix on `/mcp`, the server name in sessions (`mcp__<id>__<tool>`) and the
  credentials account.
- `url` (https; `http` only for loopback), `type` (`http`, default, or `sse`), `label`. The relay
  negotiates the protocol per server: MCP 2026-07-28 when the server offers it, else the 2025
  handshake, so older servers keep working.
- `auth`: `oauth`, `key` (a static bearer, such as a Stripe agent API key) or `none`. Optional
  `oauth: { clientId, scopes }` for a server that needs a pre-registered client.
- `audience`: who sees the server's tools on `/mcp`: `admins` (default for a new server),
  `everyone` (every human user) or a list of user ids.
- `tools`: upstream tool name to level: `on` (the audience), `admins` (administrators in the
  audience), `off`. **A tool not listed is held**: hidden until an administrator reviews it.
- `marks`: upstream tool name to `read` or `write`, an administrator's call (the upstream's
  `readOnlyHint` is shown as a hint, never trusted). **A tool not marked `read` is a write.** A
  `read` tool needs `read` on the caller's `mcp` area, every other tool `write` (docs/AUTH.md
  "Roles and areas"). This applies on `/mcp`, the CLI and sessions alike, and a toolset grant
  never lifts it: a session acting for a role that reads servers reaches read tools only.
- `rateLimit`: calls per minute per principal on this server (default 60).
- `auditDays`: how long `mcp_calls` rows are kept (default 90).

Secrets, `box.local.json` only, under `credentials.mcp.<server>`: `key`, or the OAuth state
`accessToken`, `refreshToken`, `expiresAt`, `clientId`, `clientSecret`, `issuer`, `connectedBy`,
`connectedAt`. Core's `writeCredentials` (atomic, mode 0600) is the only writer.

### Connecting

Only an administrator connects, reconnects, sets a key or disconnects, in Settings > MCP Servers
(tRPC, `@Admin()`, refused for agent principals, no MCP tool): the blast radius is configuration
wired to credentials (docs/AUTH.md).

**OAuth** follows the MCP authorization specification (2026-07-28), with the Box as the client.
The server side runs on `@modelcontextprotocol/client`'s auth helpers with a Box `OAuthClientProvider`.

1. **Discover** (`mcpOauthStart`): an unauthenticated request to `url` yields the 401
   `WWW-Authenticate` (`resource_metadata`, `scope`); then protected resource metadata (RFC 9728)
   and authorization server metadata (RFC 8414, path-inserted form
   `/.well-known/oauth-authorization-server/<path>`, then OpenID discovery). All https.
2. **Client**: a configured `oauth.clientId`, else Dynamic Client Registration (RFC 7591):
   `client_name` "Silkweave Box (<brand name>)", the redirect URI below, `authorization_code` and
   `refresh_token`, auth method `none`. Not Client ID Metadata Documents: they need a public,
   internet-reachable Box route.
3. **Redirect URI**: `<server.dashboardUrl>/api/mcp/oauth/callback`, one for all servers. The
   browser reaches it with the admin's session cookie (a top-level GET carries a `SameSite=Lax`
   cookie), so it is an ordinary admin route, not a new public one.
4. **Request**: PKCE S256, `state`, `resource` (the canonical `url`), the challenged scope or
   `scopes_supported` (plus `offline_access` when offered). The verifier, state, issuer, admin id
   and server id are kept in server memory for 10 minutes, single use.
5. **Callback**: state matches the same admin; `iss` checked per RFC 9207; code exchanged with
   verifier and `resource`; tokens and `connectedBy` written; tools listed; back to Settings with
   the result and the tool review.
6. **Refresh**: on demand when the access token expires within 60 seconds or an upstream call
   answers 401; single flight per server; a rotated refresh token is written atomically before
   use. `invalid_grant` marks the server `reauth`.
7. **Disconnect**: revoke at the `revocation_endpoint` when one is advertised (RFC 7009), then
   delete `credentials.mcp.<id>`. Settings names where the upstream lists the grant (Stripe:
   Dashboard user settings, OAuth sessions).

**Key**: pasted by an administrator into a write-only field (`mcpServerKeySet`) or set by hand
in `credentials.mcp.<id>.key`; sent as `Authorization: Bearer`. Settings shows only whether it is set.

**Status** (Settings, `mcp-servers`): `connected`, `not_connected` (no credential), `reauth`
(refresh refused, or 401 after refresh), `unreachable` (last error, last success), and the tool
count. No timer: every upstream call and `mcp-server-check` update it.

### The relay

All upstream traffic goes through one relay in the server process (`features/mcp/server/servers/relay`).
It holds one MCP client per server, adds the credential, refreshes it, enforces tool levels and
rate limits, writes the audit row and never forwards the caller's Box token upstream.

**Tool list**: fetched at connect, by `mcp-server-check`, and lazily when older than 10
minutes; the last good list (names, descriptions, schemas, annotations, a digest per tool) is kept
in `data/mcp/tools/<id>.json`. A fetch that takes over 3 seconds or fails serves the last good list.
Tools that appear later are held (unlisted in `tools`) and Settings shows "N new tools to review";
a changed description is flagged with the old and new text and stays usable; an administrator
reviews the flag in Settings.

**Failures** are tool errors (`isError`) that say what to do, never an empty list: "Stripe is
unreachable (timeout); last worked 2026-10-17 09:12", "Stripe needs an administrator to reconnect
it (Settings > MCP Servers)", "Rate limit: 60 calls per minute on stripe". An upstream 429 passes
through with its retry hint. Tools stay listed while the upstream is down.

### Tools for people (`/mcp`)

The Box's `McpActionSource` adds, per request, one action per visible upstream tool:

- **Who**: human principals (`kind = 'user'`) in the server's audience, for tools at `on`, and
  also at `admins` for administrators. Agent principals never get passthrough tools on `/mcp`, and
  neither does any request carrying `?passthrough=0` (server-owned sessions): sessions get
  servers only through toolsets.
- **Naming**: action `<server>-<tool in kebab case>`, so the MCP name follows the Box
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

`/mcp/servers/<id>` serves one server's visible tools under their upstream names, with the
same rules, over MCP 2026-07-28 only, like `/mcp`. Sessions use it (below); a person may add it as a separate client entry, but `/mcp` is
the documented path.

### Agent sessions

Toolsets stay core's grant layer, unchanged in shape: `servers` lists server ids, `allow` and
`deny` use `mcp__<server>` and `mcp__<server>__<tool>` with upstream tool names.

- The session's server is `http://127.0.0.1:<port>/mcp/servers/<id>` with the **session
  principal's** Box token (the one its `box` server already carries, behind the same loopback
  check) and an `x-box-via` header naming the room or trigger run. The upstream credential never
  enters a session.
- The session sees tools by the same levels as its principal (the system agent is an
  administrator). A toolset's servers are granted whatever the audience: the session's server
  carries core's signed `x-box-grant` header, so a person calling the endpoint with their own
  token cannot claim it. Then the toolset's `deny` removes and `allow` auto-approves. A tool not in
  `allow` asks in chat and is refused in an unattended trigger, as today.
- A session acting as a person (a trigger that runs as a person) also gets that person's own
  servers, the ones whose audience includes them, auto-approved since the person could call
  those tools themselves; the toolset's `deny` still applies. One that cannot be used is left out
  rather than failing the session. An agent principal has no own servers, and neither does a
  session under a built-in toolset that keeps only some Box tools (outside content).
- A toolset naming a server that does not exist, is `not_connected` or `reauth` refuses the
  session and says why (fail closed). `unreachable` starts the session; calls fail as above.

### Identity

Every call reaches the upstream with the Box's single credential. Consequences, stated in Settings:
upstream logs show the Box (the key, or the admin who signed in), never the person or agent, so
Stripe cannot tell Ana's refund from Ben's; an OAuth server breaks when the admin who connected
leaves the upstream team, a service key does not; and everyone in the audience can read whatever
the credential can read.

Mitigations: the narrowest credential (a read-only restricted key; Stripe "agent API keys" carry
exactly the permissions chosen), write tools `off` or `admins`, tool review, and the Box audit log,
which is the only per-person record of who called what.

### Audit

`mcp_calls` (created from its ModelSpec on boot): `id`, `called_at`, `server`, `tool`,
`principal`, `surface` (`mcp`, `cli`, `session`), `via` (room or trigger run, for sessions),
`outcome` (`ok`, `error`, `denied`, `rate_limited`, `unavailable`), `duration_ms`, `error`, `args`
(JSON, truncated to 4 KB, keys named like secrets removed). Results are not stored. Rows older than
`auditDays` are pruned on write. A server's Activity tab in Settings > MCP Servers lists its
calls; `mcp-calls` returns them for one server or all.

### Procedures and tools

| Action | Transports | Who | Does |
|---|---|---|---|
| `mcp-servers` | MCP, CLI, tRPC | member | servers visible to the caller: label, status, tools and levels; admins get all, with problems |
| `mcp-server-check` | MCP, CLI, tRPC | admin | re-list tools, update status, report new or changed tools |
| `mcp-calls` | MCP, CLI, tRPC | admin | the audit log, filtered by server, principal, tool, outcome, period |
| `mcpServerSave`, `mcpServerDelete` | tRPC | admin, human | define, edit, remove a server (delete refuses while a toolset names it) |
| `mcpServerProbe` | tRPC | admin, human | probe a URL before adding it: sign-in (`oauth`, `key` or `none`), transport, the server's own name; stores nothing |
| `mcpServerKeySet` | tRPC | admin, human | write the key (write only) |
| `mcpOauthStart`, `GET /api/mcp/oauth/callback`, `mcpDisconnect` | tRPC, REST | admin, human | OAuth connect, callback, revoke and delete |
| `mcpToolsReview` | tRPC | admin, human | set tool levels and marks, accept new or changed tools |

"Human" means refused for agent principals, like toolset edits: a session cannot widen its own
reach through the Box. Event `mcp.server.status` (dedup `<id>:<status>:<hour>`) lets
automation alert on a failing server.

**Views**: Settings > MCP Servers lists servers with status, tools turned on and a Connect
button for an OAuth server that is not signed in. Add server asks for a name and a URL; the Box
probes the URL for its sign-in and transport (Advanced overrides them, sets the id, an OAuth client
id and scopes) and adds the server for administrators only. A server's page has Sign-in (Connect,
Reconnect, Disconnect) or Key at the top, since it gates everything, then four tabs. Tools shows two
groups, Read-only and Tools that change things, each tool On, Admins or Off and each group set at
once (new tools are off until reviewed, with one step to turn on the read-only ones; a row menu moves
a tool to the other group, which sets its mark). Access holds the audience, rate limit and toolsets,
Details the name, URL, transport and sign-in, Activity the server's recent calls. Members see their servers and tools,
read only. Settings > Agent tools keeps toolsets.

### Security

- **At rest**: secrets only in `box.local.json` (owner-only, atomic writes), backed up with the
  instance, never published.
- **Never printed or forwarded**: no API returns a secret; logs and errors redact tokens, keys and
  codes. The caller's Box token and the upstream credential both stop at the relay.
- **Prompt injection**: upstream results are outside data (a Stripe customer can name themselves
  anything) and descriptions come from the upstream too. Hold new tools, flag changed descriptions,
  keep write tools off where read is enough, and never grant a server with write tools to a
  toolset whose runs read outside content (an agent that drafts replies to inbound messages, for one).
- **SSRF**: only admins set URLs; OAuth endpoints must be https; redirects are not followed across
  hosts during discovery.

### Rollout on the Team Box with Stripe

1. Builder adds this powerup, runs the transition script for the existing `agentMcp.servers`, and
   passes `box verify` (INSTALL.md).
2. **Owner**: in the Stripe Dashboard, create an agent API key (the "Agent" badge) on a sandbox
   with read permissions (customers, charges, invoices, subscriptions, products, prices, payment
   intents, balance). Non-agent restricted keys stop working on Stripe MCP after 2026-11-30.
3. **Owner**: Settings > MCP Servers > Add: `stripe`, `https://mcp.stripe.com`, auth Key, paste
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

### Owner questions

Each with the recommendation (2026-10-17).

1. **Powerup or core?** A powerup of `mcp` replacing `agentMcp.servers`; core keeps toolsets, gains a
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
10. **Default rate limit.** 60 calls per minute per principal per server.
11. **Per-person upstream accounts** (each person's own Google). Out of scope; a later powerup if a server should act as each person.

## Adding and using a server

### Connect a server

1. **Pick the credential.** Prefer a key the upstream scopes to read-only and to one account (a
   Stripe agent API key with read permissions). Use OAuth when the server offers nothing else; the
   server then acts as the administrator who signed in.
2. **Add it** in Settings > MCP Servers: a name and the URL. The Box works out the sign-in; the id
   (the tool prefix, short: `stripe`, `linear`) comes from the name unless Advanced sets it. The
   owner pastes the key or clicks Connect. The agent prepares everything else and asks for exactly
   that step.
3. **Review the tools.** Every tool starts held. Turn on what the team needs, set write tools to
   `admins` or leave them off, and read each description: it is text the upstream wrote and agents
   will follow. Move a tool to Read-only tools only when it changes nothing upstream; any other
   tool is a write and needs write access to the `mcp` area.
4. **Choose the audience.** `admins` until the team has seen the tool list; then `everyone` or a
   list of people.
5. **Grant agents** by adding the server to a toolset (Settings > Agent tools), with `allow`
   for the read tools an unattended trigger needs.
6. **Prove it**: `box mcp-server-check <id>`, one read call through `box <id>-<tool>`, and the
   row in `box mcp-calls`.

### Customise for the team

1. **Defaults.** `rateLimit` per server and `auditDays` in `features.mcp`. Raise the rate limit
   for a server agents use in bulk; lower it for one with a costly upstream.
2. **Tool naming.** The prefix is the server id. Choose ids that read well in front of the
   upstream's names (`stripe` gives `StripeStripeApiRead`; a shorter id cannot remove the upstream's
   own prefix). Changing an id later renames every tool and breaks toolset entries; treat it as a
   new server.
3. **More upstreams.** Nothing in the feature is Stripe-specific. A server that needs a
   pre-registered OAuth client takes `oauth.clientId` in settings and `clientSecret` in
   credentials. Record anything unusual about an upstream in the Box's `docs/GOTCHAS.md`.
4. **The skill.** `features/mcp/skills/mcp/SKILL.md` tells agents how to find a server's tools,
   read a failure message (reconnect, unreachable, rate limited) and when to ask a person instead of
   retrying. Keep its rule that agents never ask anyone for an upstream credential.

### What not to change

- Do not hand a session the upstream credential (a toolset server with a token, a profile's
  `mcpServers`): the relay is what keeps the credential, the audit and the tool levels in one place.
- Do not expose passthrough tools to agent principals on `/mcp`: it would grant every server to
  every session through the auto-approved `box` server, past its toolset.
- Do not add a second way to define a server (back in `agentMcp`, or in a feature's own settings).

## Gotchas

- **The redirect URI is `server.dashboardUrl`.** OAuth 2.1 servers refuse plain-http redirect URIs
  that are not loopback, so a Box reached at `http://box.tailnet:8190` cannot complete OAuth to an
  upstream. Serve it over https (`tailscale serve` gives a `ts.net` certificate) and set
  `dashboardUrl` to that address before connecting. The upstream redirect is
  `<dashboardUrl>/api/mcp/oauth/callback`; changing `dashboardUrl` later needs a reconnect (and, with
  Dynamic Client Registration, a fresh registration). Keys are unaffected.
- **The OAuth session belongs to the admin who clicked Connect.** Upstream it is that person's
  grant: if they leave the upstream team or lose the role, the server drops to `reauth`. For a
  team server that should outlive a person, prefer a service key.
- **Some servers register only clients they approved.** Figma's remote server
  (`https://mcp.figma.com/mcp`) accepts only the clients in its MCP catalog: its Dynamic Client
  Registration answers 403 for a Box, and Connect says so. Such a server works only with an OAuth
  client id its provider issues (Details > OAuth client id) or through another server the provider
  offers (Figma's desktop server at `http://127.0.0.1:3845/mcp`, on the machine running the Figma
  app).
- **Authorization server metadata can sit at the path-inserted URL.** Stripe's issuer
  `https://access.stripe.com/mcp` publishes its metadata at
  `https://access.stripe.com/.well-known/oauth-authorization-server/mcp`, not under `/mcp/`.
  Discovery tries the RFC 8414 form first.
- **Stripe keys.** From 2026-12 Stripe MCP accepts only agent API keys (the "Agent" badge) and
  OAuth; full secret keys and other restricted keys answer 401. Most of Stripe is behind two tools,
  `stripe_api_read` and `stripe_api_write`, so the key's own permissions, not the tool list, are
  the fine-grained limit. Stripe asks a human to confirm some writes (refunds, outbound payments)
  through a URL in the tool result; that person approves as the server's identity.
- **Clients cache tool lists.** A tool turned on, or a new server, appears in a person's Claude
  or Codex only after the client reconnects, and in an agent session only from its next session.
  Use `box <id>-<tool>` to test in the meantime.
- **A session's shell can reach `/mcp` as its principal.** Sessions get passthrough tools only by
  toolset, but a session allowed to run shell commands can read its principal's Box token and call
  `/mcp` directly, getting what that person could. Toolsets for runs that read outside content
  should deny `Bash`, as docs/AGENT-TOOLS.md already says.
- **Upstream text is untrusted.** Tool descriptions and results come from outside the Box. Held
  tools and the changed-description flag exist so a new or rewritten tool is read by a person before
  agents follow it.
- **The audit log holds call arguments.** They can name an upstream's customers. Keep `auditDays`
  short enough for the team's data rules, and include the table in backups like other personal data.

## Without the powerup

The base recipe is unchanged: people connect their own clients with MCP sign-in and use the Box's
own tools. A toolset's page in Settings > Agent tools offers no servers and names this powerup;
toolsets that still name a server fail closed. Core does not read `agentMcp.servers`.
