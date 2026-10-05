# Mobile app powerup: install

Adds the Planning module (Dart package `box_planning`, source `features/planning/mobile/`) to the Box
mobile app. Read the module's `README.md` in the fetched Stack and [docs/MOBILE.md](../../../../docs/MOBILE.md)
("Adding a module to the app") first.

## Detect

The Box has this powerup when `features/planning/mobile/` exists and `box_planning` is registered in
`apps/mobile/lib/generated/modules.dart`. If it is, this is an update: compare against the recorded
Stack revision instead of copying over local changes.

## Requires

The Planning recipe and the Mobile app recipe (`recipes/mobile/`), each adapted and validated, with `planning` and `mobile` recorded in the `recipes` ledger of `box.json`. A module builds on the same recipes as its feature;
when it imports another recipe's module, add that module first.

## Owner decisions

- Whether to include the module now. Nothing else in the recipe changes when it is left out.

## Owner-only steps

- Native and store setup that needs the owner's accounts, if any (below).

## Steps

1. Copy/adapt `<fetched stack>/features/planning/mobile/` into the Box's `features/planning/mobile/`.
2. Add `box_planning: {path: ../../features/planning/mobile}` to the feature-module block of
   `apps/mobile/pubspec.yaml`, and register the module in `apps/mobile/lib/generated/modules.dart`.
3. Native requirements: None: no permissions, entitlements or URL schemes.
4. Record the powerup and its source revision in `docs/UPSTREAM.md`.
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
