---
name: adapt
description: Adapt a Stack recipe into a Silkweave Box - fetch its docs and reference implementation with box recipe fetch, and integrate it into features/<id>/ while preserving local customizations, migration identity, and the Box's recorded decisions.
---

# Adapt a recipe

Use this skill to adapt, update or maintain one recipe in a Box. A recipe is something the Stack
offers; adapting it puts its code into the Box's `features/<id>/` and registers it, after which it
is a feature of this Box. The recipe id and the feature id are the same (the Mobile app recipe,
`recipes/mobile/`, is the exception: its code ships with core and it has no feature to register).

## 1. Fetch the recipe, then read it and the Box's records

Recipes come from the recipe registry (`registry.url` in `box.json`; an access key in
`box.local.json` as `registry.token` adds recipes beyond the open ones). Fetch the one you are
adapting first:

```bash
box recipe list
box recipe fetch <id>                      # latest version
box recipe fetch <id> --version <sha>      # a recorded version (updates, powerups)
```

It verifies the download against the registry's sha256 and unpacks it once into
`.recipes/<id>/<version>/`, which is never modified afterwards; it prints the path, version and
sha256. Inside are `recipes/<id>/` (the docs) and `features/<id>/` (the implementation). Never
edit the cache. If the command says the registry has no such recipe, the Box may need an access
key: the owner sets it with `box registry key` (hidden input); never ask them to paste it into the
conversation.

Most recipe documents also ship with core in `recipes/<id>/`. When this Box has no
`recipes/<id>/`, copy the fetched `recipes/<id>/` into the Box as part of the adaptation, so the
docs stay with the adapted feature. Read `RECIPE.md`, `SPEC.md`, `INSTALL.md`, `AGENT.md` and
`GOTCHAS.md` from the version you fetched. The recipes listed under `## Builds on` in
`RECIPE.md` must already be adapted; adapt them first, one at a time. Then read `docs/UPSTREAM.md`,
`docs/INTEGRATION.md` (the rules), the record in `_docs/INTEGRATION.md` if one exists, and
`docs/GOTCHAS.md` in the Box before editing. Those records define
ancestry, incomplete work, local decisions, and known collisions.

## 2. Read the reference implementation

The implementation is `<fetched path>/features/<id>/` (`box recipe fetch <id> --quiet` prints only
the path). For an update, fetch both the version recorded for the recipe in the `recipes` ledger
of `box.json` (or in `docs/UPSTREAM.md` for a Box that predates the ledger's `version`) and the
target version, and compare old, local and new. Record the version you actually read; never guess
a SHA.

A maintainer whose Box can read the Stack repository directly (`stack.source`) may use
`box stack where` and `box stack fetch --ref <sha>` instead; the registry version is the same Stack
SHA.

## 3. Ask about powerups, then record the plan

A recipe's optional capabilities are powerups, one folder each under `recipes/<id>/powerups/`
(`POWERUP.md`, `INSTALL.md`); the mobile module is the `mobile` powerup. Before editing, ask the
owner which to add now: summarise each `POWERUP.md` and its `## Needs` (push, for example, needs
Firebase; public artifacts need Cloudflare). Do not decide for them; each can be added later. When
updating, update the powerups recorded for the recipe in the `recipes` ledger of `box.json`, and
run each one's `## Detect` to confirm the Box (and to backfill a ledger that predates it). Record
the answers with the plan.


Write the intended scope, source commits, current local state, and planned backup to
`_docs/INTEGRATION.md` (gitignored; create `_docs/` if needed) before editing. Update that record as each meaningful step completes so an
interrupted run can resume from actual files and database ledgers. Do not copy recipe documents
into the feature tree; they live in `recipes/<id>/` (refreshed with core when core ships them).

## 4. Integrate

Compare the old reference, the Box's local version, and the new reference as three inputs. Preserve
local customizations deliberately, especially UI files and core seams. Apply the new behavior around
those customizations and record any unresolved choice in the integration record. Do not replace a
consumer file wholesale when it contains local intent.

Copy and adapt the implementation's `core`, `server`, `web` and, when present, `skills` source into
the Box's `features/<id>/`, adapt imports and runtime wiring, add packages required by its imports
to the workspace package, and update maintained registration in `src/generated/features.ts` and
exports in `packages/core/src/generated/exports.ts`.

After the base recipe validates, add each chosen powerup by following its `INSTALL.md` in order:
`## Detect`, `## Requires`, `## Owner decisions`, `## Owner-only steps` (ask for them when they are
needed and wait), `## Steps`, `## Verify`. Generate shared secrets yourself, keep them in
`box.local.json`, and never print them. Record each powerup and its source revision in
`docs/UPSTREAM.md`.

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
work in `_docs/INTEGRATION.md`, and path decisions in `docs/UPSTREAM.md`. Do not record a completed source SHA until the
full validation chain and boot check pass. Then record the outcome in the `recipes` ledger of
`box.json`: add the recipe once the chain passes, with the `version` and `sha256` that
`box recipe fetch` printed (`"<id>": { "powerups": [], "version": "<sha>", "sha256": "<digest>" }`),
and append each powerup id to `recipes.<recipe>.powerups` once its `## Verify` steps and the chain
pass. Keep the ledger in
`box.json`, not `box.local.json`; it is a record, not an install mechanism.

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
