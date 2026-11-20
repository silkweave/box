# Adapt the mcp recipe

This is the adaptation guide for the mcp recipe (MCP sign-in). Read [RECIPE.md](./RECIPE.md),
[SPEC.md](./SPEC.md), the recipe [GOTCHAS.md](./GOTCHAS.md), the Box's `docs/UPSTREAM.md`, and its
current `_docs/INTEGRATION.md` before changing files. These recipe documents ship with core, so a
Box has them at `recipes/mcp/`. The reference implementation does not: it is fetched from the recipe
registry as `features/mcp/`. In a Box, run `box recipe fetch mcp` and read
`<fetched recipe>/features/mcp/` (`<fetched recipe>` is the path it prints), so the documents and
the code come from the same version.

## Detect

`features/mcp/server/oauth/` exists and `features/mcp/server/index.ts` declares `mcpAuth`. On a
running Box with a usable address, `box auth connections` lists connected apps (or says there are
none) and the MCP URL; without the recipe it says MCP sign-in is not set up. `box.json`
`recipes.mcp` is present once the recipe was verified, and its `powerups` list names the powerups
added. A Box that adapted `mcp` before it became MCP sign-in has the source and the entry, but its
ledger records no base verification until the upgrade below has passed.

## Prerequisites

- An existing Box backup, including `box.local.json`, and a recorded restore path for data and
  matching application source.
- Core at a revision that has the MCP sign-in port (`packages/core/src/mcp-auth.ts`, the access-ended
  port and `users.auth_epoch`) and Silkweave 7.3.0 or later with `@silkweave/auth`. An older core is
  upgraded with `$upgrade` first.
- Where the Box will be used from: `server.dashboardUrl` set to the address people reach the Box at,
  over **https**, or a Box used only on the machine that runs the client (`http://localhost` or
  `http://127.0.0.1`). Sign-in is not offered on any other address (SPEC.md, "The MCP URL"). The
  owner confirms the address before the recipe is adapted, because changing it later disconnects
  everyone.
- `auth.sessionSecret` set (the signing key derives from it).
- The source version to fetch (for an update, the one in the `recipes` ledger of `box.json`), and an
  integration entry with scope, target version, intended changes and state in
  `_docs/INTEGRATION.md`.
- A disposable instance for build, typecheck, tests, schema checks and boot verification, with
  background work and chat agents disabled.

## Owner decisions

Ask these together before copying code:

1. **The address.** The https `server.dashboardUrl` people will use (a tailnet `ts.net` address
   served over https works), or localhost-only use. Say plainly that changing it later makes
   everyone connect again.
2. **Who connects.** Any invited person may connect their own clients; administrators can revoke
   anyone's. Nothing to configure, but tell the owner that a connected client holds the person's
   permissions, writes included.
3. **Powerups.** Ask which to add now; each can be added later:
   - `servers` (MCP Servers): let this Box use outside MCP servers (Stripe and others) connected
     once by an administrator ([powerups/servers/](powerups/servers/POWERUP.md)). Available.
   - `desktop-extension` (Claude Desktop) and `public-endpoint` (claude.ai, ChatGPT and mobile
     through a public address): planned, not yet available. Cloud clients cannot reach a private
     Box until the second exists.

## Integration

Tables are created on boot from the feature's ModelSpecs; there are no shipped migrations for them.

1. Copy/adapt the base from `<fetched recipe>/features/mcp/` into the Box's `features/mcp/`:
   - `core/`: `manifest.ts`, `index.ts`, `models.ts`, `db.ts` and `oauth/` (the sign-in store,
     grants and tables).
   - `server/`: `index.ts`, `mcp.module.ts` and `oauth/` (the OAuth server and `/mcp` hook).
   - `web/index.tsx`.
   The `servers/` folders under `core/`, `server/` and `web/`, and `skills/mcp/`, are the
   `servers` powerup: leave them out unless the owner chose it. Without it, delete every line
   marked `// servers powerup` in `core/models.ts`, `core/index.ts`, `server/mcp.module.ts` and
   `web/index.tsx` (in the web entry this leaves `settings: []`); nothing else refers to the
   powerup. Register it as the `mcp` feature in
   `apps/server/src/generated/features.ts`, `apps/web/src/generated/features.ts`,
   `packages/core/src/generated/features.ts` and `packages/core/src/generated/exports.ts`. The
   server entry must declare `mcpAuth` (core reads it while the `/mcp` adapter is built).
2. Packages in the root workspace package: `@silkweave/auth` (the OAuth server); the servers
   powerup adds its own.
3. Record path mappings and skipped parts in `docs/UPSTREAM.md`; update `_docs/INTEGRATION.md` as
   each step completes.
4. Add the powerups the owner chose (`powerups/<id>/INSTALL.md`).

## Upgrading a Box that already has `mcp`

The feature id, tables, `mcp:<name>` keys and credentials do not change, and outside MCP servers
keep working. What changes is the ledger, where the MCP server settings live, and the base:

1. Back up as in Prerequisites, then upgrade core and the recipe source.
2. With the Box stopped, before it boots the new code, run the one-off transition script
   `_docs/scripts/mcp-servers-transition.ts` (kept in the Stack's `_docs/`, copy it to the Box):
   `bun mcp-servers-transition.ts [--root <box checkout>] [--dry-run]`. It records the `servers`
   powerup in `recipes.mcp.powerups` and moves the MCP server settings to `features.mcp.servers`
   in `box.json` and `box.local.json`. It never records `desktop-extension` or `public-endpoint`;
   the owner chooses those. On boot, migration `mcp:001-calls-server-column` renames the audit
   log's column to `server`.
3. Verify the new base below. Only after that does the owner's agent record the base verification
   (the script does not).
4. If `server.dashboardUrl` is not https and the Box is not localhost-only, sign-in stays off and
   `/mcp` keeps taking access tokens: tell the owner what to change.

## Verify

Run `box verify`, then boot the disposable instance (background work off) and prove it end to end:

1. `box auth connections` prints the MCP URL (`server.dashboardUrl` + `/mcp`) and no connected apps.
   With an http non-localhost address it says the URL is not offered, and `/mcp` answers a valid
   access token as before.
2. Settings > Profile as an administrator and as a member on a custom role without the `mcp` area:
   Connect an AI client shows the URL and the two commands, and Connected apps is empty.
3. Connect Claude Code or Codex for real (`claude mcp add --transport http <name> <url>` then
   `/mcp` and Authenticate, or `codex mcp add <name> --url <url>`). The browser lands on
   `/connect`, signed out it goes through the login and returns, Allow returns to the client, and
   the client lists the Box's tools and calls one (for example `Whoami`) as that person.
4. Connected apps shows the connection with its connected time; after a call, a last used time.
   `box auth connections <user-id>` shows it too.
5. Revoke it in Connected apps: the next call from the client is refused. Connect again, then revoke
   the person's access: the client stops working, and `box auth connections <user-id>` shows none.
   `box auth connections log <user-id>` lists the consent, connection, refreshes and both revokes.
6. An access token still opens `/mcp`; an OAuth access token is refused on `/api` and a tRPC call.
7. Deny on the consent page ends the client's sign-in with a refusal message and creates no grant.
8. Load `/connect`, Settings > Profile and the Users detail in a browser (a module-scope
   registration cycle only shows there).

Record the actual commands and results in `_docs/VALIDATION.md`. Once the chain and these checks
pass, add `"mcp": { "powerups": [] }` to `recipes` in `box.json` (or keep the existing entry), then
each powerup's id once its own Verify passes.
