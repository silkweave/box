# Adapt the Data Sync recipe

This is the adaptation guide for the Data Sync recipe. Read [RECIPE.md](./RECIPE.md),
[SPEC.md](./SPEC.md), the recipe [GOTCHAS.md](./GOTCHAS.md), the Box's docs/UPSTREAM.md, and its
current _docs/INTEGRATION.md before changing files. These recipe documents ship with core, so a Box
has them at `recipes/data-sync/`. The reference implementation does not: it lives in the Stack at
`features/data-sync/`. In a Box, run `box stack fetch --ref <recorded Stack SHA>` and read
`<fetched stack>/features/data-sync/`, so the documents and the code come from the same Stack
revision.

The base recipe is npm, blog and Hacker News. Ask the owner which powerups to add now (`github`, `x`,
`reddit`, `linkedin`, `substack`, `stripe`, see `powerups/`); each can be added later with its own
INSTALL.md.

## Prerequisites

- Existing Box backup and a recorded restore path for both data and matching application source.
- Core, plus every recipe this one builds on already adapted and registered in the target Box. Builds on: **none, core only**.
- Feature-specific package imports include: `@nestjs/common`, `@nestjs/swagger`, `class-validator`
  and `@silkweave/nestjs` (server). The `x` powerup adds `twitter-api-v2`; the `reddit` and
  `substack` powerups add `playwright-core`. Install latest into the root workspace package; record
  any necessary compatibility pin and its reason in the Box gotchas. Also declare shared
  framework/UI packages imported directly by this feature: dependencies declared only under
  apps/server or apps/web do not resolve from the shared feature tree.
- A recorded source SHA in docs/UPSTREAM.md, and an integration entry with scope, target SHA,
  intended changes, and state in _docs/INTEGRATION.md.
- A disposable instance for build, typecheck, tests, schema checks, and boot verification.

## Owner decisions

1. **Powerups to add now**, if any.
2. **npm packages** the team publishes (`packages` summed as one line, `tracked` standalone), or none.
3. **Blog feed URL**, or none; whether to add GA4 now (a service-account key and property id the
   owner provides).
4. **Hacker News** login and the terms that count as a brand mention, or leave the platform out.

## Integration

Before copying unrelated feature code, inspect migrations and complete their staged backup,
application and boot-compatibility check below. Stage only the runner, registration, imports and
dependencies needed to run them. On resume, compare the running record with actual files and
ledgers before replaying an operation.

1. Copy/adapt from `<fetched stack>/features/data-sync/` into the Box's `features/data-sync/`: all
   of `core/` except the powerup folders, and all of `server/` except
   `reddit-diagnostics.controller.ts`. Copy a powerup's folder only as part of its own INSTALL.md.
   Register the result as the `data-sync` feature in `apps/server/src/generated/features.ts`,
   `packages/core/src/generated/features.ts` and `packages/core/src/generated/exports.ts`. Do not
   create a feature package, a symlink, or a release catalogue entry.
2. Trim to what is installed: `core/platforms.ts` imports and lists only the platforms copied,
   `server/ingest/ingest.controller.ts` keeps only the methods whose actions exist, and
   `server/index.ts` lists `RedditDiagnosticsController` only with the reddit powerup.
3. Declare imported third-party packages in root workspace manifests when the consolidated layout
   requires it. Resolve imports and production output from source; fix integration errors in the
   target Box as part of the adaptation.
4. Configure the owner's choices in `box.json`: `features.data-sync.npmPackages`, and a `blog` and a
   `hackernews` entry under `accounts` (`docs/examples/accounts.json`). GA4 credentials go in
   `box.local.json` under `credentials.blog.<account>` (`GOOGLE_APPLICATION_CREDENTIALS`,
   `GA4_PROPERTY_ID`), entered by the owner.
5. Preserve local customizations and write durable findings to the Box's docs/GOTCHAS.md. Record
   path mappings and skipped changes; update _docs/INTEGRATION.md as each step completes. Advance
   the completed upstream SHA in docs/UPSTREAM.md only after the full validation and boot pass.
6. No shipped migrations. If a migration is added, keep its feature id and append a new identity.
7. For migrations, stage the runner, registration, and minimum code first. Test against a restored
   backup in isolation, confirm completion and boot compatibility, then continue with unrelated
   changes. Never edit or rename an applied migration.

## Validation

Run the target Box's normal build, typecheck, tests, lint, and schema:check commands, then boot a
disposable instance and exercise this feature's documented surface: run `npm-pull`, `blog-pull` and
`hackernews-pull` for the configured platforms and `warehouse-derive`, and confirm the runs in
Settings > Automation and the signals in the Signals view. Record actual commands and results. Do not
describe a migration, latest-dependency check, or consumer rehearsal as complete until it has
actually run. Then add `data-sync` to the `recipes` ledger in `box.json`.
