---
name: adapt
description: Adapt a Stack recipe into a Silkweave Box - read its recipe docs, fetch the reference implementation with box stack fetch, and integrate it into features/<id>/ while preserving local customizations, migration identity, and the Box's recorded decisions.
---

# Adapt a recipe

Use this skill to adapt, update or maintain one recipe in a Box. A recipe is something the Stack
offers; adapting it puts its code into the Box's `features/<id>/` and registers it, after which it
is a feature of this Box. The recipe id and the feature id are the same.

## 1. Read the recipe and the Box's records

The recipe documents ship with core, so read them locally in `recipes/<id>/`: `RECIPE.md`,
`SPEC.md`, `INSTALL.md`, `AGENT.md` and `GOTCHAS.md`. The recipes listed under `## Builds on` in
`RECIPE.md` must already be adapted; adapt them first, one at a time. Then read `docs/UPSTREAM.md`,
`docs/INTEGRATION.md`, and `docs/GOTCHAS.md` in the Box before editing. Those records define
ancestry, incomplete work, local decisions, and known collisions.

## 2. Fetch the reference implementation

The implementation is not in the Box. Fetch it from the Stack named by `stack.source`:

```bash
box stack where
box stack fetch --ref <recorded Stack SHA>
```

Use the Stack revision recorded in `docs/UPSTREAM.md` so the code matches the recipe documents in
`recipes/`. When the adaptation deliberately targets a newer revision, fetch that one and record it
as the target. `box stack fetch` prints the Stack path; read `<fetched stack>/features/<id>/`. A
local path source is never modified and only warns when its `HEAD` differs from `--ref`; in that
case, either check out the wanted revision there yourself with the owner's agreement, or record
the revision you actually read. Never guess a SHA.

## 3. Ask about the mobile module, then record the plan

If `RECIPE.md` has a `## Mobile` section, the recipe also has a module for the Box's mobile app at
`features/<id>/mobile/`. Ask the owner, before editing, whether to include it: summarise what the
section lists and mention any native setup its README requires (push, for example, needs Firebase).
Do not decide for them. Record the answer with the plan.


Write the intended scope, source commits, current local state, and planned backup to
`docs/INTEGRATION.md` before editing. Update that record as each meaningful step completes so an
interrupted run can resume from actual files and database ledgers. Do not copy recipe documents
into the feature tree; they already live in `recipes/<id>/` and are refreshed with core.

## 4. Integrate

Compare the old reference, the Box's local version, and the new reference as three inputs. Preserve
local customizations deliberately, especially UI files and core seams. Apply the new behavior around
those customizations and record any unresolved choice in the integration record. Do not replace a
consumer file wholesale when it contains local intent.

Copy and adapt the implementation's `core`, `server`, `web` and, when present, `skills` source into
the Box's `features/<id>/`, adapt imports and runtime wiring, add packages required by its imports
to the workspace package, and update maintained registration in `src/generated/features.ts` and
exports in `packages/core/src/generated/exports.ts`.

When the owner wants the mobile module, copy and adapt `features/<id>/mobile/` too, add its path
dependency to the feature-module block of `apps/mobile/pubspec.yaml`, register it in
`apps/mobile/lib/generated/modules.dart`, and apply its README's native requirements to
`apps/mobile/ios` and `android`. Follow `docs/MOBILE.md` ("Adding a module to the app"). A module
builds on the same recipes as its feature; add their modules first when it imports them.

Use the latest available dependency versions. If a package must remain pinned, record the exact pin
and its reason in `docs/GOTCHAS.md`.

## 5. Migrations

Treat migrations separately. Preserve shipped names and bodies byte-for-byte. Take and record a
backup before applying them, stage the runner and registration first, apply migrations before
unrelated feature changes, and confirm the Box boots. Ensure the minimum migration runner,
registration, imports, and dependencies are present before running a migration. A digest refusal
against live data requires restoration or historical reconciliation. New behavior gets a new migration.

The warehouse ledger keys by `<feature>:<migration name>` and checks a digest. Chat's private
ledger keys by migration object name and has no checksum. Never renumber an applied identity to
resolve a collision; reconcile that history before continuing. Test migration and application
compatibility against a restored backup, with a rollback path for both code and affected stores.

## 6. Validate and record

Run focused build, typecheck, lint, tests, and schema checks before handing off. With a mobile
module, run `bun run test:mobile` and the app against the disposable Box; say plainly when Flutter
is not installed and the mobile check only reported a skip. Record source SHAs,
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

If a previous upstream SHA is missing, recover it from adoption records or historical tags where
possible; otherwise record an unknown baseline and inspect local differences explicitly. Do not
invent ancestry or infer that a local difference is safe to overwrite. If the target source has
uncommitted changes, identify that working snapshot separately; no commit SHA contains those edits.

There is no `box adopt`, one-click install, registry, or dependency manifest. `RECIPE.md` is
descriptive prose; do not create a manifest or script to make an adaptation convenient.
