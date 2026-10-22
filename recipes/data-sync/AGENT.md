# Adapting the `data-sync` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the feature is; this is how it gets
into a Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/data-sync/`; the reference implementation is fetched from the recipe registry as `features/data-sync/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and
[GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with
`box recipe fetch data-sync`.

**Builds on:** core only. Signals, data sources, boards, presets and the browser lease are core
([docs/SIGNALS.md](../../docs/SIGNALS.md), [docs/BROWSERS.md](../../docs/BROWSERS.md)), so Data Sync
only adds pulls.

Copy the base recipe (everything except the powerup folders and the reddit diagnostics controller),
then ask which powerups to add and follow each one's `powerups/<id>/INSTALL.md`. Keep
`core/platforms.ts`, the `IngestController` methods and `server/index.ts` in step with the platform
folders that are actually present. Record the fetched version and sha256 in the `recipes` ledger of `box.json`, and the path mapping, and skipped upstream changes
in the Box's `docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

No shipped migrations. Pulls write core's `snapshots` and `signal_points`. A future schema change
must be a new migration. Back up data before applying any migration, stage its runner and
registration first, and verify migration completion and boot compatibility on a disposable restored
instance before continuing.

## 2. Customise for the team

1. **Platforms.** `core/platforms.ts` is the installed list. Each entry is one folder under
   `core/`. Removing one means deleting the folder, its import and entry, and its `IngestController`
   methods (`server/ingest/ingest.controller.ts`); the reddit powerup also removes
   `RedditDiagnosticsController` from `server/index.ts`. Its derived signals keep their points.
2. **Accounts.** `box.json accounts` says who each pull is for, one list per platform, at most one
   `default` each. `user` binds the account to a users.id, which is how its signals get an owner.
   A blank `login` is a placeholder the pull skips. GitHub accounts other than the default get their
   own `github@<id>` channel. Example: `docs/examples/accounts.json`.
3. **npm packages.** `features.data-sync.npmPackages` (`packages` sum into `npm.week` /
   `npm.month`; `tracked` always get their own `npm.pkg.<name>`). Empty by default and never seeded:
   the npm pull needs no credential, so a default list would import somebody else's downloads.
4. **Blog feed.** `feed` on the `blog` account. No default for the same reason.
5. **Reddit radar.** `features.data-sync.redditRadar` (`subs`, `topics`); both must be non-empty for
   a scan.
6. **Credentials, not env.** `box.local.json credentials.<platform>.<account>.<KEY>`, with `*` as
   the account for keys every account shares (the LinkedIn OAuth app). The owner enters them; never
   print or log one. A pull with a missing key fails with the key names, on purpose.
7. **Channel labels.** `apps/web/src/types.ts` (`Channel`, `CHANNEL_LABEL`) is app-level and kept
   by hand. A channel missing there shows its raw id in the Signals sidebar.
8. **Schedules.** Nothing pulls on a timer until the team adds Automation triggers over the action
   ids (`npm-pull`, `blog-pull`, `github`, ...). A daily trigger per pull is typical; backfills are
   one-off.

## 3. Prove it

```bash
box dev
```

Agent-side, with the base platforms configured:

```bash
box ingest-npm-pull            # npm-pull: downloads/week across the packages, npm.* signals
box ingest-blog-pull           # blog-pull: posts counted; GA4 skipped or read, with the reason
box ingest-hackernews-pull     # hackernews-pull
box warehouse-derive           # re-derives every installed channel and the signal hooks
box signals-list               # the auto-registered npm.*, blog.*, hn.* definitions
box signal-series              # one of them, with its points
```

An unconfigured npm or blog platform finishes with a `skipped - ...` summary naming the missing
setting and records a successful run, which is the correct state. Hacker News with no account fails
with a pointed message. Then open `http://localhost:8190/signals`: the npm, blog
and Hacker News channels appear with their signals, and Settings > Automation > Runs shows each run.

Each powerup's INSTALL.md has its own Verify section with real credentials.

## 4. Adapt or remove

To update this feature, compare the target Box with the version recorded in the `recipes` ledger of `box.json` (fetch it with `box recipe fetch data-sync --version <that version>`), preserve local
customizations, and apply the relevant source changes manually. Record the result in
`docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete `features/data-sync/` and its registration entries. Nothing imports it. Publishing to
LinkedIn and Substack and the Alerts LinkedIn and Reddit polls then refuse with "add the Data Sync
<id> powerup". Signals and snapshots stay in the warehouse unless the team chooses to delete
them. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot
afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and
durable local findings.
