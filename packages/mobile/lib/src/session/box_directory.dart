import 'package:flutter/foundation.dart';

import '../api/box_api.dart';
import '../api/models.dart';

/// The Box's people directory (`/api/users/list`), loaded once per session and
/// shared by every module, so a person has one name and one avatar
/// everywhere.
class BoxDirectory extends ChangeNotifier {
  BoxDirectory(this._api);

  final BoxApi _api;

  Map<String, BoxUser> _users = const {};
  bool _loaded = false;
  Future<void>? _loading;

  /// Every known user by id. Empty until the first [load] completes.
  Map<String, BoxUser> get users => _users;

  bool get loaded => _loaded;

  BoxUser? operator [](String id) => _users[id];

  /// Full name for [id], falling back to the id itself.
  String display(String id) => _users[id]?.display ?? id;

  /// Conversational name (nickname, first name, id).
  String shortLabel(String id) => _users[id]?.shortLabel ?? id;

  /// Load the directory. Concurrent calls share one request; later calls
  /// refetch.
  Future<void> load() => _loading ??= _fetch().whenComplete(() {
    _loading = null;
  });

  Future<void> _fetch() async {
    final j = await _api.getJson('/api/users/list');
    final list = listOf(j['users'] ?? j['items'], BoxUser.fromJson);
    _users = {for (final u in list) u.id: u};
    _loaded = true;
    notifyListeners();
  }

  /// Test seam: replace the directory without a request.
  @visibleForTesting
  void seed(Iterable<BoxUser> users) {
    _users = {for (final u in users) u.id: u};
    _loaded = true;
    notifyListeners();
  }
}
