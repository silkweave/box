# Data Sync

Built-in pulls that turn the team's public numbers into signals with history: npm downloads, blog posts and traffic, and Hacker News in the base recipe, one powerup per further platform. Each pull keeps the raw snapshot and re-derives its channel's signals, so the core signal views, boards and alerts read them like any other signal.

## Highlights

- npm weekly downloads for the packages the team lists, with a history backfill
- Blog publishing cadence from the team's RSS feed, plus GA4 pageviews, sessions and users when a service account is configured
- Hacker News karma, submissions and brand mentions
- A full re-derive of every channel from the stored snapshots
- GitHub (GitHub powerup): followers, repo stars and traffic, OSS PRs, the replies awaiting you, with star and PR history
- X (X powerup): followers, posts, impressions and an engagement count kept current by X events
- Reddit (Reddit powerup): karma, the inbox replies awaiting you and a topic radar over the subreddits the team names, through a signed-in browser
- LinkedIn (LinkedIn powerup): member and company page analytics with history, and the client Content publishes through
- Substack (Substack powerup): posts, subscribers and open rate, and the client Content publishes through
- Stripe (Stripe powerup): gross and net volume, refunds, MRR and active subscriptions as a data source, with history
