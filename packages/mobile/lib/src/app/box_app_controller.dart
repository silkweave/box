import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../api/box_api.dart';
import '../api/models.dart';
import '../module/box_link.dart';
import '../module/box_module.dart';
import '../notify/box_notifier.dart';
import '../session/box_session.dart';
import 'box_app_config.dart';

/// Where the app is between launch and a usable session.
enum BoxPhase {
  /// Checking the stored credential.
  booting,

  /// No address yet, no token, or the token was refused.
  signedOut,

  /// The server could not be reached (offline, VPN down, wrong address).
  unreachable,

  /// The server answered but boot threw something unexpected, almost always a
  /// response shape this build is too old to read.
  failed,

  /// Signed in; [BoxAppController.session] is set.
  ready,
}

/// Owns the app's lifecycle: credential, boot phases, the signed-in
/// [BoxSession], and module state. The shell renders from it; modules never
/// talk to it directly.
class BoxAppController extends ChangeNotifier {
  BoxAppController({
    required SharedPreferences prefs,
    required this.config,
    required List<BoxModule> modules,
    BoxNotifier? notifier,
    http.Client? httpClient,
    String? seedToken,
  }) : _prefs = prefs,
       modules = List.unmodifiable(modules),
       notifier = notifier ?? BoxNotifier(),
       api = BoxApi(
         baseUrl: config.serverUrl.isNotEmpty
             ? config.serverUrl
             : prefs.getString(_serverKey) ?? '',
         client: httpClient,
       ) {
    _checkModules();
    api.token =
        prefs.getString(_tokenKey) ??
        (seedToken == null || seedToken.isEmpty ? null : seedToken);
    this.notifier.onOpen = open;
  }

  static const _serverKey = 'box.server';
  static const _tokenKey = 'box.token';

  final SharedPreferences _prefs;
  final BoxAppConfig config;
  final List<BoxModule> modules;
  final BoxNotifier notifier;
  final BoxApi api;

  BoxPhase phase = BoxPhase.booting;
  BoxSession? session;
  Object? lastError;

  /// A link waiting for the shell (a notification tapped before sign-in or
  /// before the first frame). The shell consumes it.
  final ValueNotifier<BoxLink?> pendingLink = ValueNotifier(null);

  String get serverUrl => api.baseUrl;

  /// The build fixes the server ([BoxAppConfig.serverUrl]): sign-in asks only
  /// for the token and the address never changes.
  bool get fixedServer => config.serverUrl.isNotEmpty;

  void _checkModules() {
    final ids = <String>{};
    final tabs = <String>{};
    for (final m in modules) {
      if (!ids.add(m.id)) throw StateError('Module "${m.id}" registered twice');
      for (final t in m.tabs) {
        if (!tabs.add(t.id)) throw StateError('Tab "${t.id}" defined twice');
      }
    }
  }

  /// Every module's notification channels, for [BoxNotifier.init].
  Iterable<BoxNotificationChannel> get notificationChannels =>
      modules.expand((m) => m.notificationChannels);

  /// Validate the stored credential and start a session.
  Future<void> boot() async {
    if (api.baseUrl.isEmpty || api.token == null) {
      _setPhase(BoxPhase.signedOut);
      return;
    }
    _setPhase(BoxPhase.booting);
    try {
      final me = BoxMe.fromJson(await api.getJson('/api/auth/me'));
      if (me.principal == null) {
        _setPhase(BoxPhase.signedOut);
      } else {
        await _startSession(me);
      }
    } on BoxUnreachableException catch (e) {
      lastError = e;
      _setPhase(BoxPhase.unreachable);
    } on BoxApiException catch (e) {
      // A 401 with a stale token still proves the server is reachable.
      lastError = e;
      _setPhase(BoxPhase.signedOut);
    } catch (e) {
      // Anything else is almost always a RESPONSE SHAPE this build is too old
      // to parse. Never narrow this arm to a known list: without it an
      // unexpected throw leaves the app on the boot spinner forever.
      lastError = e;
      _setPhase(BoxPhase.failed);
    }
  }

  /// Sign in with [token] against [serverUrl], which is ignored when the
  /// build fixes the server. Returns an error message for the form, or null
  /// on success.
  Future<String?> signIn({String serverUrl = '', required String token}) async {
    final url = fixedServer ? api.baseUrl : BoxApi.normalizeBaseUrl(serverUrl);
    if (url.isEmpty) return 'Enter the server address';
    if (token.trim().isEmpty) return 'Paste your access token';
    final previousUrl = api.baseUrl;
    api.baseUrl = url;
    api.token = token.trim();
    try {
      final me = BoxMe.fromJson(await api.getJson('/api/auth/me'));
      if (me.principal == null) {
        api.token = null;
        return 'Token not accepted';
      }
      await _prefs.setString(_serverKey, api.baseUrl);
      await _prefs.setString(_tokenKey, api.token!);
      await _startSession(me);
      return null;
    } on BoxUnreachableException {
      api.token = null;
      api.baseUrl = previousUrl.isEmpty ? url : previousUrl;
      return 'Could not reach $url';
    } on BoxApiException catch (e) {
      api.token = null;
      return e.isUnauthorized
          ? 'Token not accepted'
          : 'Sign-in failed (${e.status})';
    } catch (e) {
      api.token = null;
      lastError = e;
      return 'Unexpected response from the server - this app may be older than the server';
    }
  }

  /// End the session: modules stop (while the credential still works), then
  /// the credential is dropped.
  Future<void> signOut() async {
    await _endSession();
    await _prefs.remove(_tokenKey);
    api.token = null;
    _setPhase(BoxPhase.signedOut);
  }

  /// The app came back to the foreground.
  void resume() {
    final s = session;
    if (phase == BoxPhase.ready && s != null) {
      s.changes.resume();
      for (final state in s.states) {
        unawaited(_guard('resume', state.resume));
      }
    } else if (phase != BoxPhase.booting) {
      unawaited(boot());
    }
  }

  /// Open [link] now if signed in, else once a session exists.
  void open(BoxLink link) => pendingLink.value = link;

  /// Ask modules which link a push payload points at.
  BoxLink? linkForNotification(Map<String, Object?> data) {
    for (final m in modules) {
      final link = m.linkForNotification?.call(data);
      if (link != null) return link;
    }
    return null;
  }

  Future<void> _startSession(BoxMe me) async {
    await _endSession();
    final s = BoxSession(
      api: api,
      principal: me.principal!,
      agent: me.agent,
      notifier: notifier,
      prefs: _prefs,
      open: open,
      resolveNotification: linkForNotification,
    );
    for (final m in modules) {
      final create = m.createState;
      if (create != null) s.attach(create(s));
    }
    session = s;
    lastError = null;
    _setPhase(BoxPhase.ready);
    unawaited(_guard('directory', s.directory.load));
    for (final state in s.states) {
      unawaited(_guard('start', state.start));
    }
  }

  Future<void> _endSession() async {
    final s = session;
    if (s == null) return;
    session = null;
    for (final state in s.states) {
      await _guard('stop', state.stop);
    }
    for (final state in s.states) {
      state.dispose();
    }
    s.changes.close();
    s.detachAll();
  }

  Future<void> _guard(String what, Future<void> Function() run) async {
    try {
      await run();
    } catch (e, st) {
      debugPrint('box: module $what failed: $e\n$st');
    }
  }

  void _setPhase(BoxPhase p) {
    phase = p;
    notifyListeners();
  }
}
