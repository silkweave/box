# Configuration

A Box reads two JSON files at its checkout root. `box.json` contains shared settings and can be
committed. `box.local.json` contains machine-specific overrides and secrets and is gitignored.
Neither the server nor the CLI reads environment variables for Box settings or loads `.env` files.

The order is built-in defaults, `box.json`, then `box.local.json`. Objects merge recursively,
arrays replace, and explicit null values clear nullable settings. Malformed JSON and unknown core
keys fail with an error. The schema is `packages/core/box.schema.json`.

```json
{
  "$schema": "./packages/core/box.schema.json",
  "agent": { "id": "nova", "name": "Nova", "role": "admin" },
  "server": { "host": "127.0.0.1", "port": 8190, "vitePort": 5190 },
  "background": { "automation": false, "chatAgent": false, "relay": false, "features": {} }
}
```

Choose the system principal before first boot. Its ID is locked once initialized. Put alternative
ports in `box.local.json` when running another checkout. `server.host` is the interface the Box
listens on and defaults to `127.0.0.1`, so only this machine can reach it. Over a tailnet, the
recommended path is `tailscale serve`, which gives the Box an HTTPS address while it keeps
listening on loopback (see [SERVER.md](SERVER.md)). To reach a Box directly from other machines
instead, set `server.host` to `0.0.0.0` (or `::` for IPv6 as well) in `box.local.json`. In both
cases set `server.dashboardUrl` to the address people use. Sign-in links are built from it, the
development server also accepts requests for its host, and the mobile app scripts
(`apps/mobile/scripts/build.sh` and `dev.sh phone`) compile it in as the app's server address
when no `--server` is given; see [MOBILE.md](MOBILE.md). Brand changes require a frontend rebuild.
Keep automation and agent hosts disabled in runtime tests.

`server.vscodeRemoteHost` names the ssh host (`box` or `you@box`) for Open-in-VS-Code links over
Remote-SSH when the dashboard is viewed from another machine; null keeps local file links.
`server.viteDevUrl` sends every SPA request to the Vite dev server at that address, as `box dev`
does, instead of serving the promoted release. `backup.gcsBucket` names a private GCS bucket (no `gs://` prefix) that every
backup is also uploaded to with the host's ambient gcloud credentials; null keeps backups local
(see [WAREHOUSE.md](WAREHOUSE.md)).

`background` arms work that runs without a request: `automation` (time and event triggers),
`chatAgent` (agent replies in chat) and `relay` (the automation recipe's webhook relay connection,
see `recipes/automation/powerups/relay/`). Arm `relay` on exactly one Box per relay Worker: a
second connection takes the Worker over.

`background.features.<feature-id>.<capability>` arms a feature's own background work, such as a
connection a powerup holds open. A feature declares its capabilities in its core manifest
(`background`, capability key to what it arms) and reads them through `isBackgroundEnabled(featureId,
capability)`; the recipe's docs name its keys and where to arm them. Each capability is a boolean
and is off unless set to `true`. Ids of features this Box has not adapted are accepted, so a shared
`box.json` may carry them. A capability that a registered feature does not declare fails the boot
with the key named, because it is almost always a typo that would otherwise read as off. The keys
merge like every other setting, so `box.local.json` decides for the one checkout that arms them:

```json
{ "background": { "features": { "<feature-id>": { "<capability>": true } } } }
```

Every switch, feature capabilities included, defaults to false and is forced off in maintenance.

`timeZone` is the team's clock, an IANA zone name such as `Europe/Vienna` (default `UTC`). The
server and every browser read "today", "this week" and day-based ages on it, so the whole team
shares one day wherever the host or a person sits. Choose the zone where most of the team works.
Core exports `teamDay()` (server, reads `box.json` at call time), `dayInZone()` and `addTeamDays()`
(pure, `@silkweave/box-core/team-day`); the web app reads the zone from `/api/auth/me` through
`apps/web/src/lib/teamDay.ts`. API windows of external services and exchange rates stay in UTC.

Core sections include `agent`, `timeZone`, `brand`, `server`, `backup`, `background`, `http`, `auth`, `mcp`,
`stack`, `recipes`, `signals`, `browsers`, `agentMcp`, `accounts`, `credentials`, `agentProfiles` and
`workerdeck`. Feature settings live under `features.<id>`, keyed by the feature id, and are
described in the documentation of the recipe the feature came from (`recipes/<id>/`). For example,
the Data Sync recipe's settings (`features.data-sync.npmPackages`, `features.data-sync.redditRadar`)
are described in [recipes/data-sync/](../recipes/data-sync/).

## Signals

