# `data-sync` - built-in pulls that feed core's signals

Data Sync pulls numbers from outside platforms into the Box. Each pull stores its raw response as a
dated snapshot in the warehouse and re-derives its channel's signals from every snapshot it has, so
the signal views, boards, goals and alerts that core and other recipes provide read them like any
other signal. The signal store, definitions, owners, boards, presets, data sources and the browser
lease are core: see [docs/SIGNALS.md](../../docs/SIGNALS.md) and
[docs/BROWSERS.md](../../docs/BROWSERS.md).

The base recipe carries the platforms that need no account of their own: npm, the blog feed (with an
optional GA4 leg) and Hacker News. Every further platform is a powerup: `github`, `x`, `reddit`,
`linkedin`, `substack` and `stripe` (`powerups/<id>/`).

- **Builds on**: core only.
- **Depended on by**: nothing. No recipe imports Data Sync code. A recipe that publishes to LinkedIn or
  Substack, and the Alerts LinkedIn and Reddit polls, reach a platform client only through core's
  platform port (`packages/core/src/platforms.ts`); without the powerup that registers it,
  `requirePlatformClient` refuses with `add the Data Sync "<id>" powerup`. Other recipes may read
  the `github-engagement` and `reddit-engagement` snapshots when they exist.
- **Removal**: removing Data Sync stops the pulls. The signals it derived keep their points and stop
  refreshing; the recipes that use a platform client refuse their LinkedIn, Substack and Reddit
  calls with the powerup name and keep working otherwise.
- **Tables and migrations**: none. Pulls write core's `snapshots` and `signal_points` tables.

## Layout

```
features/data-sync/
  core/
    platform.ts     the DataSyncPlatform descriptor and the pull() action helper
    platforms.ts    installedPlatforms(): the installed platforms, maintained by hand
    derive.ts       Builder, loadSnapshots, deriveSignals, deriveAllSignals, derivedChannelIds
    persist.ts      persist(): store a snapshot and re-derive its channel
    actions.ts      every installed platform's actions plus warehouse-derive
    manifest.ts     the `data-sync` core feature (no models, no migrations)
    npm/ blog/ hackernews/                         base recipe
    github/ x/ reddit/ linkedin/ substack/ stripe/ one folder per powerup
  server/
    index.ts                          DataSyncModule; runs each platform's register() at boot
    ingest/ingest.controller.ts       pull catalog and one streamed tool per common pull
    warehouse/warehouse.controller.ts warehouse-derive
    reddit-diagnostics.controller.ts  the reddit powerup's diagnostics tools
```

There is no web code: the pulls appear in Settings > Automation (core's action registry) and their
signals in core's Signals view.

## The platform descriptor

Every platform folder exports one `DataSyncPlatform` from its `index.ts`
(`core/platform.ts`):

| member | meaning |
|---|---|
| `id` | the platform id (`npm`, `github`, ...) |
| `powerup` | the powerup that carries it (`recipes/data-sync/powerups/<id>`), or `null` for the base recipe |
| `actions` | its pulls and backfills, built with `pull(info, run, group)`; group `Pulls` (default) or `Backfills` |
| `derivers` | dashboard channel to deriver; a deriver returns every signal row the channel's snapshots yield |
| `channels` | the channels a full re-derive covers, when they differ from the deriver keys (GitHub adds one `github@<account>` per extra account) |
| `register` | server-side registration at boot: a core provider, a platform client, an event hook |

`core/platforms.ts` lists the installed platforms:
`[npm, blog, hackernews, github, x, reddit, linkedin, substack, stripe]`. Adding a powerup adds its
import and entry there; removing one deletes both and its folder. `installedPlatforms()` is read
lazily because platform modules import the derive machinery that reads the list.

## Snapshots and derives

A pull calls `persist(snapshotChannel, date, payload, derive?)`:

1. `upsertSnapshot` writes the payload verbatim to `snapshots` keyed by (channel, date). A second
   pull on the same day overwrites that day.
2. The dashboard channel is re-derived: `deriveSignals(channel)` runs the platform's deriver over
   every snapshot (`loadSnapshots`, ascending by date) and `replaceChannelSignals` swaps the
   channel's `live` points for derived signals. Definitions are auto-registered for new signal ids
   and never overwritten, so a renamed label or an owner set by hand survives.

`derive` defaults to the snapshot channel when that channel has a deriver. A snapshot channel can
feed a different dashboard channel (`reddit-engagement` snapshots feed `reddit.engagement_open`), and
`null` stores a snapshot with no signals (`github-engagement`, `reddit-radar`).

`Builder` keeps the first value per signal and date. Account-scoped channels (`github@bob`) share
their base channel's deriver; `splitChannel` resolves the base.

Backfills reconstruct history and write `backfill` points through `upsertBackfillSignals`, which
only fill buckets that have no point of that class. Core's precedence (live over backfill over
manual) decides what a reader sees ([docs/SIGNALS.md](../../docs/SIGNALS.md)).

