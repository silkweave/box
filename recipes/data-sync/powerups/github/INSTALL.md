# GitHub powerup: install

Adds the GitHub pulls to Data Sync. Read [POWERUP.md](POWERUP.md) and the recipe
[GOTCHAS.md](../../GOTCHAS.md) first. Do as much as possible yourself; stop only for the owner-only
steps.

## Detect

`features/data-sync/core/github/` exists and `core/platforms.ts` lists `github`. `box run-now
--action_id github` then either pulls or names what is missing: `missing credentials for
github@<account>: GH_TOKEN` means a token to add, not a new install; `no github accounts configured`
means `box.json accounts.github` has no account with a login.

## Requires

- The Data Sync recipe, adapted and validated.
- `gh` (GitHub CLI) on the Box host: `gh --version`. Install it with the host's package manager if
  missing; no `gh auth login` is needed.

## Owner decisions

Ask these together:

1. **Accounts**: which GitHub logins to track, which one is the default, and which Box user owns each.
2. **Repos** per account (`owner/name`) to track stars and traffic for, and an **org** to snapshot
   alongside the user, if any.
3. **OSS PR query** per account, if the team counts external PRs (for example
   `is:pr author:alice -org:acme`).
4. Whether to run the **backfills** once after the first pull.

## Owner-only steps

1. **Create a classic personal access token** per account (GitHub > Settings > Developer settings >
   Personal access tokens > Tokens (classic)) with the `repo` and `notifications` scopes. A token
   with no scopes is enough for public stars and followers only; repo traffic needs `repo` and push
   access; the engagement pull needs `notifications`. A fine-grained token does not work here: the
   notifications API is classic-only. The owner pastes it into `box.local.json` themselves (step 4);
   never into the transcript.

## Steps

1. **Source.** `box stack fetch --ref <sha>`, then copy `<fetched stack>/features/data-sync/core/github/`
   into the Box's `features/data-sync/core/github/`.
2. **Register.** In `features/data-sync/core/platforms.ts` add
   `import { github } from './github/index.js'` and `github` to the `installedPlatforms()` list. Copy
   the `github`, `githubEngagement`, `backfillPrs` and `backfillStars` methods into
   `features/data-sync/server/ingest/ingest.controller.ts` from the fetched Stack.
3. **Accounts.** In `box.json`:
   ```json
   "accounts": { "github": [
     { "id": "alice", "user": "alice", "default": true, "login": "alice",
       "org": "acme", "repos": ["acme/acme"], "ossPrQuery": "is:pr author:alice -org:acme" }
   ] }
   ```
4. **Credentials.** The owner adds, per account id:
   ```json
   { "credentials": { "github": { "alice": { "GH_TOKEN": "ghp_..." } } } }
   ```
5. Restart the server (or `bun run typegen`) so the new tools appear.
6. **Record** the powerup and its Stack revision in `docs/UPSTREAM.md`, the session in
   `_docs/INTEGRATION.md`. No token goes in either.

## Verify

1. `box ingest-github`: the summary names each account channel with its followers, repo stars and
   external PR count. Signals `github.followers`, `github.stars.<repo>` (and `github@<id>.*` for other
   accounts) appear in `box signals-list` and the Signals view. A repo without push access shows
   traffic unavailable, not a failure.
2. `box ingest-github-engagement` finishes with the engagements found by kind and the
   candidates checked, and the `github-engagement` snapshot holds them.
3. Optional: `box ingest-backfill-stars` and, with an `ossPrQuery`, `box ingest-backfill-prs`;
   `box signal-series` shows history before the first pull.
4. After these checks and the validation chain pass, add `github` to `recipes.data-sync.powerups` in
   `box.json`.

## Remove

Delete `features/data-sync/core/github/`, its import and entry in `platforms.ts`, and the four
`IngestController` methods; remove `accounts.github` if nothing else uses it, the `credentials.github`
entries from `box.local.json`, and `github` from `recipes.data-sync.powerups`. The derived signals keep
their points and stop refreshing. The owner can revoke the tokens on GitHub.
