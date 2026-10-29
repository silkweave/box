# Mobile app powerup: install

Adds the Planning module (Dart package `box_planning`, source `features/planning/mobile/`) to the Box
mobile app. Read the module's `README.md` in the fetched Stack and [docs/MOBILE.md](../../../../docs/MOBILE.md)
("Adding a module to the app") first.

It adds the Plan tab (order 20) and the `planning/initiative/<key>` and `planning/task/<key>`
links, and calls the REST mirror under `/api/planning`. Its wire models (`lib/src/models.dart`)
mirror `planning.controller.ts`; a change that renames or removes a field the app reads breaks
every installed build (docs/MOBILE.md, "Version skew"). Its tab label, icon and order live in the
module declaration in `features/planning/mobile/lib/src/planning_module.dart`.

The module carries the base and reads the powerup fields only when the server sends them: milestone
marks, state, progress, health, the "measured by" fact and the outcome flag (milestones powerup),
initiative health (milestones), and a task's sprint as a read-only fact (sprints powerup). The app code
needs no change in a Box without those powerups, but `test/contract_test.dart` reads
`ITEM_KINDS`, `MILESTONE_STATES` and `GOAL_HEALTHS` from `core/types.ts`: without milestones (and
without goals, which also keep `GOAL_HEALTHS`) drop those checks, or they fail on the trimmed core. Goals, cycles, sprint pages, creating
milestones and editing a milestone's measure stay on the web; `goal_ids` is parsed but not shown.

## Detect

The Box has this powerup when `features/planning/mobile/` exists and `box_planning` is registered in
`apps/mobile/lib/generated/modules.dart`. If it is, this is an update: compare against the version recorded in the
`recipes` ledger of `box.json` instead of copying over local changes.

## Requires

The Planning recipe and the Mobile app recipe (`recipes/mobile/`), each adapted and validated, with `planning` and `mobile` recorded in the `recipes` ledger of `box.json`. A module builds on the same recipes as its feature;
when it imports another recipe's module, add that module first.

## Owner decisions

- Whether to include the module now. Nothing else in the recipe changes when it is left out.

## Owner-only steps

- Native and store setup that needs the owner's accounts, if any (below).

## Steps

1. Run `box recipe fetch planning --version <the version in the recipes ledger of box.json>`, then copy/adapt `<fetched recipe>/features/planning/mobile/` into the Box's `features/planning/mobile/`.
2. Add `box_planning: {path: ../../features/planning/mobile}` to the feature-module block of
   `apps/mobile/pubspec.yaml`, and register the module in `apps/mobile/lib/generated/modules.dart`.
3. Native requirements: None: no permissions, entitlements or URL schemes.
4. Record the powerup, with the fetched version and sha256, in the `recipes` ledger of `box.json`.
5. After Verify and the validation chain pass, record the powerup: add `mobile` to
   `recipes.planning.powerups` in `box.json`.

## Verify

Run `bun run test:mobile` (or `box verify`, which includes it), then run the app against a
disposable instance and open an initiative, change a task field in place and see the change on the web. A Box without the Flutter SDK can still include the
module; say so in the record, since the mobile check then reports a skip rather than a pass.

## Remove

Remove the module from `apps/mobile/lib/generated/modules.dart` and the pubspec feature-module block,
revert its native requirements, delete `features/planning/mobile/`, remove `mobile` from
`recipes.planning.powerups` in `box.json`, and run `box verify`.
