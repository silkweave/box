# Gotchas

This is the project-wide warning record. Feature-specific warnings belong beside the feature. A
consumer Box consolidates its durable local findings here.

## Layout and runtime

- The layout is `features/<id>/{core,server,web}`. Node package resolution follows the file's
  location, so dependencies imported by this shared tree belong in the root workspace package.
  TypeScript paths alone do not repair runtime package resolution.
- `src/generated/features.ts` and `packages/core/src/generated/exports.ts` are maintained and
  tracked. Update them with the source change; do not treat them as disposable install output.
- A scratch Box under `box/` has its own workspace and install. If code works in the stack but
  fails in a consumer Box, inspect whether it resolved a package from an ancestor `node_modules`.
- A passing build against the current lockfile does not prove dependency freshness. When changing
  dependencies, check their peer ranges and record the tested revision and date in `_docs/VALIDATION.md`.
- Migrations are transcribed byte-for-byte, backed up before application, and run before unrelated
  feature changes. Chat's ledger has no checksum, while the warehouse ledger does.

## Runtime integration

Vitest must resolve every core import to the
same source module or its instance override splits into two states; server tests must apply the
 SWC decorator transform to feature files outside the server package. Both are implemented in the
 package test configs. Add decisions, import collisions, required pins and local exceptions here
 after further integrations. This file is not the operation log; keep current-run details and
 rollback information in `_docs/INTEGRATION.md`.
