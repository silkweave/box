# Mobile app powerup: install

Adds the Chat module (Dart package `box_chat`, source `features/chat/mobile/`) to the Box
mobile app. Read the module's `README.md` in the fetched Stack and [docs/MOBILE.md](../../../../docs/MOBILE.md)
("Adding a module to the app") first.

## Detect

The Box has this powerup when `features/chat/mobile/` exists and `box_chat` is registered in
`apps/mobile/lib/generated/modules.dart`. If it is, this is an update: compare against the recorded
Stack revision instead of copying over local changes.

## Requires

The Chat recipe and the Mobile app recipe (`recipes/mobile/`), each adapted and validated, with `chat` and `mobile` recorded in the `recipes` ledger of `box.json`. A module builds on the same recipes as its feature;
when it imports another recipe's module, add that module first.

## Owner decisions

- Whether to include the module now. Nothing else in the recipe changes when it is left out.

## Owner-only steps

- Native and store setup that needs the owner's accounts, if any (below).

## Steps

1. Copy/adapt `<fetched stack>/features/chat/mobile/` into the Box's `features/chat/mobile/`.
2. Add `box_chat: {path: ../../features/chat/mobile}` to the feature-module block of
   `apps/mobile/pubspec.yaml`, and register the module in `apps/mobile/lib/generated/modules.dart`.
3. Native requirements: iOS camera and photo library usage strings (the module uses `image_picker`); see the README's "Native requirements (host app)".
4. Record the powerup and its source revision in `docs/UPSTREAM.md`.
5. After Verify and the validation chain pass, record the powerup: add `mobile` to
   `recipes.chat.powerups` in `box.json`.

## Verify

Run `bun run test:mobile` (or `box verify`, which includes it), then run the app against a
disposable instance and send a message with a photo attachment from the device and see it arrive on the web. A Box without the Flutter SDK can still include the
module; say so in the record, since the mobile check then reports a skip rather than a pass.

## Remove

Remove the module from `apps/mobile/lib/generated/modules.dart` and the pubspec feature-module block,
revert its native requirements, delete `features/chat/mobile/`, remove `mobile` from
`recipes.chat.powerups` in `box.json`, and run `box verify`.
