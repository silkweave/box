import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../module/box_module.dart';
import '../theme/theme.dart';
import 'box_app_config.dart';
import 'box_app_controller.dart';
import 'box_scope.dart';
import 'connect_screens.dart';
import 'shell.dart';

/// Compile-time switches.
///
/// `BOX_SERVER_URL` is the Box's address, fixed for the build in place of
/// `BoxAppConfig.serverUrl`. `apps/mobile/scripts/build.sh` compiles in the
/// Box's `server.dashboardUrl`.
///
/// `BOX_DEV_TOKEN` signs a simulator in without typing: development only, never
/// set it for a distributed build. Pass it through
/// `--dart-define-from-file=<gitignored json>` so it never appears on a
/// command line or in a transcript.
const _devServerUrl = String.fromEnvironment('BOX_SERVER_URL');
const _devToken = String.fromEnvironment('BOX_DEV_TOKEN');

/// Start the app. `apps/mobile/lib/main.dart` is one call:
///
/// ```dart
/// Future<void> main() => runBoxApp(config: appConfig, modules: mobileModules);
/// ```
Future<void> runBoxApp({
  required BoxAppConfig config,
  required List<BoxModule> modules,
}) async {
  WidgetsFlutterBinding.ensureInitialized();
  await LiquidGlassWidgets.initialize();
  final prefs = await SharedPreferences.getInstance();
  final effective = _devServerUrl.isEmpty
      ? config
      : BoxAppConfig(
          name: config.name,
          wordmark: config.wordmark,
          suffix: config.suffix,
          accent: config.accent,
          logoAsset: config.logoAsset,
          unreachableHint: config.unreachableHint,
          serverUrl: _devServerUrl,
        );
  final controller = BoxAppController(
    prefs: prefs,
    config: effective,
    modules: modules,
    seedToken: _devToken,
  );
  runApp(
    LiquidGlassWidgets.wrap(
      brightnessResolver: Theme.maybeBrightnessOf,
      child: BoxApp(
        controller: controller,
        themeController: ThemeController(prefs),
      ),
    ),
  );
}

/// The root widget: theme, boot phases, and the shell once signed in. Tests
/// build it directly with a controller over a fake HTTP client.
class BoxApp extends StatefulWidget {
  const BoxApp({
    super.key,
    required this.controller,
    required this.themeController,
    this.initNotifications = true,
  });

  final BoxAppController controller;
  final ThemeController themeController;

  /// False in widget tests, where the notification plugin has no platform.
  final bool initNotifications;

  /// Build a controller for tests: in-memory prefs, a fake HTTP client.
  static BoxAppController testController({
    required SharedPreferences prefs,
    required List<BoxModule> modules,
    required http.Client client,
    BoxAppConfig config = const BoxAppConfig(name: 'Test Box'),
  }) => BoxAppController(
    prefs: prefs,
    config: config,
    modules: modules,
    httpClient: client,
  );

  @override
  State<BoxApp> createState() => _BoxAppState();
}

class _BoxAppState extends State<BoxApp> with WidgetsBindingObserver {
  BoxAppController get app => widget.controller;
  final _navigator = GlobalKey<NavigatorState>();
  Object? _session;

  final _routes = _RouteTracker();

  /// Pages pushed during a session sit above `home` and would survive the
  /// phase switch, rebuilding against a session that no longer exists. Remove
  /// them the moment the session changes, without an exit animation (an
  /// animating page would still build once more, session-less).
  void _onAppChanged() {
    if (identical(_session, app.session)) return;
    _session = app.session;
    final navigator = _navigator.currentState;
    if (navigator == null) return;
    for (final route in _routes.stack.reversed.toList()) {
      if (!route.isFirst) navigator.removeRoute(route);
    }
  }

  @override
  void initState() {
    super.initState();
    _session = app.session;
    app.addListener(_onAppChanged);
    WidgetsBinding.instance.addObserver(this);
    if (widget.initNotifications) {
      app.notifier.init(app.notificationChannels);
    }
    app.boot();
  }

  @override
  void dispose() {
    app.removeListener(_onAppChanged);
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) app.resume();
  }

  @override
  Widget build(BuildContext context) {
    final accent = app.config.accent;
    return ListenableBuilder(
      listenable: Listenable.merge([widget.themeController, app]),
      builder: (context, _) => BoxScope(
        app: app,
        session: app.session,
        child: MaterialApp(
          navigatorKey: _navigator,
          navigatorObservers: [_routes],
          title: app.config.name,
          debugShowCheckedModeBanner: false,
          theme: boxTheme(Brightness.light, accent: accent),
          darkTheme: boxTheme(Brightness.dark, accent: accent),
          themeMode: widget.themeController.mode,
          home: switch (app.phase) {
            BoxPhase.booting => const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            ),
            BoxPhase.signedOut => SignInScreen(app: app),
            BoxPhase.unreachable => UnreachableScreen(app: app),
            BoxPhase.failed => BootFailedScreen(app: app),
            BoxPhase.ready => BoxShell(
              // A new session is a new shell: tab state never leaks between
              // sign-ins.
              key: ObjectKey(app.session),
              app: app,
              themeController: widget.themeController,
            ),
          },
        ),
      ),
    );
  }
}

/// The root navigator's routes, in order, so a session change can remove the
/// pushed ones without animating them.
class _RouteTracker extends NavigatorObserver {
  final List<Route<dynamic>> stack = [];

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) => stack.add(route);

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) => stack.remove(route);

  @override
  void didRemove(Route<dynamic> route, Route<dynamic>? previousRoute) => stack.remove(route);

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) {
    final i = oldRoute == null ? -1 : stack.indexOf(oldRoute);
    if (i >= 0 && newRoute != null) {
      stack[i] = newRoute;
    } else if (newRoute != null) {
      stack.add(newRoute);
    }
  }
}
