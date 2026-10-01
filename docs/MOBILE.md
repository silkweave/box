# Mobile app

Every Box can ship a native iOS and Android app. It starts as an empty shell: sign-in, Settings and
a welcome page. Each recipe that has a mobile module can add its screens to it, the same way the
recipe's `web` code adds routes to the dashboard. Chat, for example, adds a Chat tab with rooms,
threads, direct messages and the agent's activity; notifications adds push.

The app is Flutter. The Flutter SDK is optional for a Box: without it everything else works, and
`box verify` reports the mobile check as skipped.

## Layout

| Path | Package | Owner | What it is |
| --- | --- | --- | --- |
| `packages/mobile/` | `box_mobile` | core | The framework: shell, module contract, session, API client, theme, UI kit, test helpers |
| `apps/mobile/` | `box_app` | core, with Box-owned files | The app: entry point, identity, module registration, iOS and Android projects |
| `features/<id>/mobile/` | `box_<id>` | the Box | One feature module per recipe that has one |

Each module is its own Dart package because Dart imports only across packages: it depends on
`box_mobile` by path and declares only the packages it adds. The app depends on the framework and
on each module by path and owns the one lockfile (`apps/mobile/pubspec.lock`). This is the one
place the Box has per-feature manifests; they exist because the Dart toolchain requires them, not
to describe or install features.

Inside `apps/mobile/`, these files are the Box's own and survive a core upgrade by review, like
`apps/{server,web}/src/generated/features.ts`:

- `lib/generated/modules.dart` and the feature-module block of `pubspec.yaml` (registration),
- `lib/app_config.dart` (name, wordmark, accent, logo, default server),
- the native identity: bundle id, application id, display name, icons, signing, capabilities,
  and any Firebase configuration.

## Architecture

```text
runBoxApp(config, modules)
  BoxAppController       phases: booting -> signedOut | unreachable | failed | ready
    BoxSession           per sign-in: api, principal, agent, directory, notifier, storage
      module states      created by each module's createState, started after sign-in
  BoxShell               bottom bar from every module's tabs, Settings last, link routing
```

- **Navigation is flat.** Tabs are the top-level destinations, sorted by `order`, with Settings
  always last. With more than four module tabs, the fourth slot becomes "More", which lists the
  rest and Settings. Every other screen is pushed full screen over the bar
  (`context.pushPage`). With no modules, the app is one home page with Settings in its app bar.
- **Links address screens.** A link is `<module>/<path>` (`chat/room/general`). The shell resolves
  the module by id and the page by the module's `BoxRoute`s, selects the module's tab and pushes
  the page. Notification taps, cross-module navigation and in-module navigation all use links, so
  a screen never has to know who opens it.
- **State is per session.** A module's `BoxModuleState` is created after sign-in, `start`ed,
  `resume`d when the app returns to the foreground, `stop`ped on sign-out while the credential
  still works, then disposed. Nothing leaks between sign-ins.
- **Boot never hangs.** Every outcome of boot is a visible phase. An unexpected error is the
  `failed` phase, which names version skew as the likely cause; it is never narrowed to a list of
  known exceptions.

## Building a module

A module is a declaration. The smallest useful one is a tab over server data:

```dart
// features/planning/mobile/lib/box_planning.dart
import 'package:box_mobile/box_mobile.dart';

extension PlanningApi on BoxApi {
  Future<List<Map<String, dynamic>>> initiatives() async =>
      listOf((await getJson('/api/planning/initiatives'))['initiatives'], (j) => j);
}

final planningModule = BoxModule(
  id: 'planning',
  title: 'Planning',
  tabs: [
    BoxTab(
      id: 'planning',
      label: 'Plan',
      icon: LucideIcons.flag,
      order: 20,
      builder: (context) => BoxPage(
        title: 'Initiatives',
        body: BoxLoader<List<Map<String, dynamic>>>(
          load: (api) => api.initiatives(),
          isEmpty: (items) => items.isEmpty,
          empty: const BoxEmptyState(title: 'No initiatives yet'),
          builder: (context, items) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              for (final i in items)
                BoxPushCard(
                  title: i['title'] as String,
                  subtitle: i['summary'] as String?,
                  link: 'planning/initiative/${i['id']}',
                ),
            ],
          ),
        ),
      ),
    ),
  ],
  routes: [
    BoxRoute('initiative/:id', (context, link) => InitiativeScreen(id: link.param('id'))),
  ],
);
```

