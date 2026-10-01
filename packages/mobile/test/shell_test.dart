import 'package:box_mobile/box_mobile.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:box_mobile/testing.dart';

class CounterState extends BoxModuleState {
  CounterState(super.session);
  final count = ValueNotifier(3);
  int started = 0;
  int stopped = 0;

  @override
  Future<void> start() async => started++;

  @override
  Future<void> stop() async => stopped++;
}

BoxModule _module(String id, {int order = 10, bool withState = false}) => BoxModule(
  id: id,
  title: id.toUpperCase(),
  createState: withState ? CounterState.new : null,
  tabs: [
    BoxTab(
      id: id,
      label: 'Tab $id',
      icon: LucideIcons.star,
      order: order,
      badge: withState ? (s) => s.state<CounterState>().count : null,
      builder: (context) => BoxPage(
        title: 'Root $id',
        children: [Text('root of $id')],
      ),
    ),
  ],
  routes: [
    BoxRoute('item/:id', (context, link) => BoxPage(
      title: 'Item ${link.param('id')}',
      children: const [],
    )),
  ],
  linkForNotification: (data) =>
      data['kind'] == id ? BoxLink(id, ['item', '${data['id']}']) : null,
);

void main() {
  testWidgets('no token shows sign-in; signing in reaches the empty shell', (tester) async {
    final server = FakeServer()..signedIn();
    final app = await pumpBoxApp(tester, server: server, token: null);
    expect(app.phase, BoxPhase.signedOut);
    expect(find.text('Sign in'), findsOneWidget);

    await tester.enterText(find.byKey(const ValueKey('signin-token')), 'tok');
    await tester.tap(find.byKey(const ValueKey('signin-submit')));
    await tester.pumpAndSettle();
    expect(app.phase, BoxPhase.ready);
    expect(find.text('Welcome, Ada Lovelace'), findsOneWidget);
  });

  testWidgets('without a fixed server, sign-in asks for the address', (tester) async {
    await pumpBoxApp(tester, server: FakeServer(), token: null);
    expect(find.byKey(const ValueKey('signin-server')), findsOneWidget);
  });

  testWidgets('a fixed server hides the address and wins over a stored one', (tester) async {
    final server = FakeServer()..signedIn();
    final app = await pumpBoxApp(
      tester,
      server: server,
      token: null,
      config: const BoxAppConfig(name: 'Test Box', serverUrl: 'https://fixed.test/'),
    );
    expect(find.byKey(const ValueKey('signin-server')), findsNothing);
    expect(app.serverUrl, 'https://fixed.test');

    await tester.enterText(find.byKey(const ValueKey('signin-token')), 'tok');
    await tester.tap(find.byKey(const ValueKey('signin-submit')));
    await tester.pumpAndSettle();
    expect(app.phase, BoxPhase.ready);
    expect(app.serverUrl, 'https://fixed.test');
  });

  testWidgets('a refused token lands on sign-in', (tester) async {
    final server = FakeServer()
      ..on('GET /api/auth/me', (_) => http.Response('{"message":"no"}', 401));
    final app = await pumpBoxApp(tester, server: server);
    expect(app.phase, BoxPhase.signedOut);
  });

  testWidgets('a dead server is the unreachable phase', (tester) async {
    final dead = FakeServer()
      ..on('GET /api/auth/me', (_) => throw http.ClientException('refused'));
    final app = await pumpBoxApp(tester, server: dead);
    expect(app.phase, BoxPhase.unreachable);
    expect(find.textContaining('reach'), findsWidgets);
  });

  testWidgets('an unreadable response is the failed phase, not a spinner', (tester) async {
    final server = FakeServer()..on('GET /api/auth/me', (_) => {'principal': {'display': 42}});
    final app = await pumpBoxApp(tester, server: server);
    expect(app.phase, BoxPhase.failed);
    expect(find.text('Something went wrong starting up'), findsOneWidget);
  });

  testWidgets('module tabs sort by order, Settings last, badges and state run', (tester) async {
    final server = FakeServer()..signedIn();
    final app = await pumpBoxApp(tester, server: server, modules: [
      _module('b', order: 20),
      _module('a', order: 10, withState: true),
    ]);
    final bar = tester.widget<GlassTabBar>(find.byType(GlassTabBar));
    expect(bar.tabs.map((t) => t.label), ['Tab a', 'Tab b', 'Settings']);
    expect(find.text('root of a'), findsOneWidget);
    expect(find.text('3'), findsWidgets); // the badge (the glass bar paints icons twice)

    final state = app.session!.state<CounterState>();
    expect(state.started, 1);
    await app.signOut();
    await tester.pumpAndSettle();
    expect(state.stopped, 1);
    expect(state.disposed, isTrue);
    expect(find.text('Sign in'), findsOneWidget);
  });

  testWidgets('links select the owning tab and push the route', (tester) async {
    final server = FakeServer()..signedIn();
    final app = await pumpBoxApp(tester, server: server, modules: [
      _module('a', order: 10),
      _module('b', order: 20),
    ]);
    app.open(BoxLink.parse('b/item/42'));
    await tester.pumpAndSettle();
    expect(find.text('Item 42'), findsOneWidget);

    final link = app.linkForNotification({'kind': 'a', 'id': 7});
    expect(link.toString(), 'a/item/7');
  });

  testWidgets('signing out drops pages pushed during the session', (tester) async {
    final server = FakeServer()..signedIn();
    final app = await pumpBoxApp(tester, server: server, modules: [
      BoxModule(
        id: 'a',
        title: 'A',
        createState: CounterState.new,
        tabs: [
          BoxTab(id: 'a', label: 'A', icon: LucideIcons.star, builder: (_) => const Text('root')),
        ],
        routes: [
          // Reads session state in build, like any real module page.
          BoxRoute('item/:id', (context, link) =>
              Text('item ${context.state<CounterState>().count.value}')),
        ],
      ),
    ]);
    app.open(BoxLink.parse('a/item/1'));
    await tester.pumpAndSettle();
    expect(find.text('item 3'), findsOneWidget);
    await app.signOut();
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Sign in'), findsOneWidget);
  });

  testWidgets('more than four tabs collapse into More', (tester) async {
    final server = FakeServer()..signedIn();
    await pumpBoxApp(tester, server: server, modules: [
      for (var i = 0; i < 5; i++) _module('m$i', order: i),
    ]);
    expect(find.text('More'), findsWidgets);
    expect(find.text('Tab m4'), findsNothing);
    await tester.tap(find.text('More').last);
    await tester.pumpAndSettle();
    expect(find.text('Tab m3'), findsOneWidget);
    expect(find.text('Tab m4'), findsOneWidget);
  });

  test('duplicate module ids are refused', () async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    expect(
      () => BoxAppController(
        prefs: prefs,
        config: const BoxAppConfig(name: 'x'),
        modules: [_module('a'), _module('a')],
      ),
      throwsStateError,
    );
  });
}

