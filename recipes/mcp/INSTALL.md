# Adapt the mcp recipe

This is the adaptation guide for the mcp recipe. Read [RECIPE.md](./RECIPE.md), [SPEC.md](./SPEC.md),
the recipe [GOTCHAS.md](./GOTCHAS.md), the Box's `docs/UPSTREAM.md`, and its current
`_docs/INTEGRATION.md` before changing files. These recipe documents ship with core, so a Box has
them at `recipes/mcp/`. The reference implementation does not: it lives in the Stack at
`features/mcp/`. In a Box, run `box stack fetch --ref <recorded Stack SHA>` and read
`<fetched stack>/features/mcp/`, so the documents and the code come from the same Stack revision.

## Prerequisites

- An existing Box backup, including `box.local.json`, and a recorded restore path for data and
  matching application source.
- Core at a Stack revision that has the MCP connection directory port and the `/mcp` passthrough
  hook (SPEC.md, "Decision"). An older core is upgraded with `$upgrade` first.
- `server.dashboardUrl` set to the address administrators use, over https, before any OAuth
  connection: it is the redirect URI's origin (GOTCHAS.md).
- Packages: `@modelcontextprotocol/sdk` in the root workspace package (the MCP client and its OAuth
  helpers); `zod` is already there.
- A recorded source SHA in `docs/UPSTREAM.md`, and an integration entry with scope, target SHA,
  intended changes and state in `_docs/INTEGRATION.md`.
- A disposable instance for build, typecheck, tests, schema checks and boot verification, with
  background work and chat agents disabled.

## Owner decisions

Ask these together before copying code (SPEC.md, "Owner questions", has the recommendations):

1. **Connections now.** Which servers to connect first and, per server, `oauth` or `key`. For a key,
   the owner creates it upstream (the narrowest read-only key); for OAuth, the owner clicks Connect.
   The agent never creates upstream credentials.
2. **Audience and tool levels** per connection, and whether new upstream tools are held for review.
3. **Existing `agentMcp.servers`.** Each entry becomes a connection with the same id, so toolsets
   keep working. Confirm the list and each one's audience (default `admins`).
4. **Audit retention** (`auditDays`) and the default rate limit.

## Transition (Boxes with `agentMcp.servers`)

Core at the target revision no longer reads `agentMcp.servers`; toolsets that name those servers
refuse their sessions until the connections exist. Do this before booting the new core:

1. Back up `box.json`, `box.local.json` and the warehouse (`box db backup`); record the paths in
   `_docs/INTEGRATION.md`.
2. Write a one-off script in `_docs/scripts/` that, for each `agentMcp.servers.<id>` in `box.json`
   and `box.local.json`: writes `features.mcp.connections.<id>` (`url`, `type`, `label`,
   `auth` `key` when a token is set, else `none`, `audience` `admins`, no `tools`, so every tool is
   held), moves `token` to `credentials.mcp.<id>.key`, and removes `agentMcp.servers`. It prints ids
   only, never a token.
3. Rehearse it on a copy of both files, compare, then run it for real.
4. After boot, review each connection's tools in Settings > Connections: until then its tools are
   held and sessions granted it see none. Set the levels the toolsets' `allow` lists expect.

## Integration

There are no shipped migrations: `mcp_calls` is created on boot from its ModelSpec.

1. Copy/adapt `<fetched stack>/features/mcp/` into the Box's `features/mcp/{core,server,web}` and
   `features/mcp/skills/`. Register it as the `mcp` feature in
   `apps/server/src/generated/features.ts`, `apps/web/src/generated/features.ts`,
   `packages/core/src/generated/features.ts` and `packages/core/src/generated/exports.ts`. Link the
   skill with the skill linker.
2. Write `features.mcp` in `box.json` with the owner's answers (connections without secrets).
3. Keys: the owner pastes them in Settings > Connections, or the agent asks the owner to write
   `credentials.mcp.<id>.key` in `box.local.json` by hand. Never echo a key into the transcript.
4. Record path mappings and skipped parts in `docs/UPSTREAM.md`; update `_docs/INTEGRATION.md` as
   each step completes.

## Validation

Run `box verify`, then boot the disposable instance and exercise the surface. A local stub MCP
server (the reference implementation's test fixture) stands in for an upstream with a key and with
OAuth; real upstreams are verified on the target Box by the owner.

1. `box mcp-connections` lists the stub as `connected`; with the key removed it reports
   `not_connected`, and a call answers with the reconnect message, not an empty list.
2. Tool levels: a held tool is absent from `tools/list` for everyone; `admins` shows only to an
   administrator; `on` shows to a member in the audience and not to one outside it. An agent
   principal sees no passthrough tool on `/mcp`.
3. `box <connection>-<tool>` calls the stub; `box mcp-calls` shows the row with the principal,
   surface `cli` and outcome `ok`. The 61st call in a minute answers `rate_limited`.
4. OAuth against the stub: Connect, sign in, return to Settings with `connected`; expire the access
   token and call again (refresh, rotated refresh token written); revoke at the stub and call again
   (`reauth`). No token appears in the server log.
5. A toolset granting the stub: a chat room with it lists `mcp__<id>__<tool>`; the session's MCP
   config holds a loopback URL and the Box token, never the upstream key; a trigger with a tool not
   in `allow` is refused.
6. Load Settings > Connections and Settings > Agent tools in a browser as an administrator and as a
   member (a module-scope registry read only shows there).

Record the actual commands and results in `_docs/VALIDATION.md`. Once the chain passes, add
`"mcp": { "powerups": [] }` to `recipes` in `box.json`. Then the owner connects the real servers
(SPEC.md, "Rollout"), and the agent verifies each with `box mcp-connection-check <id>` and one read
call.
