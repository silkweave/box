# `mobile` - the Box's native app

A Flutter app (iOS and Android) that talks to one Box. The code is core, not a feature: there is no
`features/mobile/`, no server or web half, no warehouse table and no migration. What this recipe
produces in a Box is a configured, built and verified copy of the shipped app. The full contract is in
[docs/MOBILE.md](../../docs/MOBILE.md); this page is the summary.

- **dependsOn**: nothing. It is core only.
- **Depended on by**: the `mobile` powerup of `chat`, `planning`, `notifications` and `artifacts`.
  Each one adds a Dart package at `features/<id>/mobile/` and registers it in this app.

## Packages

| Path | Package | Owner | What it is |
| --- | --- | --- | --- |
| `packages/mobile/` | `box_mobile` | core | Framework: shell, module contract, session, API client, theme, UI kit, test helpers |
| `apps/mobile/` | `box_app` | core, with Box-owned files | Entry point, identity, module registration, iOS and Android projects |
| `features/<id>/mobile/` | `box_<id>` | the Box | One module per recipe powerup that adds one |

`apps/mobile/pubspec.lock` is the single mobile lockfile.

## Box-owned files

These survive a core upgrade by review:

- `apps/mobile/lib/generated/modules.dart` and the feature-module block of `apps/mobile/pubspec.yaml`
  (registration; both empty in a core-only Box),
- `apps/mobile/lib/app_config.dart` (name, wordmark, suffix, accent, logo, default server, VPN hint),
- the native identity: bundle id, application id, display name, icons, signing, capabilities and any
  Firebase configuration.

`box:build` leaves out machine-, team- and secret-specific files: `pubspec.lock`,
`GoogleService-Info.plist`, `google-services.json`, `firebase_options.dart`, `key.properties` and
`dev-defines.json`.

## Behavior

- Boot is `BoxAppController`, with phases `booting`, `signedOut`, `unreachable`, `failed` and `ready`.
  An unexpected error is the `failed` phase, never an endless spinner.
- Sign-in takes the server address and a personal access token ([AUTH.md](../../docs/AUTH.md)). A
  build with `BOX_SERVER_URL` compiled in (or `BoxAppConfig.serverUrl`) fixes the address and asks only
  for the token.
- Tabs come from the registered modules, sorted by `order`, with Settings last. With no modules the app
  is one home page with Settings in its app bar.
- Links are `<module>/<path>` and are how notification taps and cross-module navigation work.
- Live data comes from `session.changes`, the server's `changesFeed`.
- Per-session module state is created after sign-in and disposed on sign-out.

## Scripts (in `apps/mobile/`)

`scripts/dev.sh` (simulator or device, runs `lib/main_dev.dart`), `scripts/reload.sh`,
`tool/drive.dart`, `scripts/build.sh <ios|android>`, `scripts/gen-app-icon.sh`.

## Server surface

The app uses the Box's REST mirror under `/api`, tRPC subscriptions over SSE and multipart uploads,
with bearer auth. It adds no routes of its own. An installed build outlives the server it was built
against, so server changes must stay additive ([GOTCHAS.md](./GOTCHAS.md)).

## Verification

`bun run test:mobile` runs Flutter analyze and test and is part of `box verify`. It reports a skip when
the Flutter SDK is not installed.

## Removal

Mobile is core, so the code stays. Removing the recipe means deleting its entry from the `recipes`
ledger in `box.json` and, if wanted, the Box's own native identity and store listings. Remove any
`mobile` powerups first.
