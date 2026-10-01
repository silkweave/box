# Recipes

A recipe is something the Stack offers and a Box can adapt: a team-facing capability such as
Planning, CRM or Chat. Each recipe has two halves that live in different places.

- **Recipe documents** at `recipes/<id>/`: `RECIPE.md` (the catalog entry), `SPEC.md` (the runtime
  contract and behavior), `INSTALL.md` (the adaptation procedure), `AGENT.md` (the adaptation and
  customisation guide), `GOTCHAS.md` (recipe-specific hazards) and `screenshots/`. `recipes/` is a
  managed core path, so every Box carries the documents for every recipe, adapted or not.
- **Reference implementation** at `features/<id>/{core,server,web}` in the Stack, plus
  `features/<id>/skills/` when the recipe ships agent skills and `features/<id>/mobile/` when it
  has a module for the mobile app ([MOBILE.md](MOBILE.md)). The implementation stays in the Stack;
  a core-only Box does not contain it.

Adapting a recipe puts its code into the Box's `features/<id>/` and registers it there. From that
point it is a feature of that Box: runtime registration (`WEB_FEATURE_LIST`,
`src/generated/features.ts`, `packages/core/src/generated/exports.ts`), the `features.<id>` settings
in `box.json`, warehouse migration keys `<feature>:<name>` and the feature manifests all keep the
word "feature". The recipe id and the feature id are the same string.

See [`recipes/README.md`](../recipes/README.md) for the folder layout and the `RECIPE.md` format.

## What a recipe is not

A recipe describes its domain code, server controllers, web routes, imported packages, migrations,
setup decisions and gotchas. Its imports plus prose are its dependency description, and `RECIPE.md`
is descriptive prose, not a manifest. There is no `box adopt`, one-click install, `app.json`,
`deps.json`, feature package manifest, registry catalogue, release tag, or mount and compose
workflow. The root workspace package owns packages imported by the shared feature tree.

The Stack carries every maintained recipe: reminders, sink, data, planning, content, CRM, chat,
automation, alerts, notifications and engagement. Artifacts is a web-only placeholder with no
`RECIPE.md`; its note in `recipes/artifacts/` explains why. A consumer Box starts with core and
adapts only the recipes its team chooses.

[Builder](BUILDER.md) is a core administrator workspace, not a recipe.

## The Stack source

A Box names the Stack it adapts from with `stack.source` in `box.json`. The default is
`silkweave/stack` (GitHub shorthand). A git URL or a filesystem path, such as `..` for a Box nested
inside a Stack checkout, also works, and `box.local.json` can override it for one machine. See
[CONFIGURATION.md](CONFIGURATION.md).

- `box stack where` prints the configured source, its kind and location, and for a local path its
  `HEAD` and whether `recipes/` and `features/` exist.
- `box stack fetch [--ref <rev>] [--quiet]` returns a readable Stack. A local path is validated and
  printed and never modified; if `--ref` differs from its `HEAD` the command warns. A git source is
  cloned into the gitignored `<box>/.stack/` cache, fetched, and checked out detached at the ref,
  defaulting to `origin/HEAD`, the remote's default branch. It prints the path and the resolved commit; `--quiet`
  prints only the path.

See [CLI.md](CLI.md). The Stack repository is private today and will become public; a git source
needs access until then.

## Adapting a recipe

The agent reads `recipes/<id>/` locally, then runs `box stack fetch --ref <sha>` and reads
`<fetched stack>/features/<id>/`. Use the Stack revision recorded in the Box's `docs/UPSTREAM.md`
so the documents and code match; when adapting from a newer revision, record that revision instead.
The agent reads `docs/GOTCHAS.md` and the Box's local gotchas, then copies and adapts the relevant
core, server, web and skill code into `features/<id>/`, adds required packages, updates
`src/generated/features.ts` and `packages/core/src/generated/exports.ts`, and runs build, typecheck,
lint, tests and `schema:check`. Build and type errors during adaptation are part of the work.
Adapt the recipes listed under `## Builds on` first.

A recipe whose `RECIPE.md` has a `## Mobile` section also has a mobile module. Before adapting,
ask the owner whether to include it in the Box's mobile app; the recipe's INSTALL.md has the steps
("Mobile module (optional)") and [MOBILE.md](MOBILE.md) explains the app. Leaving it out changes
nothing else about the recipe, and it can be added later the same way.

In a live Builder session, the agent then runs `box app restart` to activate server and
registration changes without stopping the stable supervisor, and validates the refreshed Preview.
Record durable local findings in the Box's `docs/GOTCHAS.md`.

Migrations are the carve-out. Preserve existing names and bodies byte-for-byte. Back up before
applying, stage the minimum runner and registration, apply migrations before unrelated changes, and
confirm boot. New behaviour requires a new migration. The warehouse ledger checks its digest;
chat's current ledger does not.

## The onboarding recipe catalog

The dashboard home shows every recipe found in `recipes/*/RECIPE.md`, with search and a detail
dialog that carries the summary, highlights, what the recipe builds on, and its screenshots. A
recipe whose id is registered as a feature in the running Box is marked as adapted, and its button
reads "Update recipe" with a brief that compares the recorded revision, the Box and the Stack.

"Adapt recipe" opens Builder with a prefilled brief in the composer. The brief is only a draft: the
owner reviews and edits it, then sends it. It is never sent automatically, and choosing a recipe
changes nothing until the Builder agent does the adaptation described above. See
[BUILDER.md](BUILDER.md) and [WEB.md](WEB.md).

## Updating and resuming

Use `$adapt` for one recipe, `$upgrade` for core, and `$verify` for the whole Box. Compare the
recorded previous upstream commit, local code and target upstream commit. Keep full commit SHAs and
path mappings in `docs/UPSTREAM.md`; a date or release label alone does not identify the ancestor.
Write the intended steps and completed results as work proceeds in `_docs/INTEGRATION.md`. On resume,
inspect actual files and migration ledgers before replaying a step. Advance completed SHAs only
after verification, and record deliberately skipped upstream changes.

When a consumer lacks a recorded source SHA, recover the closest ancestor from its repository
history before adapting. Never bulk-replace customized files or rename shipped migrations.
