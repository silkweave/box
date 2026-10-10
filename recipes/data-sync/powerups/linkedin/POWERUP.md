# LinkedIn

LinkedIn numbers as signals from the official API: the member's followers, connections and post analytics, the company page's followers and impressions, with history, plus the LinkedIn client Content publishes through.

## Highlights

- Member followers, first-degree connections, impressions, members reached, reactions, comments and reshares
- Company page followers and impressions when the account names an organization
- Per-post analytics for every post Content published with a stamped post URN
- A backfill that reconstructs history from LinkedIn's daily analytics
- Runs unattended: with a refresh token the client renews the access token before it expires and once on a 401
- Registers the `linkedin` client that Content's LinkedIn publishing and the Alerts comment poll use

## Needs

- The Data Sync recipe
- A LinkedIn developer app with the Community Management API, and a member access token for each account, created by its owner

## How it works

The platform lives in `features/data-sync/core/linkedin/` and is listed in `core/platforms.ts`. Its
actions are `linkedin` and `backfill-linkedin`; neither has an ingest tool, so they run through core's
run funnel (`box run-now --action_id linkedin`) and Automation triggers. The client calls the
Community Management API with a pinned `Linkedin-Version` header (`LINKEDIN_VERSION` in
`linkedin/client.ts`). The app's `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` live once under
`box.local.json credentials.linkedin["*"]`; each account keeps its own `LINKEDIN_ACCESS_TOKEN`,
`LINKEDIN_PERSON_URN` and, when LinkedIn issued them, `LINKEDIN_REFRESH_TOKEN`,
`LINKEDIN_TOKEN_EXPIRES_AT` and `LINKEDIN_REFRESH_EXPIRES_AT`. A refresh writes the new token set back
to `box.local.json`.

The pull reads the default `linkedin` account in `box.json accounts`; its `org` (a numeric
organization id) adds the company page, best effort. Per-post analytics cover the posts that features
register through core's `registerPublishedPostSource('linkedin', ...)`. The platform's `register` adds
the `linkedin` client (`authReady`, `personUrn`, `get`, `post`, `uploadImage`) to core's platform
port; without this powerup Content's LinkedIn publishing and the Alerts LinkedIn poll refuse with
"add the Data Sync linkedin powerup".
