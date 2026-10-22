# Adapt the mobile recipe

This is the adaptation guide for the mobile app recipe. Read [RECIPE.md](./RECIPE.md),
[SPEC.md](./SPEC.md), the recipe [GOTCHAS.md](./GOTCHAS.md), [docs/MOBILE.md](../../docs/MOBILE.md), the
Box's docs/UPSTREAM.md and its current _docs/INTEGRATION.md before changing files. Unlike other
recipes there is nothing to fetch or copy: `packages/mobile` and `apps/mobile` already ship with core.
Adapting means making that app this Box's own and proving it works.

## Prerequisites

- Core, nothing else. Builds on: **none, core only**.
- The Flutter SDK. Without it the rest of the Box works and `box verify` reports the mobile check as
  skipped, but this recipe cannot be validated.
- Xcode (iOS) and Android Studio or the Android SDK (Android), for the platforms the Box wants.
- A development Box to point builds at, not production.
- An integration entry with scope and state in _docs/INTEGRATION.md.

## Detect

The Box has adapted this recipe when `mobile` is in the `recipes` ledger of `box.json`. If it is, this
is an update: review core changes to `apps/mobile` against the Box-owned files instead of overwriting
them.

## Owner decisions

- The app name and bundle id (iOS) and application id (Android). A new bundle id is a new app that
  does not upgrade the old one, so decide before the first build anyone installs.
- Whether to fix the server address in the build, and the distribution route (Firebase App
  Distribution, TestFlight, ad-hoc, the stores).

## Owner-only steps

- An Apple developer team for iOS signing and a keystore for Android release signing, kept outside the
  checkout and backed up.
- Firebase and APNs setup, only when push is wanted. That belongs to the `notifications` mobile
  powerup.
- Store listings, when distributing through the stores.

## Steps

1. Set the identity in `apps/mobile/lib/app_config.dart` from the `brand` block of `box.json`: name,
   wordmark, suffix, accent, logo asset, optional default server and VPN hint.
2. Set the native identity: iOS `PRODUCT_BUNDLE_IDENTIFIER` (Runner and RunnerTests),
   `CFBundleDisplayName` and `CFBundleName`, and the signing team; Android `namespace`,
   `applicationId`, the Kotlin package directory of `MainActivity.kt`, and `android:label`.
3. Replace `icon/app-icon-1024.png`, `icon/notification.svg` and `assets/brand-logo.png`, then run
   `scripts/gen-app-icon.sh` (needs ImageMagick and librsvg).
4. Point the app at this Box: put a reachable address in `server.dashboardUrl` in `box.local.json`
   (a phone cannot reach the Mac's `127.0.0.1`; see docs/MOBILE.md, "Development").
5. Run `flutter pub get` in `apps/mobile`, then `scripts/dev.sh sim` against a disposable Box. Mint a
   test token with `box auth token <id> --quiet` and keep it out of transcripts.
6. Build for a physical device with `scripts/dev.sh phone --device <udid>` and, for distribution,
   `scripts/build.sh <ios|android>`. Bump `version` in `apps/mobile/pubspec.yaml` for every
   distributed build.
7. Register the feature mobile modules the Box wants by adding each recipe's `mobile` powerup
   (`recipes/<id>/powerups/mobile/`). Each is optional and can be added later.
8. Record any skipped upstream changes in docs/UPSTREAM.md, and durable
   findings in docs/GOTCHAS.md.
9. Record `mobile` in the `recipes` ledger of `box.json`, for example
   `"recipes": { "mobile": { "powerups": [] } }`. Add this entry only after the Verify steps pass.

## Verify

Run `bun run test:mobile` (or `box verify`, which includes it). Then run the app on the iOS Simulator
or an Android emulator against a disposable instance with background work disabled: reach the sign-in
screen, sign in with a test token, see the welcome page (or the registered tabs) and Settings, sign out
and back in. Repeat once on a physical device build. Record the commands and actual results in
_docs/VALIDATION.md. A Box without the Flutter SDK cannot complete this step; the mobile check then
reports a skip rather than a pass.

## Remove

Remove any `mobile` powerups first. Delete the `mobile` entry from the `recipes` ledger of `box.json`.
The shipped app code stays, because it is core. Revert the Box's identity files only if the Box is
giving up the app entirely.
