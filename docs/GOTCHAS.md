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
- A passing build against the current lockfile does not prove current latest dependencies. Record
  the tested revision, date, and freshness date in `docs/VALIDATION.md`.
- Migrations are transcribed byte-for-byte, backed up before application, and run before unrelated
  feature changes. Chat's ledger has no checksum, while the warehouse ledger does.

## Runtime integration

Vitest must resolve every core import to the
same source module or its instance override splits into two states; server tests must apply the
SWC decorator transform to feature files outside the server package. Both are implemented in the
package test configs. Add decisions,
import collisions, required pins and local exceptions here after further integrations. This file is not the operation log; use
`docs/INTEGRATION.md` for an active or most recent run.


## Latest dependency peer ranges, 2026-09-19

The full chain and disabled-agent production/browser checks pass with latest direct dependencies,
but `bun run peers check` reports upstream range mismatches. `@silkweave/nestjs@5.2.1` declares Nest
common/core 10 or 11 and Swagger 7, 8 or 11; this workspace now uses Nest 12.0.3 and Swagger 12.0.1.
`@workerdeck/core@2.7.2` declares Codex `~0.149.0`, while latest is 0.155.0. No older version was
pinned just to silence those declarations. The tested application paths work; an armed worker and
Codex engine were not exercised. Check those integrations before enabling them, and record a pin
with the demonstrated incompatibility if one is required. Do not suppress peer warnings globally.
