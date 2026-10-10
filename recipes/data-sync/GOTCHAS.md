# data-sync gotchas

Platform code and channel derivations are source-level contracts. Preserve local credentials,
accounts and any platforms a Box deliberately left out while adapting.

The feature id (`data-sync`, the same as the recipe id) is part of runtime registration and action
registration. Keep it stable. The recipe's reference implementation is adapted by the receiving
agent, so build and type errors are expected integration work. Record any local exception, package
pin and its reason, or custom path in the Box's docs/GOTCHAS.md and leave current operation state in
_docs/INTEGRATION.md.

## Recipe-specific operational details

- **`core/platforms.ts`, the `IngestController` methods and the platform folders must agree.** A
  folder not listed contributes nothing; a listed import with no folder breaks the build; an ingest
  method whose action is not installed fails when called. Nothing checks this but the build and a run.
- **A channel derive replaces that channel's live rows** for its derived signals. Anything another
  feature keeps on the same channel must arrive through core's signal hooks (`channelRows`) or it is
  wiped on the next pull or `warehouse-derive`. Planning's PR rows ride the `github` channel this way.
- **Definitions are auto-registered, never overwritten.** A pull creates a definition for each new
  signal id and leaves existing ones alone, so labels and owners edited by hand survive. A derived
  signal cannot be renamed: the deriver would create the old id again on the next pull.
- **GitHub needs the `gh` CLI on the Box host** and a `GH_TOKEN` per account. It never falls back to
  the ambient `gh` login. Repo traffic needs push access and GitHub keeps only 14 days of it; a
  stretch without pulls is lost history, not a gap a backfill can close.
- **`LINKEDIN_VERSION` is pinned** (`linkedin/client.ts`). LinkedIn sunsets versions monthly; bump it
  deliberately and run the pull after. Without a refresh token the access token expires after about
  60 days and the pull fails until the owner issues a new one.
- **A Substack `substack.sid` cookie is not proof of a session.** Substack sets it on anonymous
  visitors; every candidate is checked against `/user/profile/self` before it is cached. Password
  login through the API is captcha-gated, so the session comes from the owner's browser.
- **Reddit runs through a signed-in browser**, not an API: the pulls need the core browser lease
  configured and the default identity signed in to the configured account. `box reddit-probe` says
  which. Reads run unattended; nothing here posts.
- **The X pull costs money per read.** One page of up to 100 posts per run; schedule it daily, not
  hourly.
- **GA4 is optional and degrades.** Without both keys the blog pull skips the leg with a reason;
  with both, an API failure fails the run.
- **After a controller change, boot once (or `bun run typegen`)** so `appRouter.d.ts` is rewritten,
  or the web typecheck is stale.
- **Ports are 8190 (Nest) / 5190 (Vite).** A second Box gets its own `server.port` / `server.vitePort`,
  never a neighbour of these.
- **`export LC_ALL=en_US.UTF-8` before any repo-wide grep.** Several files in this feature contain
  non-ASCII bytes in comments and labels, and macOS grep skips such files silently.