What a module can contribute, all optional except `id` and `title`:

| Field | Purpose |
| --- | --- |
| `createState` | Per-session state (`BoxModuleState`): a store, a live feed, caches. Screens read it with `context.state<T>()` |
| `tabs` | `BoxTab`s: id, label, icon, order, root page builder, optional badge count |
| `routes` | `BoxRoute('path/:param', builder)`: pages reachable by link |
| `settings` | `BoxSettingsSection`s shown in Settings |
| `notificationChannels` | Android channels; the id must equal the server's FCM `channel_id` |
| `linkForNotification` | Map a push payload to a link this module opens |

### Conventions

- **Ids.** The module id is the feature id and the recipe id. It is the first segment of every
  link the module owns and the namespace of `session.storage(id)`. Tab ids are unique across the
  app. Core leaves gaps of 10 in tab `order`; chat takes 10.
- **API calls** are an extension or a thin wrapper over `BoxApi`, never a second HTTP client. The
  Box's REST mirror under `/api` is the surface (see [SERVER.md](SERVER.md)); `postJson` is also
  how the Box reads with structured input; `subscribe('<procedure>')` reads a tRPC subscription
  over SSE; `upload` sends multipart. Errors are `BoxApiException` (with the server's message) and
  `BoxUnreachableException`.
- **Wire models** are hand-written `fromJson` mirrors of the server DTOs, tolerant of unknown keys
  and of optional ones going missing. See "Version skew".
- **People** come from `session.directory` (one name and one avatar everywhere); the agent's
  identity from `session.agent`. Never hard-code one Box's user or agent id.
- **Screens** use `BoxPage` and the kit, so every module has the same chrome and adapts to light
  and dark. Colours come from `context.colors`, text styles from `context.text`.
- **Cross-module** integration goes through links (`context.openLink('chat/room/x')`) or
  `session.maybeState<OtherState>()` for optional reads. A module never imports another module's
  package unless its recipe builds on that recipe.
- **Native requirements** (permission strings, entitlements, URL schemes) are listed in the
  module's `README.md`; adapting the module applies them to `apps/mobile/ios` and `android`.

### The kit

One import, `package:box_mobile/box_mobile.dart`, carries everything:

| Need | Use |
| --- | --- |
| A page | `BoxPage(title:, actions:, children: [...] or body:, onRefresh:)` |
| Grouped rows | `BoxListSection(header:, children: [BoxListTile(...)])`, `BoxSwitchTile` |
| Tiles and dashboards | `BoxGrid(children: [BoxGridTile(...), BoxStatCard(...)])` |
| Cards | `BoxCard`, `BoxPushCard` (navigates to `page`, `link` or `onTap`) |
| Menus and popovers | `BoxMenuButton`, `showBoxMenu`, `showBoxPopover` (anchored) |
| Sheets and dialogs | `showBoxSheet`, `showBoxConfirm`, `showBoxPrompt` |
| Loading data | `BoxLoader` (one screen), `BoxResource` + `BoxResourceView` (shared in a state) |
| Empty, error, busy | `BoxEmptyState`, `BoxErrorState`, `BoxLoading`, `BoxSpinner` |
| Inputs | `BoxSearchField`, `BoxSegmented`, `BoxField` |
| People and status | `BoxAvatar`, `BoxAvatar.user`, `BoxBadge` + `BoxTone`, `BoxCount` |
| Feedback | `context.toast`, `context.toastError` |
| Formatting | `formatRelative`, `formatClock`, `formatDate`, `formatDateTime`, `formatCompact`, `plural` |
| Brand | `BoxBrandMark`, `BoxWordmark`, `boxSwatch(id, brightness)` |

`packages/mobile/README.md` is the API tour with more examples.

### Testing

`package:box_mobile/testing.dart` (import it from `test/` only) provides `FakeServer` (routes by
`'METHOD /path'`), `pumpBoxApp` (the whole app, signed in, with your modules), `testSession` (a
session without the app, for a state or one screen) and `boxTestApp` (theme and scope around one
widget). Tests that pin a contract shared with the server, such as a channel id or an enum
mirrored from `core/types.ts`, read the server source by relative path so drift fails a test.

## Adding a module to the app

When a recipe with a mobile module is adapted, the owner is asked whether to include the module
(see [RECIPES.md](RECIPES.md)). Including it means:

1. Copy `<fetched stack>/features/<id>/mobile/` into the Box's `features/<id>/mobile/`, adapting it
   with the rest of the recipe.
2. Add the path dependency to the feature-module block of `apps/mobile/pubspec.yaml`:
   `box_<id>: {path: ../../features/<id>/mobile}`.
3. Import it and add its module to the list in `apps/mobile/lib/generated/modules.dart`. Order in
   the list is the order modules are asked for notification links; tab order comes from `order`.
4. Apply the module README's native requirements to `apps/mobile/ios` and `apps/mobile/android`.
5. Run `bun run test:mobile` (or `box verify`), then run the app against the Box and exercise the
   module.

Removing a module is the reverse. A recipe's modules that build on other recipes' modules need
those first, exactly as the recipes do.

## Identity

The Stack ships the placeholder identity `dev.silkweave.box` ("Silkweave Box"). Set the Box's own
before the first build anyone installs, because a new bundle id is a new app that does not upgrade
the old one:

- `lib/app_config.dart`: name, wordmark, suffix and accent from `box.json` `brand`, the logo asset,
  an optional default server URL and an optional VPN hint for the unreachable screen.
- iOS: `PRODUCT_BUNDLE_IDENTIFIER` in `ios/Runner.xcodeproj/project.pbxproj` (Runner and
  RunnerTests), `CFBundleDisplayName` and `CFBundleName` in `ios/Runner/Info.plist`, and the team
  under Signing & Capabilities.
- Android: `namespace` and `applicationId` in `android/app/build.gradle.kts`, the Kotlin package
  directory `android/app/src/main/kotlin/<id path>/MainActivity.kt`, and `android:label` in the
  manifest.
- Icons: replace `icon/app-icon-1024.png` and `icon/notification.svg` (white is kept, black is cut
  out) and run `scripts/gen-app-icon.sh` (needs ImageMagick and librsvg); replace
  `assets/brand-logo.png` for the in-app mark.

## Development

```bash
cd apps/mobile
flutter pub get
scripts/dev.sh sim                          # iOS Simulator against this checkout's Box
scripts/dev.sh phone --device <udid>        # a device; server defaults to server.dashboardUrl
scripts/reload.sh sim [--restart]           # hot reload without touching the terminal
dart run tool/drive.dart shot /tmp/app.png  # drive the running app: shot, tap, tapkey, type, wait
```

`scripts/dev.sh` runs `lib/main_dev.dart`, which adds the flutter_driver extension so an agent can
tap, type and screenshot over the VM service. Never ship that target. The server address is passed
as `BOX_SERVER_URL`; a test user's token can prefill sign-in through `BOX_DEV_TOKEN` in the
gitignored `apps/mobile/dev-defines.json`, so it never appears on a command line. Mint that token
with `box auth token <id> --quiet` and never print it into a transcript. Point development builds
at a development Box: the app looks the same against production, so a test message would land in a
real room.

A physical phone cannot reach the Mac's `127.0.0.1`. Use an address both can reach. The simplest is
`tailscale serve --bg --https=443 http://127.0.0.1:<server.port>`, which gives the Box an HTTPS
address on the tailnet (`https://<machine>.<tailnet>.ts.net`) while it keeps listening on loopback;
put that address in `server.dashboardUrl` in `box.local.json` and both scripts use it. Otherwise use
the Tailscale or LAN IP with `server.host` set to listen on it.

Sign-in takes the server address and a personal access token, the same bearer MCP clients use
([AUTH.md](AUTH.md)). Bearer calls are CSRF-exempt.

## Version skew

The web app ships with the server; the mobile app does not. An installed build keeps talking to a
server that moves without it, so a server change that removes or renames a field the app reads is
a breaking change for every installed build, and no check in the Box can see it: the tests run
against the current Dart, updated in the same change.

- Additive server changes are safe; the app ignores unknown keys.
- Before narrowing a response, search `packages/mobile` and every `features/*/mobile` for the
  field, and ship a new build after.
- Keep boot's catch-all `failed` phase: it is what turns a skewed response into a screen that says
  so instead of an endless spinner.

## Distributing

`scripts/build.sh <ios|android> [--install <device id>]` makes a release build with the Box's
address compiled in: `server.dashboardUrl`, or `--server <url>`, becomes `BOX_SERVER_URL`. A build
with an address treats it as a constant: the sign-in screen has no Server field and asks only for
the access token, and a stored address from an earlier build is ignored. A build without one asks
for the address (`BoxAppConfig.serverUrl` in `lib/app_config.dart` fixes it in source instead). `--install` puts the build on a
USB-connected device and opens it. Bump `version: <semver>+<build>`
in `apps/mobile/pubspec.yaml` for every distributed build: the build number is Android's
`versionCode` and iOS's `CFBundleVersion`, it must always increase, and two builds with the same
number cannot be told apart.

- **Android** signs release builds with the keystore named by the gitignored
  `android/key.properties` (`storeFile`, `storePassword`, `keyAlias`, `keyPassword`); keep the
  keystore outside the checkout and back it up. Without the file the release build is debug-signed
  and says so; such an APK can never update an install signed with the real key.
- **iOS** needs an Apple developer team. Ad-hoc builds (`flutter build ipa --export-method
  ad-hoc`) install only on devices registered before the build; TestFlight avoids the device list
  at the price of App Store Connect.
- Firebase App Distribution or the stores can carry the builds. Record the Box's choice and its
  identifiers in the Box's own docs.

## Gotchas

- `flutter_local_notifications` requires core library desugaring on Android
  (`isCoreLibraryDesugaringEnabled` and the `desugar_jdk_libs` dependency); without it
  `checkReleaseAarMetadata` fails without naming the plugin.
- iOS plugins come in over Swift Package Manager. `ios/Podfile.lock` holding only `Flutter` is
  correct; do not run `pod install`.
- On a fresh checkout `flutter pub get` in `apps/mobile` can fail with "Failed to copy plugin"
  because Flutter copies Swift Package plugins into `build/ios/SourcePackages` before creating it.
  `mkdir -p build/ios/SourcePackages` and rerun; `bun run test:mobile` does this itself.
- The first Android build downloads the NDK (about 1 GB) and takes several minutes.
- Release builds never print "Launched application"; wait for "Installing and launching".
- A native plugin is a device-signing risk: prove a real device build in the same change that adds
  one. `flutter analyze` does not look inside plugins.
- Links opened with `context.openUrl` need their scheme declared in the Android manifest
  `<queries>`; the app declares https, mailto and tel.
- The glass tab bar paints each tab icon twice, so a widget test finds a badge's text twice.
- `session.notifier.show` is silent while the app is in the background. Android keeps a
  backgrounded app's feeds running, and a push already covers that case; showing both notified twice.
- Android draws a notification's small icon from its alpha only, so a full-colour icon is a blank
  square. Local notifications and Firebase pushes both use `@drawable/ic_notification`.
- The debug APK is about 170 MB. An emulator short of space refuses it; install a profile build
  (`flutter build apk --profile --target-platform android-arm64`) instead.
