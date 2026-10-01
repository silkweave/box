import 'package:box_mobile/box_mobile.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_test/flutter_test.dart';

/// Records `show` calls and answers the calls `init` makes.
class _FakePlugin implements FlutterLocalNotificationsPlugin {
  int shown = 0;

  @override
  dynamic noSuchMethod(Invocation invocation) => switch (invocation.memberName) {
    #initialize => Future<bool?>.value(true),
    #getNotificationAppLaunchDetails => Future<NotificationAppLaunchDetails?>.value(),
    #show => Future<void>(() => shown++),
    _ => null,
  };
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('shows while the app is on screen', () async {
    final plugin = _FakePlugin();
    final notifier = BoxNotifier(plugin: plugin, isForeground: () => true);
    await notifier.init(const []);
    await notifier.show(title: 'hello');
    expect(plugin.shown, 1);
  });

  test('stays silent in the background, where remote push covers it', () async {
    final plugin = _FakePlugin();
    final notifier = BoxNotifier(plugin: plugin, isForeground: () => false);
    await notifier.init(const []);
    await notifier.show(title: 'hello');
    expect(plugin.shown, 0);
  });
}
