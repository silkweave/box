# Adapting the `data` recipe

The recipe guide. Read [`SPEC.md`](./SPEC.md) first for what the recipe's feature is; this is how it gets into a
Box and what to change afterwards.

## 1. Integrate

The recipe documents ship with core at `recipes/data/`; the reference implementation lives in the Stack at `features/data/`. Read [SPEC.md](./SPEC.md), [INSTALL.md](./INSTALL.md), and [GOTCHAS.md](./GOTCHAS.md) before changing a Box, and fetch the implementation with `box stack fetch --ref <recorded Stack SHA>`.

**Builds on:** core only. Resolve imports from the Box's source tree and root workspace dependencies.

Copy or adapt `<fetched stack>/features/data/` into the Box's `features/data/{core,server,web}` and preserve its runtime contracts, registrations, dependency order, and package manifests. Adapt imports to the consolidated layout. Record the source SHA, path mapping, and skipped upstream changes in the Box's `docs/UPSTREAM.md`; write the active scope and state to `_docs/INTEGRATION.md`.

No shipped migrations currently. A future schema change must be a new migration. Back up data before applying any migration, stage its runner and registration first, and verify migration completion and boot compatibility on a disposable restored instance before continuing.

## 2. Customise for the team

1. **Channels.** `features/data/core/signals/derive.ts` - `DERIVED_CHANNELS` is
   `github, reddit, x, linkedin, npm, blog, hackernews, substack`, each with a deriver in
   `DERIVERS`. Delete the channels this team does not have: the deriver, its file under `pulls/`,
   its `ActionSpec`(s) in `actions.ts`, and its `IngestController` method in
   `features/data/server/ingest/ingest.controller.ts` if it has one. Then mirror the list
   in `apps/web/src/types.ts` (`Channel` + `CHANNEL_LABEL`) - that file is app-level and hand-kept,
   and it additionally carries `content` and `business` (`MANUAL_SIGNAL_CHANNEL`). Nothing checks
   the two lists against each other: a channel missing from the union falls back to its raw id in
   the sidebar, so drift is silent.
2. **The manual channel.** `signals/types.ts` - `MANUAL_SIGNAL_CHANNEL` is `'business'`, the
   channel every source-less signal lands on. Rename it to whatever the team calls its hand-kept
   numbers, and add the matching `CHANNEL_LABEL` entry.
3. **Credentials, not env.** `box.local.json credentials` (gitignored) under
   `<provider-or-channel> → <account> → KEY`. GitHub wants `GH_TOKEN` per account; LinkedIn wants
   `LINKEDIN_CLIENT_ID` / `_SECRET` / `_ACCESS_TOKEN` / `_PERSON_URN` / `_REFRESH_TOKEN`; the blog
   pull wants `GOOGLE_APPLICATION_CREDENTIALS` + `GA4_PROPERTY_ID`; Substack wants its session
   keys. A pull with no credential fails loud, on purpose.
4. **Accounts.** `box.json accounts` drives the account-scoped `github@<id>` channels (one
   deriver, namespaced signal ids) and supplies the account binding that resolves signal ownership.
5. **npm packages.** `box.json features.data.npmPackages` (`packages` = the line that sums into
   `npm.week`/`npm.month`; `tracked` = standalone packages that always get their own signal).
   The shape is `{ "packages": [...], "tracked": [...] }`. EMPTY BY DEFAULT and never seeded - the npm pull
   needs no credential, so a default list would import somebody else's downloads on day one. No
   packages configured means the pull logs that and does nothing.
6. **Signal ownership.** `box.json features.data.signalOwners`, editable from Settings → Signal owners.
   Channel defaults plus per-signal overrides; an explicit `null` marks a signal deliberately
   unowned. It applies at read time, so no re-derive and no restart.
7. **Providers and data sources.** A provider is code: a `@silkweave/box-provider-<id>` workspace
   package depending only on `@silkweave/box-provider-kit`, plus one line in
   `features/data/core/sources/registry.ts`. Never let a provider import
   `@silkweave/box-core` - that is the cycle the packaging exists to prevent. A DATA SOURCE is a
   row the team creates in Settings → Data sources; it is born `disabled` on purpose.