A channel derive replaces the channel's live rows for derived signals. Another feature that keeps
rows on a Data Sync channel contributes them through core's signal hooks (`channelRows`); the GitHub
deriver appends `contributedChannelRows(channel)` so Planning's PR rows ride along.

## Platforms

| platform | powerup | actions | snapshot channels | signals |
|---|---|---|---|---|
| npm | base | `npm-pull`, `npm-backfill` | `npm` | `npm.week`, `npm.month`, `npm.pkg.<name>` |
| blog | base | `blog-pull` | `blog` | `blog.posts`; with GA4 `blog.pageviews`, `blog.sessions`, `blog.users` |
| hackernews | base | `hackernews-pull` | `hackernews` | `hn.karma`, `hn.submissions`, `hn.mentions` |
| github | `github` | `github`, `github-engagement`, `backfill-prs`, `backfill-stars` | `github`, `github@<account>`, `github-engagement` | `<channel>.followers`, `.org_followers`, `.public_repos`, `.oss_prs`, `.stars.<repo>`, `.views.<repo>`, `.uniques.<repo>` |
| x | `x` | `x`, `backfill-x` | `x` | `x.followers`, `x.following`, `x.posts`, `x.impressions`, `x.engagement` |
| reddit | `reddit` | `reddit`, `reddit-engagement`, `reddit-radar` | `reddit`, `reddit-engagement`, `reddit-radar` | `reddit.total_karma`, `.link_karma`, `.comment_karma`, `.posts`, `.comments`, `.top_post_score`, `.engagement_open` |
| linkedin | `linkedin` | `linkedin`, `backfill-linkedin` | `linkedin` | `linkedin.followers`, `.connections`, `.impressions`, `.members_reached`, `.reactions`, `.comments`, `.reshares`, `.org_followers`, `.org_impressions` |
| substack | `substack` | `substack-pull` | `substack` | `substack.posts`, `.drafts`, `.views`, `.subscribers`, `.paid_subscribers`, `.open_rate`, `.posts_with_stats` |
| stripe | `stripe` | none (core's `source-sync` / `sources-sync`) | the data source id | the measures its bound signals subscribe to |

### npm (base)

Public `api.npmjs.org`, no credential. The package list is `features.data-sync.npmPackages`:
`packages` sum into `npm.week` and `npm.month` and compete for the six per-package
`npm.pkg.<name>` signals; `tracked` always get their own signal and never fold into the total. A
name in both lists counts as tracked. Entries starting with `_` are notes. The list is empty by
default; with no packages both actions log one line and do nothing. `npm-backfill` writes about 17
months of weekly history.

### Blog (base)

The feed is `feed` on the `blog` account in `box.json accounts` (default account first, then any
account with a feed). Only absolute http(s) URLs count; no feed means one log line and no pull. The
RSS leg needs no credential and derives `blog.posts`.

The GA4 leg (`blog/ga4.ts`) is optional. With `GOOGLE_APPLICATION_CREDENTIALS` (a service-account key
file path) and a numeric `GA4_PROPERTY_ID` under `credentials.blog.<account>` it adds the last 28
complete days of pageviews, sessions and users. A relative key path resolves against the repo root,
then the instance directory. A missing key, a non-numeric property id or a missing file skips the
leg with a log line; once both are present an API failure fails the run.

### Hacker News (base)

The default `hackernews` account's `login` is the profile; its `mentionTerms` are searched site-wide
as brand mentions. Firebase v0 and Algolia search, both public. Up to 100 submissions are expanded
per run. No `hackernews` account means the run fails with a pointed message.

### GitHub (`github` powerup)

Account-scoped: `github` sweeps every `github` account with a non-blank `login`; the default account
keeps the bare `github` channel and every other account gets `github@<id>` with its own signal ids.
Each account authenticates with its own classic `GH_TOKEN` (`credentials.github.<account>`) passed to
the `gh` CLI, which must be installed on the Box host. The ambient `gh` login is never used, so a run
cannot ride whoever is logged in. `repos` names the repos to track; `org` adds the org's followers;
`ossPrQuery` is the search counting external PRs. Repo traffic needs push access and GitHub keeps only
14 days of it, so a missed stretch is lost, not backfillable.

`github-engagement` (default account only) collects issue and PR threads involving or authored by the
account in the last 14 days (up to 80) plus participating notifications, and stores them as the
`github-engagement` snapshot, which other recipes may read. `backfill-prs` builds a cumulative monthly
`<channel>.oss_prs` curve for accounts with an `ossPrQuery`; `backfill-stars` rebuilds
`<channel>.stars.<repo>` from stargazer timestamps.

### X (`x` powerup)

The default `x` account authenticates with OAuth 1.0a user context (`X_OAUTH1_CONSUMER_KEY`,
`X_OAUTH1_CONSUMER_KEY_SECRET`, `X_OAUTH1_ACCESS_TOKEN`, `X_OAUTH1_ACCESS_TOKEN_SECRET` under
`credentials.x.<account>`), through `twitter-api-v2`. One timeline page of up to 100 posts per pull
bounds the pay-per-use cost. Organic metrics are requested first; when the API refuses them the pull
falls back to public metrics. `backfill-x` writes posting cadence from post timestamps.

`x.engagement` counts incoming `x.reply`, `x.mention`, `x.quote`, `x.repost` and `x.like` events per
day, zero-filled. The platform's `register` adds an event hook that rewrites this one signal on every
such event, so it stays current between pulls.

### Reddit (`reddit` powerup)

Reddit's OAuth path is not available, so `reddit`, `reddit-engagement` and `reddit-radar` read
Reddit's JSON endpoints from a leased tab in the Box's default browser identity (`browsers.identity`),
signed in to the account named by the default `reddit` account's `login`. `reddit-engagement` reads
the inbox and stores `reddit-engagement`, which derives `reddit.engagement_open` and which
other recipes may read. `reddit-radar` scans `/r/<sub>/new` (75 posts per sub, last 14 days) for posts
matching `features.data-sync.redditRadar.topics` whole-word and stores candidates as the
`reddit-radar` snapshot; each scan stamps the `subs` and `topics` that produced it. Either list empty
means one log line and no scan.

The platform registers the `reddit` client: `unreadInbox()` reads Reddit's private RSS inbox feed with
a plain GET, authenticated by `REDDIT_FEED_TOKEN` (`credentials.reddit.<account>`), no browser. The
Alerts Reddit poll uses it. The feed sends no ETag, so every poll returns the full small body;
deduplicate by the item fullname.

### LinkedIn (`linkedin` powerup)

The official Community Management API, no browser. The OAuth app's `LINKEDIN_CLIENT_ID` and
`LINKEDIN_CLIENT_SECRET` live channel-scoped under `credentials.linkedin["*"]` (an account's own entry
wins). Each account holds `LINKEDIN_ACCESS_TOKEN` and `LINKEDIN_PERSON_URN`, plus optionally
`LINKEDIN_REFRESH_TOKEN`, `LINKEDIN_TOKEN_EXPIRES_AT` and `LINKEDIN_REFRESH_EXPIRES_AT`. With a refresh
token the client renews the access token close to expiry and once on a 401, writing the new token set
back to `box.local.json`, so the daily pull runs unattended.

`linkedin` reads the default account's followers, first-degree connections and lifetime post
analytics, and with `org` on the account the company page's followers and share statistics
(best effort). It fetches per-post analytics for every post a feature registers through core's
`registerPublishedPostSource('linkedin', ...)` (published posts with a post URN).
`backfill-linkedin` reconstructs history from daily analytics deltas anchored at current totals.
`LINKEDIN_VERSION` in `linkedin/client.ts` pins the `Linkedin-Version` header (`202606`); LinkedIn
sunsets versions monthly, so bump it deliberately.

The platform registers the `linkedin` client (`authReady`, `personUrn`, `get`, `post`,
`uploadImage`) for a recipe that publishes to LinkedIn and for the Alerts comment poll.

### Substack (`substack` powerup)

Substack has no OAuth and no token for the publisher API, so the private JSON API is authenticated by
the `substack.sid` session cookie. The default `substack` account's `publication` names the
publication origin. The session resolves cheapest first:

1. `SUBSTACK_SID` (and `SUBSTACK_CONNECT_SID`) cached in `credentials.substack.<account>`, accepted
   only after `/user/profile/self` confirms it (Substack sets the cookie on anonymous visitors too).
2. Cookies harvested from the account owner's own browser identity (`browsers.users.<users.id>`).
3. The sign-in form driven in that browser with `SUBSTACK_EMAIL`, `SUBSTACK_PASSWORD` and optionally
   `SUBSTACK_2FA_SECRET`. A captcha leaves the tab open for a person to solve.

Each success caches the cookie back into `box.local.json`. A 401 mid-run re-mints once. Password login
through the API is captcha-gated, which is why the browser is the path.

`substack-pull` reads the publication, its archive and the headline stats. Two of the stats endpoints
answer 403 on a young publication; those signals appear without a code change once Substack opens
them. The platform registers the `substack` client (`selfProfile`, `createDraft`, `updateDraft`,
`publishDraft`, `uploadImage`) for a recipe that publishes to Substack.

### Stripe (`stripe` powerup)

A provider for core's data sources, registered at boot with `registerProvider`. It has no actions of
its own; core's `source-sync` and `sources-sync` run it. See
[powerups/stripe/POWERUP.md](powerups/stripe/POWERUP.md).

## Procedures and tools

All controllers carry the class-level `AuthGuard`. The CLI takes the kebab form of a tool name
(`IngestNpmPull` is `box ingest-npm-pull`).

`IngestController` (`@Controller('ingest')`): `ingestCatalog` (query, no tool) lists core's action
registry filtered to the `Pulls` and `Backfills` groups, without parameterized actions. Thirteen tRPC
subscriptions with MCP tools each start a recorded run of one action and stream its progress:

| MCP | action | platform |
|---|---|---|
| `IngestNpmPull` | `npm-pull` | npm |
| `IngestNpmBackfill` | `npm-backfill` | npm |
| `IngestBlogPull` | `blog-pull` | blog |
| `IngestHackernewsPull` | `hackernews-pull` | hackernews |
| `IngestGithub` | `github` | github |
| `IngestGithubEngagement` | `github-engagement` | github |
| `IngestBackfillPrs` | `backfill-prs` | github |
| `IngestBackfillStars` | `backfill-stars` | github |
| `IngestX` | `x` | x |
| `IngestBackfillX` | `backfill-x` | x |
| `IngestReddit` | `reddit` | reddit |
| `IngestRedditEngagement` | `reddit-engagement` | reddit |
| `IngestRedditRadar` | `reddit-radar` | reddit |

`linkedin`, `backfill-linkedin` and `substack-pull` have no method; run them through core's run
funnel (`box run-now --action_id <id>` or Settings > Automation). A method whose powerup is not
installed names an action that does not exist; remove it with the powerup.

`WarehouseController` (`@Controller('warehouse')`): `warehouseDerive` (mutation, MCP
`WarehouseDerive`) runs `warehouse-derive`.

`RedditDiagnosticsController` (`@Controller('reddit')`, reddit powerup): `RedditProbe` (is the
browser attached and signed in as the configured account), `RedditLogin` (navigates the browser to
Reddit's login page; a person types the credentials there), `RedditThread` (a full thread for drafting
context) and `RedditExplore` (probes a battery of JSON endpoints). Only `RedditLogin` changes
anything, and only the tab's location.

## Actions

`core/actions.ts` contributes every installed platform's actions plus `warehouse-derive` to core's
action registry through the manifest, so all are schedulable by Automation and recorded in run
history.

- **Pulls**: `npm-pull`, `blog-pull`, `hackernews-pull`, `github`, `github-engagement`, `x`,
  `reddit`, `reddit-engagement`, `reddit-radar`, `linkedin`, `substack-pull`.
- **Backfills**: `npm-backfill`, `backfill-prs`, `backfill-stars`, `backfill-x`,
  `backfill-linkedin`.
- **Warehouse**: `warehouse-derive` re-derives every channel in `derivedChannelIds()` from its
  snapshots, then runs every registered signal hook's `derive()` step and reports the extra rows per
  feature.

## Settings and credentials

Shared settings live in `box.json`, secrets in the gitignored `box.local.json`. Data Sync reads no
environment variables.

- `accounts.<platform>`: who each pull is for. Fields: `id`, `user` (a users.id, which makes the
  signals owned by that person), `default`, `login` (blank is a placeholder pulls skip), and per
  platform `feed` (blog), `mentionTerms` (hackernews), `repos`, `org`, `ossPrQuery` (github), `org`
  (linkedin), `publication` (substack). Example: `docs/examples/accounts.json`.
- `features.data-sync.npmPackages`: `{ "packages": [...], "tracked": [...] }`.
- `features.data-sync.redditRadar`: `{ "subs": [...], "topics": [...] }`. Subs may be written `name`,
  `r/name` or `/r/name`.
- `credentials.<platform>.<account>.<KEY>` in `box.local.json`; `<account>` `*` holds keys shared by
  every account of the platform. Keys: `blog` `GOOGLE_APPLICATION_CREDENTIALS`, `GA4_PROPERTY_ID`;
  `github` `GH_TOKEN`; `x` the four `X_OAUTH1_*` keys; `reddit` `REDDIT_FEED_TOKEN`; `linkedin`
  the `LINKEDIN_*` keys above; `substack` the `SUBSTACK_*` keys above; `stripe` `STRIPE_API_KEY` per
  data source id.
- The browser lease (`browsers.url`, `browsers.identity`, `browsers.token`, `browsers.users`) is
  core's; Reddit and Substack use it. See [docs/BROWSERS.md](../../docs/BROWSERS.md).

A pull with a missing credential fails with the missing key names.

## What a team customises

- **Platforms.** Remove a powerup the team does not use: its folder, its entry in
  `core/platforms.ts`, its `IngestController` methods, and for reddit the diagnostics controller in
  `server/index.ts`. Signals it already derived stay in the warehouse.
- **Channel labels.** `apps/web/src/types.ts` (`Channel`, `CHANNEL_LABEL`) labels channels in the
  Signals view. A channel missing there shows its raw id.
- **Lists.** npm packages, the radar's subs and topics, and the accounts are settings, not code.
- **Schedules.** Automation triggers over the action ids above; nothing runs on a timer by default.

## Adding a platform

1. Create `features/data-sync/core/<id>/` with a pull (`AsyncGenerator<IngestProgress>`) that calls
   `persist('<id>', date, payload)`, a deriver that uses `loadSnapshots` and `Builder`, and an
   `index.ts` exporting a `DataSyncPlatform` (`powerup: '<id>'` when it ships as a powerup).
2. Add its import and entry to `core/platforms.ts`.
3. Read credentials with `requireCredentials('<id>', account, KEY)` from `@silkweave/box-core/credentials`
   and the account with `defaultAccount('<id>')`; never environment variables.
4. Prefer an official API. A browser flow goes through core's browser lease and stays read-only
   unless a person drives it.
5. Register anything other features need (a platform client, a provider, an event hook) in
   `register`, never by import.
6. Add a channel label, then run `box run-now --action_id <action>` and `box warehouse-derive`.
