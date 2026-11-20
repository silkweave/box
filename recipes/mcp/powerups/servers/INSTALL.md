# MCP Servers powerup: install

Adds outside MCP servers (Stripe and others), connected once by an administrator and relayed through
the Box. Read [POWERUP.md](POWERUP.md) and the recipe [SPEC.md](../../SPEC.md) and
[GOTCHAS.md](../../GOTCHAS.md) first. Do as much as possible yourself; stop only for the owner
decisions and owner-only steps.

## Detect

`features/mcp/server/servers/` exists and `features/mcp/server/mcp.module.ts` imports
`McpServersModule` (which calls `registerMcpServers` and `registerMcpActionSource`). On a running Box, `box mcp-servers`
answers (an empty list when none is defined) and Settings > MCP Servers exists.
`box.json` `recipes.mcp.powerups` lists `servers` once it was verified. Source present with no
ledger entry, as on a Box that adapted `mcp` before the powerup split, is an existing adoption: do
not re-copy it; the ledger entry is recorded by the one-off transition script
`_docs/scripts/mcp-servers-transition.ts` (run with the Box stopped, before it boots the new
code) or by the Verify steps below.

## Requires

- The mcp recipe, adapted and validated.

## Prerequisites

- An existing Box backup, including `box.local.json`, and a recorded restore path for data and
  matching application source.
- Core at a revision that has the MCP server directory port and the `/mcp` passthrough hook
  (POWERUP.md, "Decision"). An older core is upgraded with `$upgrade` first.
- `server.dashboardUrl` set to the address administrators use, over https, before any OAuth
  server: it is the redirect URI's origin (POWERUP.md, "Gotchas").
- Packages in the root workspace package: `@modelcontextprotocol/client` (the MCP client and its
  OAuth helpers), `@modelcontextprotocol/server` and `@modelcontextprotocol/node` (the server
  endpoint); `zod` is already there.
- The source version to fetch (for an update, the one in the `recipes` ledger of `box.json`), and an
  integration entry with scope, target version, intended changes and state in `_docs/INTEGRATION.md`.
- A disposable instance for build, typecheck, tests, schema checks and boot verification, with
  background work and chat agents disabled.

## Owner decisions

Ask these together before copying code (POWERUP.md, "Owner questions", has the recommendations):

1. **Servers now.** Which servers to connect first and, per server, `oauth` or `key`. For a key,
   the owner creates it upstream (the narrowest read-only key); for OAuth, the owner clicks Connect.
   The agent never creates upstream credentials.
2. **Audience and tool levels** per server, and whether new upstream tools are held for review.
3. **Existing `agentMcp.servers`.** Each entry becomes a server with the same id, so toolsets
   keep working. Confirm the list and each one's audience (default `admins`).
4. **Audit retention** (`auditDays`) and the default rate limit.


## Owner-only steps

Upstream credentials: the owner creates a key upstream, or clicks Connect and signs in to the
upstream. The agent never creates upstream credentials and never echoes a key into a transcript.

## Transition (Boxes with `agentMcp.servers`)

Core at the target revision no longer reads `agentMcp.servers`; toolsets that name those servers
refuse their sessions until the servers exist. Do this before booting the new core:

1. Back up `box.json`, `box.local.json` and the warehouse (`box db backup`); record the paths in
   `_docs/INTEGRATION.md`.
2. Write a one-off script in `_docs/scripts/` that, for each `agentMcp.servers.<id>` in `box.json`
   and `box.local.json`: writes `features.mcp.servers.<id>` (`url`, `type`, `label`,
   `auth` `key` when a token is set, else `none`, `audience` `admins`, no `tools`, so every tool is
   held), moves `token` to `credentials.mcp.<id>.key`, and removes `agentMcp.servers`. It prints ids
   only, never a token.
3. Rehearse it on a copy of both files, compare, then run it for real.
4. After boot, review each server's tools in Settings > MCP Servers: until then its tools are
   held and sessions granted it see none. Set the levels the toolsets' `allow` lists expect.


