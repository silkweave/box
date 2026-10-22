# Adapt the planning recipe

This is the adaptation guide for the planning recipe. Read [RECIPE.md](./RECIPE.md), [SPEC.md](./SPEC.md),
the recipe [GOTCHAS.md](./GOTCHAS.md), the Box's docs/UPSTREAM.md, and its current
_docs/INTEGRATION.md before changing files. These recipe documents ship with core, so a Box has them
at `recipes/planning/`. The reference implementation does not: it is fetched from the recipe registry as `features/planning/`. In a Box, run `box recipe fetch planning` and read `<fetched recipe>/features/planning/` (`<fetched recipe>` is the path it prints),
so the documents and the code come from the same version.

## Prerequisites

- Existing Box backup and a recorded restore path for both data and matching application source.
- Core. This recipe builds on no other recipe.
- Feature-specific package imports include: `@base-ui/react`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `prismjs`, `react-simple-code-editor`, and `@types/prismjs` (web). Install latest into the root workspace package; record any necessary compatibility pin and its reason in the Box gotchas. Also declare shared framework/UI packages imported directly by this feature: dependencies declared only under apps/server or apps/web do not resolve from the shared feature tree.
- The source version to fetch (for an update, the one in the `recipes` ledger of `box.json`), and an integration entry with scope, target version,
  intended changes, and state in _docs/INTEGRATION.md.
- A disposable instance for build, typecheck, tests, schema checks, and boot verification.

## Integration

Before copying unrelated feature code, inspect migrations and complete their staged backup,
application and boot-compatibility check below. Stage only the runner, registration, imports and
dependencies needed to run them. On resume, compare the running record with actual files and
ledgers before replaying an operation.

1. Copy/adapt the reference implementation from `<fetched recipe>/features/planning/` into the Box's
   features/planning/{core,server,web}. Keep existing runtime
   contracts, registrations, dependency order, and package manifests. Register the result as the
   `planning` feature. Do not create a feature package, a symlink, or a release catalogue entry.
2. Declare imported third-party packages in root workspace manifests when the consolidated layout
   requires it. Resolve imports and production output from source; fix integration errors in the
   target Box as part of the adaptation.
3. Preserve local customizations and write durable findings to the Box's docs/GOTCHAS.md. Record
   path mappings and skipped changes; update _docs/INTEGRATION.md as each step completes. Record the fetched version and sha256 in the `recipes` ledger of `box.json` only after the full validation and boot pass.
4. Preserve the existing '001-sprint-tasks' identity and body exactly. New schema behavior gets a new migration.
5. For migrations, stage the runner, registration, and minimum code first. Test against a restored
   backup in isolation, confirm completion and boot compatibility, then continue with unrelated
   changes. Never edit or rename an applied migration.

## Validation

Run the target Box's normal build, typecheck, tests, lint, and schema:check commands, then boot a
disposable instance and exercise this feature's documented surface. Record actual commands and
results. Do not describe a migration, latest-dependency check, or consumer rehearsal as complete
until it has actually run.
