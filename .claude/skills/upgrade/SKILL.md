---
name: upgrade
description: Upgrade a Box to the latest core and the latest versions of its adapted recipes without losing local work or data. Use when the owner asks to upgrade, update or "get the latest fixes", for a Box installed from silkweave/box as well as one linked to a Stack checkout.
---

# Upgrade a Box

An upgrade moves this Box's core to a newer upstream revision, brings each adapted recipe in the
`recipes` ledger of `box.json` up to its latest registry version, carries the instance data across
any schema or identity change, and proves the result. Local work survives: the owner's commits,
uncommitted changes, customizations and data.

Read `docs/UPSTREAM.md`, `docs/INTEGRATION.md`, `docs/WAREHOUSE.md` (backups, migrations, the
ledger), `docs/GOTCHAS.md` and `_docs/INTEGRATION.md` if it exists before changing anything. When
this skill runs from an older Box, re-read it as it is on the target revision once the target is
fetched (`git show origin/master:.claude/skills/upgrade/SKILL.md`) and follow the newer text.

## 1. Find out what kind of Box this is and where it stands

- **Installed from silkweave/box** (the website installer or a clone): `git remote -v` names
  `silkweave/box`. Upstream is `origin/master`. Its history is linear, one commit per core refresh,
  so `git merge-base HEAD origin/master` is the exact core this Box started from and git's own
  three-way merge compares old core, local Box and new core. `docs/UPSTREAM.md` on each side names
  the Stack revision that core came from.
- **Linked to a Stack checkout**: `docs/UPSTREAM.md` records the Stack SHA core came from. Compare
  that old reference, the local Box and the target Stack revision (`box stack fetch --ref <sha>`)
  file by file; there is no shared git history to merge.

Record, in `_docs/INTEGRATION.md`, before any change: the current `HEAD`, the old and target
upstream revisions, `git status --short` and `git log --oneline <merge-base>..HEAD` (the owner's
own work), the `recipes` ledger, `box recipe list` (it marks each adapted recipe whose registry
version moved), the applied migration ledger (`SELECT name FROM schema_migrations ORDER BY name`),
and how the Box runs (`box app status`). If the owner has uncommitted work, commit it on its own
("Owner work before upgrade") or stash it, and say which.

## 2. Back up and pause

- `box db backup` and `box db list` (the warehouse), plus a copy of `data/docs`, `data/config` and
  any other store the upgrade touches (chat and its uploads included) into a fresh directory
  outside `data/backups` rotation. Record the paths and the restore steps.
- `box maintenance on --status "Upgrading the Box" --task "Back up" --task "Core" --task "Recipes"
  --task "Data" --task "Verify" --task "Restart"` pauses automation, chat and background work and
  shows members a notice. Tick the tasks as you go and end it with `box maintenance off`.
- Create a branch at the current `HEAD` (`git branch pre-upgrade-<YYYY-MM-DD>`) so the old source is
  one checkout away.

## 3. Core

Installed from silkweave/box: `git fetch origin`, then `git merge origin/master`. Resolve every
conflict, then search for markers before committing (`git grep -n '^<<<<<<<\|^>>>>>>>'`); an
unresolved hunk in a file git auto-merged elsewhere breaks the build later in a confusing way.

Linked to a Stack checkout: integrate the target's source-linked core three-way as described above.

For both:

- Keep the owner's dependency choices, core edits and UI customizations unless the owner changes
  them. `recipes/` is a managed core path: take the target's copy, except a `recipes/<id>/` the
  target does not ship that this Box adapted.
- **A local re-implementation of something core now ships** (a Box agent that added a core module,
  column or migration while adapting a recipe that needed a newer core) yields to the official one.
  Take upstream's file, port only behaviour the owner relies on that upstream lacks, and record the
  decision in `docs/GOTCHAS.md`. Its local migrations need the ledger step in section 5.
- The mobile framework `packages/mobile` is core. In `apps/mobile`, core owns `lib/main.dart`,
  `lib/main_dev.dart`, `scripts/` and `tool/`; the Box owns `lib/app_config.dart`,
  `lib/generated/modules.dart`, the feature-module block and version of `pubspec.yaml`, and the
  native identity, signing and capabilities in `ios/` and `android/`. Merge those three-way.
- Keep `stack.source`, `registry` and every owner setting in `box.json` and `box.local.json`.
- `bun install` after the merge; the root lockfile changes with core.

Do not restart the application yet when a recipe or the data still needs work: the new code may
refuse the old ledger until section 5 is done.

## 4. Recipes

For each recipe in the `recipes` ledger whose registry latest differs from the recorded version,
update it with `$adapt`: `box recipe fetch <id>` (latest) and `box recipe fetch <id> --version
<recorded>` (the old reference for the three-way comparison of `features/<id>/`). Keep exactly the
recipes and powerups the ledger records, with two exceptions:

