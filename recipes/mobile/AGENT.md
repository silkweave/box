# Adapting the `mobile` recipe

Read [`SPEC.md`](./SPEC.md) first for what the app is, then [docs/MOBILE.md](../../docs/MOBILE.md).
There is no reference implementation to fetch: the framework `packages/mobile` and the app
`apps/mobile` are core and already in the checkout. The job is configuration and proof.

## 1. Integrate

Follow [INSTALL.md](./INSTALL.md). Do not create `features/mobile/`, a feature registration or a
dependency manifest for this recipe. Edit only the Box-owned files named in SPEC.md. Record the active
scope and state in `_docs/INTEGRATION.md`.

Ask the owner before touching the bundle id or application id: changing one after an install exists
creates a different app. Ask which recipe `mobile` powerups to add now; each can be added later and
each requires this recipe to be recorded in the `box.json` `recipes` ledger first.

## 2. Customise for the team

1. **Identity.** `apps/mobile/lib/app_config.dart` mirrors the `brand` block of `box.json`; the native
   name, ids and icons are set separately (docs/MOBILE.md, "Identity").
2. **Server address.** Set `server.dashboardUrl` in `box.local.json`, or pass `--server <url>` to
   `scripts/build.sh`. A VPN-only Box can set `unreachableHint`.
3. **Signing and distribution.** Keystore in `android/key.properties` (gitignored, outside the
   checkout), the Apple team in Xcode, and the chosen distribution route recorded in the Box's docs.
4. **Modules.** Registration is `lib/generated/modules.dart` plus the feature-module block of
   `pubspec.yaml`, maintained by hand with each powerup.
5. **Development.** Use `scripts/dev.sh`, `scripts/reload.sh` and `tool/drive.dart`. A test token goes in
   the gitignored `dev-defines.json`, never on a command line. Use a development Box.

## 3. Validate

Run `box verify`, then the simulator and device checks in INSTALL.md. Do not record a pass for
the mobile check when Flutter is missing. Only after Verify passes, add `mobile` to the `recipes` ledger
of `box.json`.
