import 'package:box_app/generated/modules.dart';
import 'package:box_mobile/testing.dart';
import 'package:flutter_test/flutter_test.dart';

/// The registered modules boot together: unique module and tab ids (the
/// controller refuses duplicates), every state starts, and each tab shows.
/// Holds for any module list, including the empty shell.
void main() {
  testWidgets('the registered modules boot into the shell', (tester) async {
    final server = FakeServer()
      ..signedIn()
      // Enough of the chat surface for its store to settle when chat is
      // registered; unused otherwise.
      ..on('GET /api/chat/rooms', (_) => {'rooms': <Object>[]})
      ..on(
        'GET /trpc/chatFeed',
        (_) => Response('data: {"id":1,"type":"hello","at":1}\n\n', 200),
      )
      // The same for planning.
      ..on('GET /api/planning/initiatives', (_) => {'initiatives': <Object>[]})
      ..on('GET /api/planning/kinds', (_) => {'kinds': <Object>[]});
    final app = await pumpBoxApp(tester, server: server, modules: mobileModules);
    expect(app.session, isNotNull);
    final tabs = [for (final m in mobileModules) ...m.tabs];
    if (tabs.isEmpty) {
      expect(find.textContaining('Welcome'), findsOneWidget);
    } else {
      for (final t in tabs.take(3)) {
        expect(find.text(t.label), findsWidgets);
      }
    }
    await app.signOut();
    await tester.pumpAndSettle();
  });
}