## Steps

There are no shipped migrations: `mcp_calls` is created on boot from its ModelSpec.

1. **Source.** `box recipe fetch mcp --version <the version in the recipes ledger of box.json>`, then
   copy the powerup's folders of `<fetched recipe>/features/mcp/` into the Box's `features/mcp/`,
   merging with any local copy: `core/servers/` (settings, audit, naming, rate limit, the
   `mcp_calls` table), `server/servers/` (the module, controller and relay),
   `web/servers/` (Settings > MCP Servers) and `skills/mcp/`. Then restore the lines marked
   `// servers powerup` in `core/models.ts`, `core/index.ts`, `server/mcp.module.ts` and
   `web/index.tsx` as the reference has them; change nothing else in those files. The `oauth/`
   folders and the `mcpAuth` declaration in `server/index.ts` are the base recipe's; keep them.
2. **Register.** The `mcp` feature is already registered by the base. Link the skill with the skill
   linker.
3. **Configure.** Write `features.mcp` in `box.json` with the owner's answers (servers without
   secrets).
4. **Keys.** The owner pastes them in Settings > MCP Servers, or the agent asks the owner to write
   `credentials.mcp.<id>.key` in `box.local.json` by hand. Never echo a key into the transcript.
5. **Record** path mappings and skipped parts in `docs/UPSTREAM.md`, and the session in
   `_docs/INTEGRATION.md`.

## Verify

Run `box verify`, then boot the disposable instance and exercise the surface. A local stub MCP
server (the reference implementation's test fixture) stands in for an upstream with a key and with
OAuth; real upstreams are verified on the target Box by the owner.

1. `box mcp-servers` lists the stub as `connected`; with the key removed it reports
   `not_connected`, and a call answers with the reconnect message, not an empty list.
2. Tool levels: a held tool is absent from `tools/list` for everyone; `admins` shows only to an
   administrator; `on` shows to a member in the audience and not to one outside it. An agent
   principal sees no passthrough tool on `/mcp`.
   Marks: with a custom role at `mcp: read`, only tools marked Reads are listed and callable; an
   unmarked tool answers "can change data"; the same holds in a session whose toolset grants the
   server.
3. `box <server>-<tool>` calls the stub; `box mcp-calls` shows the row with the principal,
   surface `cli` and outcome `ok`. The 61st call in a minute answers `rate_limited`.
4. OAuth against the stub: Connect, sign in, return to Settings with `connected`; expire the access
   token and call again (refresh, rotated refresh token written); revoke at the stub and call again
   (`reauth`). No token appears in the server log.
5. A toolset granting the stub: a chat room with it lists `mcp__<id>__<tool>`; the session's MCP
   config holds a loopback URL and the Box token, never the upstream key; a trigger with a tool not
   in `allow` is refused.
6. Load Settings > MCP Servers and Settings > Agent tools in a browser as an administrator and as a
   member (a module-scope registry read only shows there).

Record the actual commands and results in `_docs/VALIDATION.md`. Once the chain and these checks pass, add `servers` to
`recipes.mcp.powerups` in `box.json`. Then the owner connects the real servers
([POWERUP.md](POWERUP.md#rollout-on-the-team-box-with-stripe)), and the agent verifies each with
`box mcp-server-check <id>` and one read call.

## Remove

1. Disconnect every server first (Settings > MCP Servers), so upstream grants are revoked.
2. Remove the folders listed in Steps and the lines marked `// servers powerup`. Keep the
   base's sign-in wiring. The `mcp_calls` table stays in the database unused; drop it only with a
   backup and the owner's go.
3. Remove `servers` from `recipes.mcp.powerups`. Toolsets that still name a server then
   fail closed; edit them in Settings > Agent tools. `features.mcp.servers` and
   `credentials.mcp.*` stay unused unless the owner removes them.
4. Run `box verify`, load Settings > Agent tools, and confirm connected clients still sign in.
