/// The Silkweave Box mobile framework.
///
/// One import gives a feature module everything it needs:
///
/// ```dart
/// import 'package:box_mobile/box_mobile.dart';
/// ```
///
/// * Module contract: [BoxModule], [BoxModuleState], [BoxTab], [BoxRoute],
///   [BoxLink], [BoxSettingsSection], [BoxNotificationChannel].
/// * Session: [BoxSession] (api, principal, directory, storage, state), and
///   the [BoxContext] helpers on `BuildContext` (`context.session`,
///   `context.state<T>()`, `context.openLink`, `context.pushPage`,
///   `context.toast`).
/// * API: [BoxApi] with `getJson` / `postJson` / `upload` / `subscribe`.
/// * UI kit: pages, lists, grids, cards, popovers, sheets, states, loaders.
/// * Theme: `context.colors`, `context.text`, [BoxRadius], [BoxMotion].
///
/// docs/MOBILE.md in the Box is the guide; packages/mobile/README.md is the
/// API tour.
library;

export 'package:lucide_icons_flutter/lucide_icons.dart' show LucideIcons;

export 'src/api/box_api.dart';
export 'src/api/models.dart';
export 'src/app/box_app.dart';
export 'src/app/box_app_config.dart';
export 'src/app/box_app_controller.dart';
export 'src/app/box_scope.dart';
export 'src/kit/avatar.dart';
export 'src/kit/badge.dart';
export 'src/kit/brand.dart';
export 'src/kit/cards.dart';
export 'src/kit/grid.dart';
export 'src/kit/inputs.dart';
export 'src/kit/list.dart';
export 'src/kit/page.dart';
export 'src/kit/popover.dart';
export 'src/kit/resource.dart';
export 'src/kit/sheets.dart';
export 'src/kit/states.dart';
export 'src/module/box_link.dart';
export 'src/module/box_module.dart';
export 'src/notify/box_notifier.dart';
export 'src/session/box_directory.dart';
export 'src/session/box_session.dart';
export 'src/theme/theme.dart';
export 'src/theme/tokens.dart';
export 'src/util/format.dart';
