# X

The team's X account as signals: followers, posts and impressions from the X API, plus a daily engagement count kept current as X events arrive.

## Highlights

- Followers, following, total posts and impressions across recent posts
- Organic metrics where the API grants them, public metrics otherwise
- `x.engagement`: replies, mentions, quotes, reposts and likes per day, updated on every such event without waiting for a pull
- A backfill that rebuilds posting cadence from post timestamps
- Bounded cost: one page of up to 100 posts per pull on the pay-per-use API

## Needs

- The Data Sync recipe
- An X developer app with API access and OAuth 1.0a user tokens for the team's account, created by its owner

## How it works

The platform lives in `features/data-sync/core/x/` and is listed in `core/platforms.ts`. Its actions
are `x` and `backfill-x`. The pull authenticates as the default `x` account in `box.json accounts`
with the four OAuth 1.0a keys from `box.local.json credentials.x.<account>`, through
`twitter-api-v2`, reads the profile and the newest timeline page (retweets and replies excluded),
stores the `x` snapshot and re-derives `x.followers`, `x.following`, `x.posts`, `x.impressions` and
`x.engagement`.

`x.engagement` is counted from the Box's `x.reply`, `x.mention`, `x.quote`, `x.repost` and `x.like`
events, zero-filled from the first one. The platform's `register` adds an event hook at boot that
rewrites this signal whenever such an event is recorded, so it stays current between pulls. Those
events come from whatever records them in the Box (a webhook source or another feature); without
them the signal has no points.