- **Base split into powerups.** When the newer version moved part of what this Box already used
  out of the base and into a powerup (its `INSTALL.md` lists powerups the old version did not
  have), add those powerups in the same upgrade if the Box has data for them or the owner uses the
  pages; otherwise ask. Nothing the team relies on may disappear.
- **Core removed something a recipe now carries.** Adapt that recipe or powerup before the Box boots
  on the target core. Its tables keep their rows when it declares the same table.

Update registration (`apps/{server,web}/src/generated/features.ts`,
`packages/core/src/generated/{features,exports}.ts`, and for mobile modules
`apps/mobile/lib/generated/modules.dart` plus the `pubspec.yaml` block), install the packages the
recipe's `INSTALL.md` names, and record each new version, sha256 and powerup in the ledger only
after validation passes.

## 5. Migrations, the ledger and data

Shipped migrations are append-only: never edit, rename or renumber one this Box applied. The
warehouse ledger keys by `<feature>:<name>` with a digest; chat's private ledger keys by object name
without one. On boot the Box refuses when an applied migration is missing from the installed code
or its digest changed. Find out before booting: take a restore point (`box db backup`), restore it
in a scratch checkout of the upgraded tree (`box db restore <name>`, see docs/WAREHOUSE.md "Working
rules") and boot that; the boot runs the real schema runner against a copy of the data.

- **Pending migrations** apply on boot after an automatic pre-migration restore point. Nothing to do.
- **A recipe squashed or rewrote its migration history** (its manifest ships fewer or renamed
  migrations than the ledger records). The recipe's data usually also needs a one-off transition
  (id changes, moved columns, preset files). Use the transition its maintainer published when the
  owner's request names one: run its dry run, then its apply with a backup. Otherwise write one in
  `_docs/scripts/` that proves the warehouse already has the target baseline shape (build the
  target models into a throwaway database and compare columns), applies the missing data steps, and
  only then deletes that feature's stale ledger rows. Dry run first, backup required to apply,
  idempotent, rehearsed on a copy.
- **A local migration replaced by an official one** (section 3): confirm the official migration
  produces exactly what the local one did (same columns, types and defaults, read from
  `information_schema.columns`), then, with a fresh backup, delete the local ledger row so the
  official one applies (it should be a no-op `IF NOT EXISTS`). If they differ, write a new migration
  in this Box for the difference instead.
- Presets and other files under `data/config` are not migrated by migrations; a transition that
  changes ids or filter shapes must rewrite them too.

Run a transition with the application stopped (a CLI script then starts the database for itself
and stops it on exit), or as a short CLI script while the supervisor runs, which it joins without
taking over the cluster. Never point a second server at this `data/`.

## 6. Verify, restart, record

1. `box verify` (the full chain). Fix failures in this Box; do not skip a check.
2. `box app restart`. Then `box app status`, and load the pages of every upgraded recipe and Settings
   in the Builder Preview (`box builder browser --session <id> navigate|snapshot|screenshot`) or a
   browser: typechecking cannot catch every runtime registration problem. Check that the owner's
   data is there (counts before and after).
3. `box builder refresh` updates the Builder shell. The supervisor itself (it serves Builder and the
   control plane) keeps running its old code until the host restarts `box dev` or `box start` once;
   from a Builder turn never stop or relaunch it: tell the owner to do it when the session ends.
4. `box maintenance off`. Maintenance refuses the Box's API and MCP tools (`box <tool>`) even for
   admins, so check pages in the Builder Preview while it is on, or end it after the restart before
   checking data through the tools.
5. Update `docs/UPSTREAM.md` with the completed core revision, and `_docs/INTEGRATION.md` with the
   steps, backups, verify result, anything left and the rollback.
6. Commit ("Upgrade core to <revision>; <recipe> <version>, ..."). Do not push unless the owner asks.
   In a Builder session, commit on the session's `builder/live/...` branch and end the report by
   asking the owner to open **Wrap Up**, run **Verify** and press **Finish**: Finish fast-forwards
   the Box's main branch to the session branch, keeping the merge of `origin/master` that the next
   upgrade starts from. Never squash or rebase that merge away.

## Rollback

Stop at the first unexplained failure and tell the owner. To roll back: `box maintenance on`,
`git checkout pre-upgrade-<date>` (or `git reset --hard` to it on the working branch, with the
owner's agreement), `bun install`, restore the warehouse with `box db restore <name>` and the copied
`data/docs` and `data/config`, `box app restart`, `box maintenance off`.

## Rules

Do not invent completed SHAs, test results or ancestry. If an old upstream revision is unknown,
record that and inspect local differences explicitly. Use the latest dependencies; record any pin
and its reason in `docs/GOTCHAS.md`. Write resume state to `_docs/INTEGRATION.md` before each source
or data mutation, and after an interruption reconcile actual files and ledgers before resuming.
