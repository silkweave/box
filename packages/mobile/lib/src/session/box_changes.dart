import 'dart:async';

import 'package:flutter/foundation.dart';

import '../api/box_api.dart';

/// The Box's change feed (`changesFeed`), shared by every module of a session.
///
/// The server streams invalidation hints, never data: each event names a
/// scope (`table:initiatives`, `docs:initiatives`, `warehouse`, ...) and the
/// client reloads whatever it shows from that scope. This is the same feed the
/// web app's data stores reload from, so a change made on the web, by an agent
/// or by another phone reaches the app without a pull-to-refresh.
///
/// ```dart
/// late final _changes = session.changes.listen(
///   ['table:initiatives', 'table:tasks'],
///   () => unawaited(initiatives.refresh()),
/// );
/// // in dispose / stop:
/// _changes.cancel();
/// ```
///
/// One connection serves every listener. It opens with the first listener,
/// closes with the last, and reconnects after a drop. A `warehouse` event (an
/// external writer) matches every `table:` scope. After a reconnect the server
/// greets again with `hello`; events may have been missed in between, so every
/// listener fires once.
class BoxChanges {
  BoxChanges(
    this._api, {
    this.debounce = const Duration(milliseconds: 300),
    this.retryDelay = const Duration(seconds: 5),
  });

  final BoxApi _api;

  /// Events for one listener inside this window collapse into one call.
  final Duration debounce;

  /// Wait before reconnecting after a drop.
  final Duration retryDelay;

  final List<_Listener> _listeners = [];
  StreamSubscription<Map<String, dynamic>>? _sub;
  Timer? _retry;
  bool _sawHello = false;
  bool _closed = false;

  /// True while the feed is connected or connecting.
  bool get connected => _sub != null;

  /// Call [onChange] (debounced) whenever an event matches one of [scopes].
  BoxChangeListener listen(List<String> scopes, VoidCallback onChange) {
    final l = _Listener(this, List.unmodifiable(scopes), onChange);
    if (_closed) return l;
    _listeners.add(l);
    _connect();
    return l;
  }

  /// Reconnect now if the feed dropped (the app came back to the foreground).
  void resume() {
    if (_closed || _listeners.isEmpty || _sub != null) return;
    _retry?.cancel();
    _retry = null;
    _connect();
  }

  /// End the feed for good. Called when the session ends.
  void close() {
    _closed = true;
    for (final l in List.of(_listeners)) {
      l.cancel();
    }
    _disconnect();
  }

  @visibleForTesting
  static bool matches(String registered, String scope) =>
      registered == scope ||
      (scope == 'warehouse' && registered.startsWith('table:'));

  void _remove(_Listener l) {
    _listeners.remove(l);
    if (_listeners.isEmpty) _disconnect();
  }

  void _connect() {
    if (_closed || _sub != null || _retry != null) return;
    late final StreamSubscription<Map<String, dynamic>> sub;
    sub = _api
        .subscribe('changesFeed')
        .listen(
          _onEvent,
          onError: (Object e) => _dropped(sub, e),
          onDone: () => _dropped(sub, null),
          cancelOnError: true,
        );
    _sub = sub;
  }

  void _disconnect() {
    _retry?.cancel();
    _retry = null;
    unawaited(_sub?.cancel());
    _sub = null;
  }

  void _dropped(StreamSubscription<Map<String, dynamic>> sub, Object? error) {
    if (!identical(_sub, sub)) return;
    _sub = null;
    // A server without the feed (404) or a dead credential (401) will not
    // recover by retrying; the session's other calls surface the second one.
    if (error is BoxApiException && (error.isNotFound || error.isUnauthorized)) {
      debugPrint('box: change feed unavailable: $error');
      return;
    }
    if (_closed || _listeners.isEmpty) return;
    _retry = Timer(retryDelay, () {
      _retry = null;
      _connect();
    });
  }

  void _onEvent(Map<String, dynamic> event) {
    final scope = event['scope'];
    if (scope is! String || scope == 'ping') return;
    if (scope == 'hello') {
      if (_sawHello) {
        for (final l in List.of(_listeners)) {
          l._fire();
        }
      }
      _sawHello = true;
      return;
    }
    for (final l in List.of(_listeners)) {
      if (l.scopes.any((s) => matches(s, scope))) l._fire();
    }
  }
}

/// A registration on [BoxChanges]. Cancel it when its owner goes away.
abstract class BoxChangeListener {
  void cancel();
}

class _Listener implements BoxChangeListener {
  _Listener(this._feed, this.scopes, this._onChange);

  final BoxChanges _feed;
  final List<String> scopes;
  final VoidCallback _onChange;
  Timer? _timer;
  bool _cancelled = false;

  void _fire() {
    if (_cancelled) return;
    _timer?.cancel();
    _timer = Timer(_feed.debounce, () {
      _timer = null;
      if (!_cancelled) _onChange();
    });
  }

  @override
  void cancel() {
    if (_cancelled) return;
    _cancelled = true;
    _timer?.cancel();
    _timer = null;
    _feed._remove(this);
  }
}
