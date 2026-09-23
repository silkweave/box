---
name: adapt
description: Integrate a reference feature into a Silkweave Box while preserving local customizations, migration identity, and the Box's recorded decisions.
---

# Adapt a feature

Use this skill to install, update or maintain one feature in a Box from Silkweave Stack. Read the feature's source and
documentation first, then read `docs/UPSTREAM.md`, `docs/INTEGRATION.md`, and `docs/GOTCHAS.md` in
the Box before editing. Those records define ancestry, incomplete work, local decisions, and known
collisions.

Write the intended scope, source commits, current local state, and planned backup to
`docs/INTEGRATION.md` before editing. Update that record as each meaningful step completes so an
interrupted run can resume from actual files and database ledgers. Read the consumer's local docs;
copy only feature runtime documentation needed by the Box, not Stack-only installer instructions.

Compare the old reference, the Box's local version, and the new reference as three inputs. Preserve
local customizations deliberately, especially UI files and core seams. Apply the new behavior around
those customizations and record any unresolved choice in the integration record. Do not replace a
consumer file wholesale when it contains local intent.

Integrate the feature's `core`, `server`, and `web` source, adapt imports and runtime wiring, add
packages required by its imports to the workspace package, and update maintained registration in
`src/generated/features.ts` and exports in `packages/core/src/generated/exports.ts`.

Use the latest available dependency versions. If a package must remain pinned, record the exact pin
and its reason in `docs/GOTCHAS.md`.

Treat migrations separately. Preserve shipped names and bodies byte-for-byte. Take and record a
backup before applying them, stage the runner and registration first, apply migrations before
unrelated feature changes, and confirm the Box boots. Ensure the minimum migration runner,
registration, imports, and dependencies are present before running a migration. A digest refusal
against live data requires restoration or historical reconciliation. New behavior gets a new migration.

Run focused build, typecheck, lint, tests, and schema checks before handing off. Record source SHAs,
paths, preserved customizations, migration identities, backup location, validation, and remaining
work in `docs/INTEGRATION.md` and `docs/UPSTREAM.md`. Do not record a completed source SHA until the
full validation chain and boot check pass.

When working inside Builder, `box dev` is the stable supervisor that owns the current agent
session. Never stop, kill, replace, or relaunch it, and never start a second Box against the same
instance. After the validation chain passes, run `box app restart` for backend, registration,
configuration, or migration changes, then inspect the refreshed Preview. That command restarts only
the editable application and waits for health while preserving the supervisor and Builder session.
Use `box app status` to inspect the child. If application control cannot reach the supervisor, stop
and ask the host operator to restore it.


The warehouse ledger keys by `<feature>:<migration name>` and checks a digest. Chat's private
ledger keys by migration object name and has no checksum. Never renumber an applied identity to
resolve a collision; reconcile that history before continuing. Test migration and application
compatibility against a restored backup, with a rollback path for both code and affected stores.

If a previous upstream SHA is missing, recover it from adoption records or historical tags where
possible; otherwise record an unknown baseline and inspect local differences explicitly. Do not
invent ancestry or infer that a local difference is safe to overwrite. If the target source has
uncommitted changes, identify that working snapshot separately; no commit SHA contains those edits.
