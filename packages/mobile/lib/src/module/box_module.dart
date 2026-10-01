import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';

import '../session/box_session.dart';
import 'box_link.dart';

/// A feature module: everything one Box feature contributes to the mobile app.
///
/// The app is an empty shell until modules are registered in
/// `apps/mobile/lib/generated/modules.dart`. A module is plain data - an id,
/// optional per-session state, and the surfaces it adds - so a small module is
/// one declaration:
///
/// ```dart
/// final planningModule = BoxModule(
///   id: 'planning',
///   title: 'Planning',
///   tabs: [
///     BoxTab(
///       id: 'planning',
///       label: 'Plan',
///       icon: LucideIcons.flag,
///       order: 20,
///       builder: (context) => const InitiativesScreen(),
///     ),
///   ],
///   routes: [
///     BoxRoute('initiative/:id', (context, link) =>
///         InitiativeScreen(id: link.param('id'))),
///   ],
/// );
/// ```
///
/// The module [id] is the Box feature id (`features/<id>/`), which is also the
/// recipe id. It is the first segment of every link the module owns
/// (`planning/initiative/42`) and the namespace of its stored preferences.
@immutable
class BoxModule {
  const BoxModule({
    required this.id,
    required this.title,
    this.createState,
    this.tabs = const [],
    this.routes = const [],
    this.settings = const [],
    this.notificationChannels = const [],
    this.linkForNotification,
  });

  /// The feature id, lower-case (`chat`, `planning`).
  final String id;

  /// Human name, shown in Settings and the More list.
  final String title;

  /// Builds this module's state for one signed-in session. Called once after
  /// sign-in; the shell calls [BoxModuleState.start], forwards app resumes to
  /// [BoxModuleState.resume], and calls [BoxModuleState.stop] then `dispose` on
  /// sign-out. Screens read it with `context.state<MyState>()`.
  ///
  /// Leave null for a module whose screens load their own data.
  final BoxModuleState Function(BoxSession session)? createState;

  /// Top-level destinations. The shell puts every module's tabs in one bar,
  /// sorted by [BoxTab.order], with Settings last.
  final List<BoxTab> tabs;

  /// Screens reachable by link (`<id>/<path>`), from a notification tap, from
  /// another module, or from inside this one. See [BoxRoute].
  final List<BoxRoute> routes;

  /// Sections this module adds to the Settings tab.
  final List<BoxSettingsSection> settings;

  /// Android notification channels this module posts to. Created at startup;
  /// iOS ignores channels.
  final List<BoxNotificationChannel> notificationChannels;

  /// Map a push notification's data payload to a link this module can open, or
  /// return null when the payload is not this module's. The shell asks every
  /// module in registration order and opens the first answer.
  final BoxLink? Function(Map<String, Object?> data)? linkForNotification;

  @override
  String toString() => 'BoxModule($id)';
}

/// Per-session state for a module: its store, its live feed, its caches.
///
/// Subclass it, keep the data here, and `notifyListeners()` when it changes;
/// screens rebuild through `ListenableBuilder(listenable: store, ...)`. The
/// lifecycle is driven by the shell, never by a screen:
///
/// * [start] once after sign-in (not awaited by the shell; failures are logged
///   and should surface through the state's own error fields),
/// * [resume] each time the app returns to the foreground,
/// * [stop] on sign-out, BEFORE the credential is dropped, so an
///   authenticated "unregister" call can still be made,
/// * `dispose` right after [stop].
abstract class BoxModuleState extends ChangeNotifier {
  BoxModuleState(this.session);

  final BoxSession session;

  bool _disposed = false;

  /// True once the session ended. Async work that finishes late must check it
  /// before touching state.
  bool get disposed => _disposed;

  Future<void> start() async {}

  Future<void> resume() async {}

  Future<void> stop() async {}

  /// Safe after dispose: a late async completion does not throw.
  @override
  void notifyListeners() {
    if (!_disposed) super.notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// One top-level destination in the bottom bar.
@immutable
class BoxTab {
  const BoxTab({
    required this.id,
    required this.label,
    required this.icon,
    required this.builder,
    this.order = 100,
    this.badge,
  });

  /// Unique across the app. Links select a tab by it.
  final String id;
  final String label;
  final IconData icon;

  /// Sort key: lower is further left. Core leaves gaps of 10; Settings is
  /// always last and not part of the ordering.
  final int order;

  /// The tab's root page, usually a `BoxPage`. It stays mounted while other
  /// tabs are shown.
  final WidgetBuilder builder;

  /// A count shown on the tab icon (hidden at 0), e.g. unread messages.
  final ValueListenable<int> Function(BoxSession session)? badge;
}

/// A page reachable by link.
///
/// [pattern] is the path AFTER the module id, with `:name` segments captured as
/// parameters: `BoxRoute('room/:slug', ...)` on module `chat` answers
/// `chat/room/general`, and `link.param('slug')` is `general`. Query
/// parameters ride along on [BoxLink.query].
@immutable
class BoxRoute {
  const BoxRoute(this.pattern, this.builder, {this.tab});

  final String pattern;
  final Widget Function(BuildContext context, BoxLink link) builder;

  /// The tab to select before pushing the page. Defaults to the module's first
  /// tab (or stays on the current tab when the module has none).
  final String? tab;

  /// Captured parameters when [path] matches, else null.
  Map<String, String>? match(List<String> path) {
    final parts = pattern.split('/').where((p) => p.isNotEmpty).toList();
    if (parts.length != path.length) return null;
    final params = <String, String>{};
    for (var i = 0; i < parts.length; i++) {
      final p = parts[i];
      if (p.startsWith(':')) {
        params[p.substring(1)] = path[i];
      } else if (p != path[i]) {
        return null;
      }
    }
    return params;
  }
}

/// A section of the Settings tab. [builder] usually returns a
/// `BoxListSection`.
@immutable
class BoxSettingsSection {
  const BoxSettingsSection({
    required this.id,
    required this.builder,
    this.order = 100,
  });

  final String id;
  final int order;
  final WidgetBuilder builder;
}

/// An Android notification channel. [id] must equal the `channel_id` the
/// server sends in its FCM payload, or Android files the push under a default
/// channel without a heads-up.
@immutable
class BoxNotificationChannel {
  const BoxNotificationChannel({
    required this.id,
    required this.name,
    this.description,
    this.important = true,
  });

  final String id;
  final String name;
  final String? description;

  /// High importance (heads-up) when true.
  final bool important;
}
