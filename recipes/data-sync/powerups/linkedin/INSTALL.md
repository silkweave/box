# LinkedIn powerup: install

Adds the LinkedIn pulls and the LinkedIn platform client to Data Sync. Read [POWERUP.md](POWERUP.md)
and the recipe [GOTCHAS.md](../../GOTCHAS.md) first. Do as much as possible yourself; stop only for
the owner-only steps.

## Detect

`features/data-sync/core/linkedin/` exists and `core/platforms.ts` lists `linkedin`. `box run-now
--action_id linkedin` then either pulls or names what is missing: `missing credentials for
linkedin@<account>: ...` lists the keys to add; `token expired and no refresh token stored` needs a
new token from the owner. Both are repair, not a new install.

## Requires

- The Data Sync recipe, adapted and validated.

## Owner decisions

Ask these together:

1. **Accounts**: the LinkedIn member(s) to track, which is the default, and the Box user who owns
   each. With the Content recipe, every member who publishes needs an account entry and a token.
2. **Company page**: the numeric organization id, if the page's numbers and page posting are wanted.
3. Whether to run `backfill-linkedin` once after the first pull.

## Owner-only steps

Ask for each when it is needed, then wait:

1. **Create the LinkedIn app.** In the LinkedIn developer portal, create an app associated with the
   company page and request the Community Management API product. Approval is LinkedIn's and can
   take days. The owner pastes the app's client id and secret into `box.local.json` themselves
   (step 4).
2. **Issue a member token** per account, signed in as that member: the developer portal's OAuth token
   tool, or the app's authorization code flow, with the scopes the Community Management API grants
   for member analytics, organization analytics and posting. The owner pastes the access token, its
   expiry, and the refresh token when LinkedIn issues one into `box.local.json` themselves (step 4);
   never into the transcript. The Box has no tool that runs this flow.

## Steps

1. **Source.** `box stack fetch --ref <sha>`, then copy `<fetched stack>/features/data-sync/core/linkedin/`
   into the Box's `features/data-sync/core/linkedin/`.
2. **Register.** In `features/data-sync/core/platforms.ts` add
   `import { linkedin } from './linkedin/index.js'` and `linkedin` to the `installedPlatforms()` list.
   There are no ingest controller methods for LinkedIn.
3. **Accounts.** In `box.json`:
   ```json
   "accounts": { "linkedin": [{ "id": "alice", "user": "alice", "default": true, "login": "alice", "org": "1234567" }] }
   ```
4. **Credentials.** The owner adds:
   ```json
   { "credentials": { "linkedin": {
     "*": { "LINKEDIN_CLIENT_ID": "...", "LINKEDIN_CLIENT_SECRET": "..." },
     "alice": { "LINKEDIN_ACCESS_TOKEN": "...", "LINKEDIN_TOKEN_EXPIRES_AT": "2026-12-09T00:00:00Z",
                "LINKEDIN_REFRESH_TOKEN": "..." }
   } } }
   ```
5. **Person URN.** Read the member id from `GET https://api.linkedin.com/v2/me` with the stored token
   (a short script that reads `box.local.json` and prints only the id) and set
   `LINKEDIN_PERSON_URN` to `urn:li:person:<id>` for the account. The URN is not a secret.
6. Restart the server so the client registers.
7. **Record** the powerup and its Stack revision in `docs/UPSTREAM.md`, the session in
   `_docs/INTEGRATION.md`. No token goes in either.

## Verify

1. `box run-now --action_id linkedin` finishes with the login, followers and lifetime impressions,
   and with an `org` the page's followers. `linkedin.followers`, `linkedin.impressions` and, with an
   org, `linkedin.org_followers` appear in `box signals-list` and the Signals view. Compare followers
   with the profile on linkedin.com.
2. Optional: `box run-now --action_id backfill-linkedin`; `box signal-series` on
   `linkedin.followers` shows history before the first pull.
3. With the Content recipe: publishing a LinkedIn piece no longer refuses with "add the Data Sync
   linkedin powerup". With Engagement: `box run-now --action_id engagement-linkedin-comments` runs.
4. After these checks and the validation chain pass, add `linkedin` to `recipes.data-sync.powerups`
   in `box.json`.

## Remove

Delete `features/data-sync/core/linkedin/` and its import and entry in `platforms.ts`; remove
`accounts.linkedin` if nothing else uses it, the `credentials.linkedin` entries from `box.local.json`,
and `linkedin` from `recipes.data-sync.powerups`. The derived signals keep their points and stop
refreshing; Content's LinkedIn publishing and the Alerts LinkedIn poll then refuse with the powerup
name. The owner can remove the app's access in LinkedIn.