`signals.owners` maps signals to the people who own them ([SIGNALS.md](SIGNALS.md#owners)):
`channels` gives a default owner per signal channel, and `signals` overrides one signal, where null
marks it deliberately unowned. Settings > Signal owners writes it to `box.local.json`; edits apply
at the next read.

```json
{
  "signals": {
    "owners": {
      "channels": { "github": "alice" },
      "signals": { "mrr": "bob", "npm.week": null }
    }
  }
}
```

## Browsers

`browsers` configures the browser lease ([BROWSERS.md](BROWSERS.md)): `url` (Shuttle's MCP endpoint,
default `http://127.0.0.1:9222/mcp`; an origin without a path gets `/mcp` appended), `identity` (the
default Shuttle agent, default `default`), `token` (bearer token for Shuttle network mode only, in
`box.local.json`) and `users` (`users.id` -> that person's Shuttle agent id).

```json
{ "browsers": { "url": "http://127.0.0.1:9222/mcp", "users": { "alice": "alice" } } }
```

## Agent tools

`agentMcp.toolsets` holds the toolsets that chat rooms and agent triggers grant to their agent
sessions ([AGENT-TOOLS.md](AGENT-TOOLS.md)): id -> `label`, `description`, `servers` (connection
ids), `allow`, `deny`. Settings > Agent tools writes it to `box.local.json`. Built-in toolsets (such
as a feature's drafting toolset) come from features and are not configured here. The servers a toolset attaches are
connections of the MCP connections recipe, configured under `features.mcp` with their secrets in
`credentials.mcp.<connection>` ([recipes/mcp/SPEC.md](../recipes/mcp/SPEC.md)).

## Recipe ledger

`recipes` in `box.json` records which recipes this Box has adapted and which of their powerups it has
added. Keys are recipe ids (lowercase slugs); `powerups` lists ids of folders under
`recipes/<id>/powerups/`.

```json
{
  "recipes": {
    "chat": { "powerups": ["mobile"] },
    "mobile": { "powerups": [] },
    "reminders": { "powerups": [] }
  }
}
```

The agent that adapts a recipe adds its entry once the validation chain passes, and the agent that
adds a powerup appends its id once the powerup's Verify steps and the validation chain pass.
Removing a recipe or powerup removes the entry or id. Keep it in `box.json`, not `box.local.json`:
it is shared, reviewable state. It is a record, not a lock or an install mechanism: nothing
installs from it and no script polices it. See [RECIPES.md](RECIPES.md#the-recipe-ledger).

## Recipe registry

`registry` names the recipe registry this Box lists and fetches recipes from (`box recipe`, the
Recipe Gallery). `url` belongs in `box.json`; the default is `https://registry.silkweave.dev`, and
it must be `https://` (`http://` only for `localhost` or `127.0.0.1`). `token` is an access key and
belongs in the gitignored `box.local.json`; set it with `box registry key` (or the optional step in
`bun setup`), which checks it with the registry before saving.

```json
{ "registry": { "url": "https://registry.silkweave.dev" } }
```

The key is read by the server and the CLI only. It never reaches a browser bundle or an API
response, is never printed, and is never sent on a redirect. A malformed key or URL fails
configuration loading. See [RECIPES.md](RECIPES.md#the-recipe-registry) and [CLI.md](CLI.md).

## Stack source

`stack.source` names the Stack repository, for a Box that reads it directly. `box stack fetch` reads
it to find the reference implementation; a Box without Stack access uses the recipe registry. The shared value belongs in `box.json`; the default is
`silkweave/stack`.

```json
{ "stack": { "source": "silkweave/stack" } }
```

The value is one of:

- GitHub shorthand `owner/repo`. A bare `owner/repo` always means GitHub; write `./owner/repo` for
  a relative directory.
- A git URL: anything containing `://` (`https://`, `ssh://`, `file://`) or the scp-like
  `user@host:path` form.
- A filesystem path: `.`, `..`, `~`, or a value starting with `/`, `./`, `../` or `~/`. Relative
  paths resolve against the Box root and `~` expands to the home directory.

On a host that authenticates to GitHub with an SSH key only, the HTTPS URL behind the shorthand
fails with "could not read Username". Override the value in `box.local.json` with the scp-like form,
`{ "stack": { "source": "git@github.com:silkweave/stack.git" } }`, and delete a `.stack/` cache
cloned from the HTTPS URL (it refuses a different origin). A failed HTTPS GitHub fetch prints this
hint.

To read a local Stack checkout on one machine, override the value in `box.local.json`, for example
`{ "stack": { "source": "../stack" } }`. When the development Box's `box.local.json` has no `stack`
key, `bun run box:build` writes one pointing at the Stack checkout it was built from: a relative
path such as `..`, or an absolute path when the relative one would need more than two `../`. An
existing `stack` key is left alone. A malformed value fails configuration loading, and whitespace
inside a non-path value is refused. A git source is cached in the `.stack/` directory at the Box
root, which is gitignored and denied by the Vite dev server so it is never served. See
[RECIPES.md](RECIPES.md#the-stack-source) and [CLI.md](CLI.md).

## Secrets and service settings

Use `auth.sessionSecret` and `auth.tokenSecret` only in `box.local.json`. Missing signing keys are
generated there at first use. Changing them invalidates sessions or encrypted access tokens.
`mcp.url` defaults to the local server; set `mcp.token` locally to the intended principal's token.
Never print permanent tokens into logs. `credentials` is keyed by channel, account, then key;
the account `*` supplies channel-wide defaults. `accounts` declares channel accounts by channel,
one per owning agent (for example `accounts.email`: `{ id, user, login }`); a channel that pairs a device
keeps its accounts in its own store instead. Agent engine configuration belongs in `workerdeck` and user-to-profile mappings in
`agentProfiles`. Claude logins for agent profiles are connected in Settings > Profile and
kept by WorkerDeck beside each profile's config dir; configuration that sets `workerdeckTokens`
or `workerdeck.claudeTokens` is refused.

Runtime settings edits and credential refreshes write only the relevant overrides to
`box.local.json`, atomically with owner-only permissions. Shared settings remain unchanged.
Back up that file separately from database exports and never publish it. The browser bundle receives
only the brand section, never the complete configuration.

Operating-system environment inherited by subprocesses, such as PATH and third-party engine
internals, is not Box configuration. External services retain their own authentication mechanisms.
