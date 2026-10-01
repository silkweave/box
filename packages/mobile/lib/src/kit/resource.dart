import 'package:flutter/material.dart';

import '../api/box_api.dart';
import '../app/box_scope.dart';
import 'states.dart';

/// Server data with its loading and error state, as one listenable.
///
/// Keep one in a `BoxModuleState` for data several screens share, or let a
/// [BoxLoader] own one for a single screen.
///
/// ```dart
/// class CrmStore extends BoxModuleState {
///   CrmStore(super.session);
///   late final deals = BoxResource(() => session.api.deals());
///   @override
///   Future<void> start() => deals.load();
/// }
/// ```
class BoxResource<T> extends ChangeNotifier {
  BoxResource(this._fetch);

  final Future<T> Function() _fetch;

  T? _data;
  Object? _error;
  bool _loading = false;
  bool _disposed = false;
  int _generation = 0;

  T? get data => _data;
  Object? get error => _error;

  /// True while a request is in flight (including a refresh over old data).
  bool get loading => _loading;
  bool get hasData => _data != null;

  /// Fetch. Keeps the previous data visible while it runs, so a refresh never
  /// blanks the screen; a failure keeps it too and sets [error].
  Future<void> load() async {
    final generation = ++_generation;
    _loading = true;
    _notify();
    try {
      final value = await _fetch();
      if (generation != _generation) return;
      _data = value;
      _error = null;
    } catch (e) {
      if (generation != _generation) return;
      _error = e;
    } finally {
      if (generation == _generation) {
        _loading = false;
        _notify();
      }
    }
  }

  /// Alias of [load], reads better behind pull-to-refresh.
  Future<void> refresh() => load();

  /// Replace the data locally (an optimistic update, or a server answer from a
  /// mutation), without a request.
  void set(T value) {
    _data = value;
    _error = null;
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}

/// Renders a [BoxResource]: spinner on the first load, error with retry when
/// there is nothing to show, [empty] when [isEmpty] says so, else [builder].
class BoxResourceView<T> extends StatelessWidget {
  const BoxResourceView({
    super.key,
    required this.resource,
    required this.builder,
    this.isEmpty,
    this.empty,
    this.scrollableStates = false,
  });

  final BoxResource<T> resource;
  final Widget Function(BuildContext context, T data) builder;
  final bool Function(T data)? isEmpty;
  final Widget? empty;

  /// Wrap the loading, error and empty states in a scroll view, so a
  /// surrounding `RefreshIndicator` still works on them.
  final bool scrollableStates;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: resource,
    builder: (context, _) {
      final data = resource.data;
      if (data == null) {
        if (resource.error != null) {
          return _state(
            BoxErrorState(error: resource.error!, onRetry: resource.load),
          );
        }
        return _state(const BoxLoading());
      }
      if (empty != null && (isEmpty?.call(data) ?? false)) {
        return _state(empty!);
      }
      return builder(context, data);
    },
  );

  Widget _state(Widget child) {
    if (!scrollableStates) return child;
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight),
          child: child,
        ),
      ),
    );
  }
}

/// Load once, render, pull to refresh: the fastest way to put server data on
/// a screen.
///
/// ```dart
/// BoxPage(
///   title: 'Initiatives',
///   body: BoxLoader<List<Initiative>>(
///     load: (api) => api.initiatives(),
///     isEmpty: (items) => items.isEmpty,
///     empty: const BoxEmptyState(title: 'No initiatives yet'),
///     builder: (context, items) => ListView(children: [...]),
///   ),
/// )
/// ```
///
/// The [builder]'s result should be scrollable so pull-to-refresh works.
class BoxLoader<T> extends StatefulWidget {
  const BoxLoader({
    super.key,
    required this.load,
    required this.builder,
    this.isEmpty,
    this.empty,
    this.refreshable = true,
  });

  final Future<T> Function(BoxApi api) load;
  final Widget Function(BuildContext context, T data) builder;
  final bool Function(T data)? isEmpty;
  final Widget? empty;
  final bool refreshable;

  @override
  State<BoxLoader<T>> createState() => _BoxLoaderState<T>();
}

class _BoxLoaderState<T> extends State<BoxLoader<T>> {
  BoxResource<T>? _resource;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_resource == null) {
      final api = context.api;
      _resource = BoxResource<T>(() => widget.load(api))..load();
    }
  }

  @override
  void dispose() {
    _resource?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final r = _resource!;
    final view = BoxResourceView<T>(
      resource: r,
      isEmpty: widget.isEmpty,
      empty: widget.empty,
      builder: widget.builder,
      scrollableStates: widget.refreshable,
    );
    if (!widget.refreshable) return view;
    return RefreshIndicator(onRefresh: r.refresh, child: view);
  }
}
