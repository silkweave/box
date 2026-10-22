---
name: upgrade
description: Advance a consumer Box's source-linked core from one recorded Stack revision to another without losing local work.
---

# Upgrade core

Read `docs/UPSTREAM.md`, `docs/INTEGRATION.md`, and `docs/GOTCHAS.md` before comparing source.
Record the old and target Stack SHAs and intended scope before changing files. A SHA identifies a
committed upstream state; record consumer uncommitted changes separately and preserve them as the
local side of the three-way comparison.

Compare old reference, local Box, and target reference. Keep local dependency choices, core edits,
and UI customizations unless the owner explicitly changes them. Integrate source-linked core and
update maintained registration and exports with the rest of the change. The root workspace package
owns shared feature dependencies; do not create feature dependency manifests or a package fetch
protocol.

The mobile framework `packages/mobile` is core. In `apps/mobile`, core owns `lib/main.dart`,
`lib/main_dev.dart`, `scripts/` and `tool/`; the Box owns `lib/app_config.dart`,
`lib/generated/modules.dart`, the feature-module block and version of `pubspec.yaml`, and the
native identity, signing and capabilities in `ios/` and `android/`. Merge those three-way like any
customized file; never replace the native projects wholesale. Run `bun run test:mobile` after.

`recipes/` is a managed core path: it carries the documentation and screenshots of every recipe offered to the Box and is
refreshed with core. Replace it with the target revision's `recipes/` rather than merging it, and
keep Box-specific findings in `docs/GOTCHAS.md`, not under `recipes/`. An upgrade does not adapt
recipe changes into the Box's `features/`: when the target's `recipes/<id>/` or `features/<id>/`
changed for a recipe this Box has adapted, record that and update it separately with `$adapt`,
updating exactly the recipes and powerups recorded in the `recipes` ledger of `box.json`,
reading the implementation from `box stack fetch --ref <target SHA>`. Keep `stack.source` in
`box.json` and any `box.local.json` override as the owner configured them.

Use the latest available dependencies. Record any necessary pin and its reason in
`docs/GOTCHAS.md`. Write resume state to `docs/INTEGRATION.md` before each migration or source
mutation and reconcile actual files and ledgers after an interruption.

Inspect migration identities and bodies before touching data. Preserve shipped migrations
byte-for-byte. Back up first, apply pending migrations before unrelated source changes, confirm boot,
and record the backup and ledger state. If a run stops, inspect the actual database ledger and schema
before resuming; an operation can finish before an external progress note is written. Confirm the
minimum migration runner, registration, imports, and dependencies are present before applying one.

Run focused checks and then the complete Box validation chain. Update `docs/UPSTREAM.md` with the
completed core SHA only after the full chain and boot check pass. Put incomplete work, rollback, and
decisions in `docs/INTEGRATION.md`; retain the prior completed SHA until then.


The warehouse ledger keys by `<feature>:<migration name>` and checks a digest. Chat's private
ledger keys by migration object name and has no checksum. Never renumber an applied identity to
resolve a collision; reconcile that history before continuing. Test migration and application
compatibility against a restored backup, with a rollback path for both code and affected stores.

If a previous upstream SHA is missing, recover it from adoption records or historical tags where
possible; otherwise record an unknown baseline and inspect local differences explicitly. Do not
invent ancestry or infer that a local difference is safe to overwrite. If the target source has
uncommitted changes, identify that working snapshot separately; no commit SHA contains those edits.
