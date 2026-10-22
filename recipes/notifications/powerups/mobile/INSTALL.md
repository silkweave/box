# Mobile app powerup: install

Adds the Notifications module (Dart package `box_notifications`, source `features/notifications/mobile/`) to the Box
mobile app. Read the module's `README.md` in the fetched Stack and [docs/MOBILE.md](../../../../docs/MOBILE.md)
("Adding a module to the app") first.

## Detect

The Box has this powerup when `features/notifications/mobile/` exists and `box_notifications` is registered in
`apps/mobile/lib/generated/modules.dart`. If it is, this is an update: compare against the version recorded in the
`recipes` ledger of `box.json` instead of copying over local changes.

## Requires

The Notifications recipe and the Mobile app recipe (`recipes/mobile/`), each adapted and validated, with `notifications` and `mobile` recorded in the `recipes` ledger of `box.json`. A module builds on the same recipes as its feature;
when it imports another recipe's module, add that module first.

## Owner decisions

- Whether to include the module now. Nothing else in the recipe changes when it is left out.

## Owner-only steps

- Native and store setup that needs the owner's accounts, if any (below).

## Steps

1. Run `box recipe fetch notifications --version <the version in the recipes ledger of box.json>`, then copy/adapt `<fetched recipe>/features/notifications/mobile/` into the Box's `features/notifications/mobile/`.
2. Add `box_notifications: {path: ../../features/notifications/mobile}` to the feature-module block of
   `apps/mobile/pubspec.yaml`, and register the module in `apps/mobile/lib/generated/modules.dart`.
3. Native requirements: Firebase: `GoogleService-Info.plist` and `google-services.json` (gitignored), or Firebase options in code, plus the APNs key in the Firebase project for iOS. The README's "Firebase setup" lists both ways. Without them the module builds and stays inert, and its Settings row says why.
4. Record the powerup, with the fetched version and sha256, in the `recipes` ledger of `box.json`.
5. After Verify and the validation chain pass, record the powerup: add `mobile` to
   `recipes.notifications.powerups` in `box.json`.

## Verify

Run `bun run test:mobile` (or `box verify`, which includes it), then run the app against a
disposable instance and on a real device, allow notifications, check the Settings row reports this device as registered, trigger a push from the Box and tap it. A Box without the Flutter SDK can still include the
module; say so in the record, since the mobile check then reports a skip rather than a pass.

## Remove

Remove the module from `apps/mobile/lib/generated/modules.dart` and the pubspec feature-module block,
revert its native requirements, delete `features/notifications/mobile/`, remove `mobile` from
`recipes.notifications.powerups` in `box.json`, and run `box verify`.
