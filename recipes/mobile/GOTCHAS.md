# mobile gotchas

The app is core code with a Box-owned identity. Keep the bundle id and application id stable once an
install exists: a new id is a new app and never upgrades the old one. Record local exceptions in the
Box's docs/GOTCHAS.md and current state in _docs/INTEGRATION.md. The longer list is in
[docs/MOBILE.md](../../docs/MOBILE.md), "Gotchas".

## Recipe-specific operational details

- **Installed builds outlive the server.** Removing or renaming a response field that `packages/mobile`
  or a `features/<id>/mobile` module reads breaks every installed build, and no check sees it. Keep
  server changes additive and search the Dart sources before narrowing a response.
- **Never ship `lib/main_dev.dart`.** It adds the flutter_driver extension. Development builds also
  look identical against production, so point them at a development Box.
- **Keep tokens out of transcripts.** The test token lives in the gitignored `dev-defines.json`; mint
  it with `box auth token <id> --quiet`.
- **A phone cannot reach `127.0.0.1`.** Use a Tailscale HTTPS address or a LAN IP in
  `server.dashboardUrl`.
- **Android release signing.** Without `android/key.properties` the release build is debug-signed and
  can never update an install signed with the real key. Keep the keystore outside the checkout and
  back it up.
- **Build numbers must increase.** Bump `version: <semver>+<build>` in `apps/mobile/pubspec.yaml` for
  every distributed build.
- **Swift Package Manager on iOS.** Do not run `pod install`; a `Podfile.lock` holding only `Flutter`
  is correct. On a fresh checkout `flutter pub get` can fail with "Failed to copy plugin": run
  `mkdir -p build/ios/SourcePackages` and retry.
- **Android desugaring.** `flutter_local_notifications` needs core library desugaring, or
  `checkReleaseAarMetadata` fails without naming the plugin.
- **Native plugins are a signing risk.** Prove a real device build in the same change that adds one.
- **Core upgrades.** `lib/app_config.dart`, `lib/generated/modules.dart`, the pubspec feature-module
  block and the native identity are the Box's own. Review upgrades against them rather than
  overwriting.
