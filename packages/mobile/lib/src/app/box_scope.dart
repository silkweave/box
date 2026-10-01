import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/box_api.dart';
import '../module/box_module.dart';
import '../session/box_session.dart';
import 'box_app_controller.dart';

/// Makes the app controller and the signed-in session reachable from any
/// widget. Installed by the shell; modules use the [BoxContext] extension
/// rather than this class.
class BoxScope extends InheritedWidget {
  const BoxScope({
    super.key,
    required this.app,
    required this.session,
    required super.child,
  });

  final BoxAppController app;
  final BoxSession? session;

  static BoxScope of(BuildContext context) {
    final scope = context.dependOnInheritedWidgetOfExactType<BoxScope>();
    assert(scope != null, 'No BoxScope above this widget');
    return scope!;
  }

  static BoxScope? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<BoxScope>();

  @override
  bool updateShouldNotify(BoxScope oldWidget) =>
      oldWidget.session != session || oldWidget.app != app;
}

/// The helpers a module screen needs, on `BuildContext`.
extension BoxContext on BuildContext {
  /// The signed-in session. Only valid below the shell (every module screen).
  BoxSession get session {
    final s = BoxScope.of(this).session;
    if (s == null) throw StateError('No signed-in session here');
    return s;
  }

  /// The API client of the signed-in session.
  BoxApi get api => session.api;

  /// The running state of a module: `context.state<ChatStore>()`.
  T state<T extends BoxModuleState>() => session.state<T>();

  /// Open an in-app link: `context.openLink('chat/room/general')`.
  void openLink(Object link) => session.open(link);

  /// Push [page] on the root navigator (full screen, over the tab bar), the
  /// app's one way to drill into detail.
  Future<T?> pushPage<T>(Widget page, {bool fullscreenDialog = false}) =>
      Navigator.of(this, rootNavigator: true).push<T>(
        MaterialPageRoute(
          builder: (_) => page,
          fullscreenDialog: fullscreenDialog,
        ),
      );

  /// A short message at the bottom of the screen.
  void toast(String message) {
    ScaffoldMessenger.maybeOf(this)
      ?..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }

  /// [toast] for an error, with the server's own words when it gave any.
  void toastError(Object error) => toast(describeError(error));

  /// Open [url] outside the app (browser, mail, maps).
  Future<bool> openUrl(Object url) async {
    final uri = url is Uri ? url : Uri.tryParse(url.toString());
    if (uri == null) return false;
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}

/// A person-readable sentence for [error].
String describeError(Object error) => switch (error) {
  BoxUnreachableException() => 'Could not reach the server',
  BoxApiException(:final status, :final message) when status == 401 =>
    'Your session has ended - sign in again ($message)',
  BoxApiException(:final message) => message,
  _ => 'Something went wrong: $error',
};

