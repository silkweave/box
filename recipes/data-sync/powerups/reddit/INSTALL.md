# Reddit powerup: install

Adds the Reddit pulls, the topic radar, the inbox client and the diagnostics tools to Data Sync. Read
[POWERUP.md](POWERUP.md), the recipe [GOTCHAS.md](../../GOTCHAS.md) and
[docs/BROWSERS.md](../../../../docs/BROWSERS.md) first. Do as much as possible yourself; stop only
for the owner-only steps.

## Detect

`features/data-sync/core/reddit/` exists and `core/platforms.ts` lists `reddit`. `box reddit-probe`
then reports the state: `logged in as u/<name>` is working (an `expected u/<login>` warning means the
wrong account is signed in); `attached, but no logged-in Reddit session` needs the owner's sign-in;
a connection error means the browser lease is not configured or reachable (`box cdp-check`). A Box
in any of these states needs repair, not a new install.

## Requires

- The Data Sync recipe, adapted and validated.
- Core's browser lease configured (`browsers.url`, `browsers.identity`, `browsers.token`) and
  `box cdp-check` passing. See [docs/BROWSERS.md](../../../../docs/BROWSERS.md).
- `playwright-core` in the root workspace package.

## Owner decisions

Ask these together:

1. **Account**: the Reddit username and the Box user who owns it.
2. **Radar**: the subreddits to watch and the words that make a thread on-topic. Either list empty
   leaves the radar off.
3. **Alerts poll**: whether to add the inbox feed token now (needed only for the Alerts Reddit poll).

## Owner-only steps

Ask for each when it is needed, then wait:

1. **Sign in to Reddit in the browser.** Run `box reddit-login`: it opens Reddit's login page in a
   leased tab of the default identity. The owner takes the tab over at the browser gateway, signs in
   as the account, and closes the tab there. The agent never types the credentials.
2. **Feed token** (optional). Signed in on reddit.com, the owner opens Reddit's RSS feed preferences
   (`https://www.reddit.com/prefs/feeds/`), copies the private inbox feed link, and pastes its `feed=`
   value into `box.local.json` themselves (step 5); never into the transcript.

## Steps

1. **Source.** `box stack fetch --ref <sha>`, then copy `<fetched stack>/features/data-sync/core/reddit/`
   into the Box's `features/data-sync/core/reddit/` and
   `<fetched stack>/features/data-sync/server/reddit-diagnostics.controller.ts` into
   `features/data-sync/server/`.
2. **Register.** In `features/data-sync/core/platforms.ts` add
   `import { reddit } from './reddit/index.js'` and `reddit` to the `installedPlatforms()` list. In
   `features/data-sync/server/index.ts` import `RedditDiagnosticsController` and add it to the
   module's `controllers`. Copy the `reddit`, `redditEngagement` and `redditRadar` methods into
   `features/data-sync/server/ingest/ingest.controller.ts` from the fetched Stack.
3. **Account and radar.** In `box.json`:
   ```json
   "accounts": { "reddit": [{ "id": "alice", "user": "alice", "default": true, "login": "alice_reddit" }] },
   "features": { "data-sync": { "redditRadar": {
     "subs": ["typescript", "webdev"],
     "topics": ["monorepo", "build cache"]
   } } }
   ```
4. Restart the server (or `bun run typegen`) so the tools appear and the client registers. Then the
   owner-only sign-in (step 1 above), and `box reddit-probe` until it reports the right account.
5. **Feed token**, if chosen. The owner adds:
   ```json
   { "credentials": { "reddit": { "alice": { "REDDIT_FEED_TOKEN": "..." } } } }
   ```
6. **Record** the powerup and its Stack revision in `docs/UPSTREAM.md`, the session in
   `_docs/INTEGRATION.md`. No token goes in either.

## Verify

1. `box reddit-probe` reports `logged in as u/<login>` with karma and no warning.
2. `box ingest-reddit` finishes with karma; `reddit.total_karma` and the other `reddit.*` signals
   appear in `box signals-list` and the Signals view.
3. `box ingest-reddit-engagement` reports actionable and total inbox items; `reddit.engagement_open`
   has today's point and the `reddit-engagement` snapshot holds the open replies.
4. `box ingest-reddit-radar` with both lists set reports the candidates found (zero is a valid
   result); with either list empty it reports it skipped.
5. After these checks and the validation chain pass, add `reddit` to `recipes.data-sync.powerups` in
   `box.json`.

## Remove

Delete `features/data-sync/core/reddit/` and `server/reddit-diagnostics.controller.ts`, their import
and entry in `platforms.ts` and `server/index.ts`, and the three `IngestController` methods; remove
`accounts.reddit` if nothing else uses it, `features.data-sync.redditRadar`, the `credentials.reddit`
entries from `box.local.json`, and `reddit` from `recipes.data-sync.powerups`. The derived signals keep
their points and stop refreshing. The browser identity stays signed in until the owner signs out.
