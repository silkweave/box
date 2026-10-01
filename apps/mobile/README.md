# Box mobile app

The Flutter app for this Box: the framework shell (`packages/mobile`) plus the feature modules
registered in `lib/generated/modules.dart`. A Box without mobile modules gets the empty shell.

Read [docs/MOBILE.md](../../docs/MOBILE.md) for the architecture, adding a module, identity,
development, version skew and distribution.

| File | Owner | Purpose |
| --- | --- | --- |
| `lib/main.dart` | core | `runBoxApp(config: appConfig, modules: mobileModules)` |
| `lib/main_dev.dart` | core | Development entry with the flutter_driver extension; never shipped |
| `lib/app_config.dart` | Box | Name, wordmark, accent, logo, default server |
| `lib/generated/modules.dart` | Box (maintained) | The registered modules |
| `pubspec.yaml` feature-module block | Box (maintained) | Path dependencies on `features/<id>/mobile` |
| `ios/`, `android/` | Box after setup | Native projects: identity, signing, capabilities |
| `scripts/dev.sh`, `scripts/reload.sh`, `tool/drive.dart` | core | Development loop and agent driving |
| `scripts/gen-app-icon.sh` | core | Launcher icons from `icon/app-icon-1024.png` |

```bash
flutter pub get
scripts/dev.sh sim
```
