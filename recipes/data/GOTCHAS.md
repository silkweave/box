# data gotchas

Provider code and channel derivations are source-level contracts. Preserve local provider credentials and any intentionally disabled channels while adapting.

The feature id (`data`, the same as the recipe id) is part of runtime registration and migration identity. Keep it stable. Existing
migrations are byte-exact source: preserve names, order, evaluated SQL, and callback behavior.
The recipe's reference implementation is adapted by the receiving agent, so build and type errors are expected integration
work. Record any local exception, package pin and its reason, or custom path in the Box's
docs/GOTCHAS.md and leave current operation state in _docs/INTEGRATION.md.

## Recipe-specific operational details

- Configure Chromatrix under `features.data` in `box.local.json`. GitHub tokens are account-scoped
  under `credentials.github.<account>.GH_TOKEN` in the same file.
- **"Admin-only" is a comment, not a guard.** The doc comments on `signalsUpsert`, `signalsRename`,
  `signalsOwnersSave`, `sourcesUpsert` and `sourcesDelete` say admin-only, but the controllers
  carry only the class-level `AuthGuard` and there is no `@Roles` decorator anywhere in
  `apps/server/src`. Any authenticated principal can perform them today.
- **The `sources` controller's doc comments name the wrong procedures.** They say `providersList`,
  `dataSourcesList`, `dataSourcesUpsert`, `dataSourcesDelete`; the generated router (and the SPA)
  use `sourcesProviders`, `sourcesList`, `sourcesUpsert`, `sourcesDelete`.
- **A channel derive REPLACES that channel's live rows.** Anything another feature keeps on the
  same channel must arrive through `registerSignalHooks({ channelRows })` or it is wiped on the
  next `warehouse-derive`. This is why planning's PR rows ride the `github` channel through the
  port rather than writing the table directly.
- **Live-writer exclusivity.** A bound signal's `source='live'` rows belong to its data source's
  sync, exclusively. The increment machinery (`deriveSignalIncrements`) is also a live writer and
  deletes every live row before rebuilding from events, so `signals/points.ts` refuses it on bound
  signals and `sources/sync.ts` is the other half of that pact. Do not add a third live writer.
- **`source` is part of the `signal_points` PK** so a live write can never destroy a manual point.
  Reads deduplicate per bucket with live-over-manual precedence, which means a shadowed manual
  point resurfaces if the live source retreats. That is intended, not a bug.
- **A `derived` signal cannot be renamed.** `signal-rename` refuses it: the deriver generates the
  id, so the next pull would re-create the old one.
- **Deleting a data source does not unbind its signals.** They are reported, keep their points and
  stop refreshing. A visible dead binding beats a silently narrowed signal.
- **`data_sources.id` is three keys at once** - the row key, the credentials account key, and the
  audit `snapshots.channel`. Hence the strict slug charset and the refusal of ids that collide with
  a derived channel. Do not "just rename" a source id.
- **`boardsUpsert` deliberately does not accept `nodes`.** Use `boardsNodesSet` for membership and
  positions, so a label edit can never race the position autosave onto the same column.
- **Import `CircuitBoardFlowLazy`, never `CircuitBoardFlow`** - the React Flow chunk is lazy on
  purpose and the boards index does not need it.
- **`index.tsx` sits on the web feature-registry import cycle.** Never read a registry binding at
  module scope there, and load the app in a browser after touching it - `box verify` has no
  runtime step (`AGENTS.md`).
- **After a controller change, boot once (or `bun run typegen`)** so `appRouter.d.ts` is rewritten, or
  the web typecheck is stale. `data` owns 43 procedures, so this bites here more than anywhere.
- **Ports are 8190 (Nest) / 5190 (Vite).** A second Box gets its own `server.port` / `server.vitePort`,
  never a neighbour of these: two Boxes running the same code are indistinguishable from the
  outside, so a near-miss is mistaken for the real one instead of being rejected
  (`AGENTS.md`, `apps/server/src/agent/loopback-guard.ts`).
- **`export LC_ALL=en_US.UTF-8` before any repo-wide grep.** Several files in this feature contain
  non-ASCII bytes (`★` in the GitHub deriver, `→` and `·` in comments and labels), and macOS grep
  skips such files silently.
