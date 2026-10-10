# X powerup: install

Adds the X pulls to Data Sync. Read [POWERUP.md](POWERUP.md) and the recipe
[GOTCHAS.md](../../GOTCHAS.md) first. Do as much as possible yourself; stop only for the owner-only
steps.

## Detect

`features/data-sync/core/x/` exists and `core/platforms.ts` lists `x`. `box run-now --action_id x`
then either pulls or names what is missing: `missing credentials for x@<account>: ...` lists the keys
to add (repair, not a new install); `no default account for channel "x"` means `box.json accounts.x`
is not set.

## Requires

- The Data Sync recipe, adapted and validated.
- `twitter-api-v2` in the root workspace package.

## Owner decisions

1. **Account**: the X handle to track and the Box user who owns it.
2. **Schedule**: the API is pay per read, so a daily pull is the usual choice.
3. Whether to run `backfill-x` once after the first pull.

## Owner-only steps

1. **Create the X app and tokens.** In the X developer portal, create a project and app with API
   access, enable OAuth 1.0a user authentication with read permission, and generate the API key and
   secret (consumer keys) and an access token and secret for the team's account. The owner pastes the
   four values into `box.local.json` themselves (step 4); never into the transcript. Usage is billed by
   X per request.

## Steps

1. **Source.** `box stack fetch --ref <sha>`, then copy `<fetched stack>/features/data-sync/core/x/`
   into the Box's `features/data-sync/core/x/`. Add `twitter-api-v2` (latest) to the root package if
   it is not there.
2. **Register.** In `features/data-sync/core/platforms.ts` add `import { x } from './x/index.js'`
   and `x` to the `installedPlatforms()` list. Copy the `x` and `backfillX` methods into
   `features/data-sync/server/ingest/ingest.controller.ts` from the fetched Stack.
3. **Account.** In `box.json`:
   ```json
   "accounts": { "x": [{ "id": "alice", "user": "alice", "default": true, "login": "alice" }] }
   ```
4. **Credentials.** The owner adds:
   ```json
   { "credentials": { "x": { "alice": {
     "X_OAUTH1_CONSUMER_KEY": "...", "X_OAUTH1_CONSUMER_KEY_SECRET": "...",
     "X_OAUTH1_ACCESS_TOKEN": "...", "X_OAUTH1_ACCESS_TOKEN_SECRET": "..."
   } } } }
   ```
5. Restart the server (or `bun run typegen`) so the new tools appear and the event hook registers.
6. **Record** the powerup and its Stack revision in `docs/UPSTREAM.md`, the session in
   `_docs/INTEGRATION.md`. No key goes in either.

## Verify

1. `box ingest-x` finishes with the handle, followers, posts read, whether organic or public metrics
   were granted, and impressions. `x.followers`, `x.posts` and `x.impressions` appear in
   `box signals-list` and the Signals view. Compare followers with the profile on x.com.
2. Optional: `box ingest-backfill-x`; `box signal-series` on `x.posts` shows history before the
   first pull.
3. If the Box records X engagement events, `x.engagement` gains a point for today after the next one.
4. After these checks and the validation chain pass, add `x` to `recipes.data-sync.powerups` in
   `box.json`.

## Remove

Delete `features/data-sync/core/x/`, its import and entry in `platforms.ts`, and the `x` and
`backfillX` `IngestController` methods; remove `accounts.x` if nothing else uses it, the
`credentials.x` entries from `box.local.json`, and `x` from `recipes.data-sync.powerups`. The derived
signals keep their points and stop refreshing. The owner can revoke the tokens in the X developer
portal.
