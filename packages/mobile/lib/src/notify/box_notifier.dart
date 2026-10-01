import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../module/box_link.dart';
import '../module/box_module.dart';

/// Local notifications: what the app shows by itself while it is running, for
/// example a chat message arriving on the live feed while you are on another
/// screen. Tapping one opens its link.
///
/// Remote push (the phone woken by the server while the app is closed) is not
/// here. It needs Firebase and the Box's notifications feature, and is the
/// `notifications` module's job; see features/notifications/mobile.
class BoxNotifier {
  BoxNotifier({
    FlutterLocalNotificationsPlugin? plugin,
    bool Function()? isForeground,
  }) : _plugin = plugin ?? FlutterLocalNotificationsPlugin(),
       isForeground = isForeground ?? _appInForeground;

  final FlutterLocalNotificationsPlugin _plugin;

  /// Whether the app is on screen; [show] is silent otherwise.
  final bool Function() isForeground;

  static bool _appInForeground() {
    final state = WidgetsBinding.instance.lifecycleState;
    return state == null || state == AppLifecycleState.resumed;
  }

  /// The Android small icon: a white silhouette on transparency (Android
  /// masks it to one colour, so a full-colour launcher icon shows as a blank
  /// square). `android/app/src/main/res/drawable*/ic_notification.png`.
  static const androidIcon = '@drawable/ic_notification';
  bool _ready = false;
  final Map<String, BoxNotificationChannel> _channels = {};

  /// The default channel for modules that declare none.
  static const defaultChannel = BoxNotificationChannel(
    id: 'box_default',
    name: 'General',
  );

  /// Receives the link of a tapped notification. The app controller sets it.
  void Function(BoxLink link)? onOpen;

  /// Initialise the plugin and create every module's Android channels. Called
  /// once by the app at startup. The permission prompt is only shown when some
  /// module declares a channel, so an empty shell never asks. Never throws: a
  /// device without notification support simply shows nothing.
  Future<void> init(Iterable<BoxNotificationChannel> channels) async {
    final ask = channels.isNotEmpty;
    try {
      final ios = DarwinInitializationSettings(
        requestAlertPermission: ask,
        requestBadgePermission: ask,
        requestSoundPermission: ask,
      );
      const android = AndroidInitializationSettings(androidIcon);
      await _plugin.initialize(
        InitializationSettings(iOS: ios, android: android),
        onDidReceiveNotificationResponse: (r) {
          final link = r.payload == null ? null : BoxLink.tryParse(r.payload!);
          if (link != null) onOpen?.call(link);
        },
      );
      final launch = await _plugin.getNotificationAppLaunchDetails();
      final payload = launch?.notificationResponse?.payload;
      if (launch?.didNotificationLaunchApp == true && payload != null) {
        final link = BoxLink.tryParse(payload);
        if (link != null) onOpen?.call(link);
      }
      for (final c in [defaultChannel, ...channels]) {
        _channels[c.id] = c;
      }
      if (!kIsWeb && Platform.isAndroid) {
        final android = _plugin
            .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin
            >();
        for (final c in _channels.values) {
          await android?.createNotificationChannel(
            AndroidNotificationChannel(
              c.id,
              c.name,
              description: c.description,
              importance: c.important ? Importance.high : Importance.defaultImportance,
            ),
          );
        }
        if (ask) await android?.requestNotificationsPermission();
      }
      _ready = true;
    } catch (e) {
      debugPrint('box: local notifications unavailable ($e)');
    }
  }

  /// Show a notification now. [link] opens when it is tapped; [id] replaces an
  /// earlier notification with the same id (defaults to a fresh one).
  ///
  /// Does nothing while the app is in the background. Android keeps a
  /// backgrounded app's live feeds running, and remote push already alerts
  /// the person there, so showing a local one too would notify twice.
  Future<void> show({
    required String title,
    String? body,
    Object? link,
    String? channel,
    int? id,
  }) async {
    if (!_ready || !isForeground()) return;
    final c = _channels[channel] ?? defaultChannel;
    await _plugin.show(
      id ?? DateTime.now().microsecondsSinceEpoch & 0x7fffffff,
      title,
      body,
      NotificationDetails(
        iOS: const DarwinNotificationDetails(),
        android: AndroidNotificationDetails(
          c.id,
          c.name,
          icon: androidIcon,
          importance: c.important ? Importance.high : Importance.defaultImportance,
          priority: c.important ? Priority.high : Priority.defaultPriority,
        ),
      ),
      payload: link?.toString(),
    );
  }
}
