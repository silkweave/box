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
  "server": { "port": 8190, "vitePort": 5190 },
  "background": { "automation": false, "chatAgent": false, "relay": false }
}
```

Choose the system principal before first boot. Its ID is locked once initialized. Put alternative
ports in `box.local.json` when running another checkout. Brand changes require a frontend rebuild.
Keep automation and agent hosts disabled in runtime tests.

Core sections include `agent`, `brand`, `server`, `backup`, `background`, `http`, `auth`, `mcp`,
`accounts`, `credentials`, `agentProfiles`, `workerdeck` and `workerdeckTokens`. Feature settings
live under `features.<id>` and are described in each feature's documentation.

Use `auth.sessionSecret` and `auth.tokenSecret` only in `box.local.json`. Missing signing keys are
generated there at first use. Changing them invalidates sessions or encrypted access tokens.
`mcp.url` defaults to the local server; set `mcp.token` locally to the intended principal's token.
Never print permanent tokens into logs. `credentials` is keyed by channel, account, then key;
the account `*` supplies channel-wide defaults. `accounts` declares the corresponding channel
accounts. Agent engine configuration belongs in `workerdeck`, user-to-profile mappings in
`agentProfiles`, and per-person host tokens in `workerdeckTokens`.

Runtime settings edits and credential refreshes write only the relevant overrides to
`box.local.json`, atomically with owner-only permissions. Shared settings remain unchanged.
Back up that file separately from database exports and never publish it. The browser bundle receives
only the brand section, never the complete configuration.

Operating-system environment inherited by subprocesses, such as PATH and third-party engine
internals, is not Box configuration. External services retain their own authentication mechanisms.
