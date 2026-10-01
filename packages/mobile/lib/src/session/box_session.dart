import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/box_api.dart';
import '../api/models.dart';
import '../module/box_link.dart';
import '../module/box_module.dart';
import '../notify/box_notifier.dart';
import 'box_changes.dart';
import 'box_directory.dart';

/// Everything that exists while somebody is signed in.
///
/// One session per sign-in: created when the server accepts the token, torn
/// down on sign-out. Modules receive it in `createState`, and any widget below
/// the shell reads it with `context.session`.
class BoxSession {
  BoxSession({
    required this.api,
    required this.principal,
    required this.notifier,
    required SharedPreferences prefs,
    required void Function(BoxLink link) open,
    BoxLink? Function(Map<String, Object?> data)? resolveNotification,
    this.agent,
    BoxDirectory? directory,
    BoxChanges? changes,
  }) : _prefs = prefs,
       _open = open,
       _resolveNotification = resolveNotification,
       directory = directory ?? BoxDirectory(api),
       changes = changes ?? BoxChanges(api);

  /// The authenticated client. Add module calls as extensions on [BoxApi].
  final BoxApi api;

  /// Who is signed in.
  final BoxPrincipal principal;

  /// The Box's agent, when the server reports one.
  final BoxAgentIdentity? agent;

  /// The people directory, loaded once per session.
  final BoxDirectory directory;

  /// The server's change feed: reload what you show when its scope changes.
  final BoxChanges changes;

  /// Local notifications (shown while the app runs).
  final BoxNotifier notifier;

  final SharedPreferences _prefs;
  final void Function(BoxLink link) _open;
  final BoxLink? Function(Map<String, Object?> data)? _resolveNotification;
  final Map<Type, BoxModuleState> _states = {};

  /// Open [link] (a `BoxLink` or a `module/path` string): selects the owning
  /// tab and pushes the page. Unknown links are logged and ignored.
  void open(Object link) {
    final l = link is BoxLink ? link : BoxLink.tryParse(link.toString());
    if (l == null) {
      debugPrint('box: ignoring empty link');
      return;
    }
    _open(l);
  }

  /// Open whatever a tapped push notification points at: every module's
  /// `linkForNotification` is asked in registration order. Returns false when
  /// no module claimed the payload.
  bool openNotification(Map<String, Object?> data) {
    final link = _resolveNotification?.call(data);
    if (link == null) return false;
    _open(link);
    return true;
  }

  /// Key-value storage namespaced to [module], persisted across launches and
  /// sessions. For small preferences, not for caches of server data.
  BoxStorage storage(String module) => BoxStorage(_prefs, 'box.m.$module.');

  /// The running state of type [T]. Throws when no registered module created
  /// one, which means the module is missing from `lib/generated/modules.dart`.
  T state<T extends BoxModuleState>() {
    final s = _states[T];
    if (s == null) {
      throw StateError(
        'No module state of type $T. Is its module registered in '
        'apps/mobile/lib/generated/modules.dart?',
      );
    }
    return s as T;
  }

  /// The running state of type [T], or null when that module is not
  /// registered. Use it for optional cross-module integration.
  T? maybeState<T extends BoxModuleState>() => _states[T] as T?;

  /// Every running module state, in registration order.
  Iterable<BoxModuleState> get states => _states.values;

  /// Registers a module's state. Called by the app controller only.
  void attach(BoxModuleState state) {
    final type = state.runtimeType;
    if (_states.containsKey(type)) {
      throw StateError('Two modules created a state of type $type');
    }
    _states[type] = state;
  }

  /// Drops every state. Called by the app controller only, after `stop`.
  void detachAll() => _states.clear();
}

/// Namespaced [SharedPreferences]. Obtain one with `session.storage(id)`.
class BoxStorage {
  BoxStorage(this._prefs, this._prefix);

  final SharedPreferences _prefs;
  final String _prefix;

  String? getString(String key) => _prefs.getString('$_prefix$key');
  Future<void> setString(String key, String value) =>
      _prefs.setString('$_prefix$key', value);

  bool? getBool(String key) => _prefs.getBool('$_prefix$key');
  Future<void> setBool(String key, bool value) =>
      _prefs.setBool('$_prefix$key', value);

  int? getInt(String key) => _prefs.getInt('$_prefix$key');
  Future<void> setInt(String key, int value) =>
      _prefs.setInt('$_prefix$key', value);

  List<String>? getStringList(String key) =>
      _prefs.getStringList('$_prefix$key');
  Future<void> setStringList(String key, List<String> value) =>
      _prefs.setStringList('$_prefix$key', value);

  Future<void> remove(String key) => _prefs.remove('$_prefix$key');
}
