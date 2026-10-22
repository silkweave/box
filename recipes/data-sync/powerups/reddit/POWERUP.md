# Reddit

The team's Reddit account as signals and leads: karma and activity, the inbox replies awaiting an answer, and a radar that finds new threads on the team's topics in the subreddits it names.

## Highlights

- Total, link and comment karma, post and comment counts and the top post score
- `reddit.engagement_open`: inbox replies awaiting the team, also stored as a snapshot other recipes may read
- A topic radar over `/new` of the named subreddits, matching the team's keywords whole-word, stored for drafting replies
- A browser-free unread inbox read for the Alerts Reddit poll, authenticated by Reddit's private feed token
- Diagnostics as tools: probe the session, open the login page for a person, fetch a full thread, explore endpoints
- Read-only: nothing here posts, votes or messages

## Needs

- The Data Sync recipe
- Core's browser lease configured, with a browser identity signed in to the team's Reddit account ([docs/BROWSERS.md](../../../../docs/BROWSERS.md))
- For the Alerts Reddit poll: the account's private RSS feed token

## How it works

The platform lives in `features/data-sync/core/reddit/` and is listed in `core/platforms.ts`; the
diagnostics tools are `features/data-sync/server/reddit-diagnostics.controller.ts`. Reddit's OAuth
path is not available, so the `reddit`, `reddit-engagement` and `reddit-radar` actions lease a tab in
the Box's default browser identity (`browsers.identity`) and fetch Reddit's JSON endpoints from the
signed-in `www.reddit.com` origin. Whose account it is comes from the default `reddit` account's
`login` in `box.json accounts`. The radar's lists are `features.data-sync.redditRadar` (`subs`,
`topics`); it scans the last 14 days, 75 posts per subreddit, and each stored scan records the lists
that produced it.

The platform's `register` adds the `reddit` client to core's platform port. Its `unreadInbox` reads
Reddit's private RSS inbox feed with a plain request authenticated by `REDDIT_FEED_TOKEN` from
`box.local.json credentials.reddit.<account>`, with no browser. Without this powerup the Alerts
Reddit poll refuses with "add the Data Sync reddit powerup".