7. **Presets.** `presets/presets.ts` - `PRESET_MODULES` is the closed list `content`, `crm`,
   `initiatives`, which names boards owned by `content`, `crm` and `planning`. Drop the entries for
   features this Box does not install. The default preset lists live in the SPA
   (`features/*/web/...`, sent through `presetsSeed`) and the icon vocabulary is
   `features/data/web/components/board/presetIcons.tsx`.
8. **Nav and settings order.** `features/data/web/index.tsx` - band 100/110 for the two
   nav entries, 110/120 for the two settings sections. Band 100-199 is data's.
9. **Browser and GitHub settings.** The CDP client reads `features.data.chromatrixUrl`,
   `features.data.chromatrixIdentity` and `features.data.chromatrixToken`; the GitHub pull reads
   `GH_TOKEN` per account from `box.local.json credentials`. The feature reads no environment
   variables.

Enum edits in `signals/types.ts` and `sources/types.ts` need no migration until a Box has shipped
with the old set; after that, a migration in `migrations.ts` rewrites the rows (`docs/core/SEAM.md`
§ 3). `SIGNAL_SOURCES` and `SIGNAL_POINT_SOURCES` are structural - leave them alone.

## 3. Prove it

```bash
box dev
```

- `http://localhost:8190/signals` - the channel sidebar renders one entry per base channel with a
  signal count, and the grid shows cards. An empty Box shows an empty grid, which is fine: the
  registry is allowed to be empty and a definition may exist with no points at all.
- `http://localhost:8190/boards` - the boards index. Create one, open it, add a node from "Add
  nodes" (signals; with planning also goals and initiatives), click it and use "Add connected";
  drag it and the position autosaves (~2s debounce) into `signal_boards.nodes`, so a reload puts it
  back where you left it. Positions are TEAM state, never localStorage.
- `http://localhost:8190/settings` → **Signal owners** and **Data sources**. Creating a source
  writes a `disabled` row; its credential presence booleans show whether
  `box.local.json credentials` has the keys its provider declares.

Agent-side:

```bash
bun run cli signals-list                  # the registry
bun run cli signal-upsert                 # create a manual signal
bun run cli signal-point-set              # hand-enter one point
bun run cli signal-series                 # read that signal's numbers back
bun run cli providers-list                # the provider catalogue
bun run cli data-sources                  # the sources and their health
bun run cli boards-list
bun run cli board-get                     # one board resolved: cards, edges, neighbours
bun run cli presets
```

The round trip worth running once is `signal-upsert` → `signal-point-set` → `signal-series`: it
proves the registry, the point store, the bucket flooring and the merged read all agree. Use
`signal-series` and not `signal-points` for that - `signal-points` is the manual-point editor
backend and correctly returns `[]` for a purely-live signal.

A pull needs real credentials, so the honest smoke test for ingestion is `bun run cli
warehouse-derive` (or the `github` pull, once `GH_TOKEN` is in `box.local.json credentials`), then checking
that the run landed in the Automation run history. Tool names normalize: the CLI proxy accepts
`warehouse-derive` for the tool the MCP listing calls `WarehouseDerive`.

## 4. Adapt or remove

To update this feature, compare the target Box with the recorded upstream SHA, preserve local customizations, and apply the relevant source changes manually. Record the result in `docs/UPSTREAM.md` and `_docs/INTEGRATION.md`, including unresolved work and rollback details.

To remove it, delete the feature's `core`, `server`, and `web` source directories only after checking runtime imports and dependent features. Preserve team data and configuration unless the team explicitly chooses to remove them. Run the target Box's normal build, typecheck, tests, lint, schema check, and a disposable boot afterward.

## Gotchas

See [GOTCHAS.md](./GOTCHAS.md) for feature-specific operational details, recovery notes, and durable local findings.
