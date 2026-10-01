/// Test helpers for modules built on `box_mobile`.
///
/// ```dart
/// import 'package:box_mobile/testing.dart';
///
/// testWidgets('shows deals', (tester) async {
///   final server = FakeServer()..signedIn()
///     ..on('GET /api/crm/deals', (_) => {'deals': [...]});
///   await pumpBoxApp(tester, server: server, modules: [crmModule]);
///   expect(find.text('Acme'), findsOneWidget);
/// });
/// ```
///
/// Only import it from `test/`.
// The helpers call test-only seams (mock preferences, the font switch) on
// purpose: this library IS test code that happens to live in lib/.
// ignore_for_file: invalid_use_of_visible_for_testing_member
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'box_mobile.dart';

export 'package:http/http.dart' show Request, Response;

/// A fake Box server: `'METHOD /path'` -> handler. A handler returns a JSON
/// value (encoded with status 200) or an `http.Response`; it may throw an
/// `http.ClientException` to simulate a network failure. Unknown routes
/// answer 404. [calls] records every request in order.
class FakeServer {
  final routes = <String, Object? Function(http.Request request)>{};
  final calls = <String>[];

  void on(String route, Object? Function(http.Request request) handler) =>
      routes[route] = handler;

  /// The decoded JSON body of a request, for asserting what was sent.
  static Map<String, dynamic> body(http.Request request) =>
      jsonDecode(request.body) as Map<String, dynamic>;

  http.Client get client => MockClient((req) async {
    final key = '${req.method} ${req.url.path}';
    calls.add(key);
    final handler = routes[key];
    if (handler == null) return http.Response('{"message":"not found"}', 404);
    final result = handler(req);
    if (result is http.Response) return result;
    return http.Response(
      jsonEncode(result),
      200,
      headers: {'content-type': 'application/json'},
    );
  });

  /// `/api/auth/me` and `/api/users/list` for a signed-in [id].
  void signedIn({
    String id = 'ada',
    String display = 'Ada Lovelace',
    List<Map<String, Object?>> users = const [],
  }) {
    on('GET /api/auth/me', (_) => {
      'principal': {'id': id, 'display': display, 'role': 'admin'},
      'agent': {'id': 'nova', 'name': 'Nova', 'role': 'admin'},
      'needsOwner': false,
    });
    on('GET /api/users/list', (_) => {
      'users': [
        {
          'id': id,
          'first_name': display.split(' ').first,
          'last_name': display.split(' ').skip(1).join(' '),
          'nickname': id,
        },
        ...users,
      ],
    });
  }
}

/// Pump the whole app over [server] with [modules], signed in unless [token]
/// is null. Returns the controller (`controller.session!.state<T>()`).
Future<BoxAppController> pumpBoxApp(
  WidgetTester tester, {
  required FakeServer server,
  List<BoxModule> modules = const [],
  String? token = 'test-token',
  BoxAppConfig config = const BoxAppConfig(name: 'Test Box'),
}) async {
  debugBoxUseGoogleFonts = false;
  SharedPreferences.setMockInitialValues({
    'box.server': 'https://box.test',
    'box.token': ?token,
  });
  final prefs = await SharedPreferences.getInstance();
  final controller = BoxApp.testController(
    prefs: prefs,
    modules: modules,
    client: server.client,
    config: config,
  );
  await tester.pumpWidget(
    BoxApp(
      controller: controller,
      themeController: ThemeController(prefs),
      initNotifications: false,
    ),
  );
  await tester.pumpAndSettle();
  return controller;
}

/// A signed-in session over [server] without the app around it, for testing
/// a module state or a single screen. Module states you create are attached
/// with `session.attach(state)`.
Future<BoxSession> testSession({
  FakeServer? server,
  String id = 'ada',
  String display = 'Ada Lovelace',
  void Function(BoxLink link)? open,
  BoxNotifier? notifier,
}) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  return BoxSession(
    api: BoxApi(
      baseUrl: 'https://box.test',
      token: 'test-token',
      client: (server ?? FakeServer()).client,
    ),
    principal: BoxPrincipal(id: id, display: display, role: BoxRole.admin),
    agent: const BoxAgentIdentity(id: 'nova', name: 'Nova'),
    notifier: notifier ?? BoxNotifier(),
    prefs: prefs,
    open: open ?? (_) {},
  );
}

/// Wrap [child] in the Box theme and, when [session] is given, a `BoxScope`
/// (with a controller over [modules]), so a single screen can be pumped:
///
/// ```dart
/// final session = await testSession(server: server);
/// session.attach(CrmStore(session));
/// await tester.pumpWidget(await boxTestApp(const DealsScreen(), session: session));
/// ```
Future<Widget> boxTestApp(
  Widget child, {
  BoxSession? session,
  List<BoxModule> modules = const [],
}) async {
  debugBoxUseGoogleFonts = false;
  final app = MaterialApp(
    theme: boxTheme(Brightness.light),
    darkTheme: boxTheme(Brightness.dark),
    home: child is Scaffold || child is BoxPage ? child : Scaffold(body: child),
  );
  if (session == null) return app;
  final controller = BoxAppController(
    prefs: await SharedPreferences.getInstance(),
    config: const BoxAppConfig(name: 'Test Box'),
    modules: modules,
  );
  return BoxScope(app: controller, session: session, child: app);
}
