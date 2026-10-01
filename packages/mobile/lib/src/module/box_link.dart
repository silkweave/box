import 'package:flutter/foundation.dart';

/// An address inside the app: `<module>/<path...>[?query]`.
///
/// Links are how anything opens a screen it does not own: a notification tap,
/// one module pointing at another, a URL. The shell resolves the module by the
/// first segment and the page by the module's `BoxRoute`s.
///
/// ```dart
/// context.openLink('chat/room/general');
/// context.openLink(BoxLink('planning', ['initiative', id]));
/// ```
@immutable
class BoxLink {
  const BoxLink(
    this.module, [
    this.path = const [],
    this.query = const {},
    this.params = const {},
  ]);

  /// Parse `chat/room/general?focus=m1`. A leading `/` and a `box:` scheme are
  /// accepted and ignored. Returns null for an empty string.
  static BoxLink? tryParse(String raw) {
    var s = raw.trim();
    if (s.startsWith('box:')) s = s.substring(4);
    final uri = Uri.tryParse(s);
    if (uri == null) return null;
    final segments = uri.pathSegments.where((p) => p.isNotEmpty).toList();
    if (segments.isEmpty) return null;
    return BoxLink(segments.first, segments.sublist(1), uri.queryParameters);
  }

  /// Like [tryParse], throwing on an empty link.
  factory BoxLink.parse(String raw) =>
      tryParse(raw) ?? (throw FormatException('Not a link: "$raw"'));

  /// The owning module id.
  final String module;

  /// The segments after the module id.
  final List<String> path;
  final Map<String, String> query;

  /// Parameters captured by the matched `BoxRoute` (filled by the router).
  final Map<String, String> params;

  /// A captured route parameter; throws when the route did not capture it,
  /// which is a programming error in the route pattern.
  String param(String name) =>
      params[name] ??
      (throw ArgumentError('Route for $this captured no "$name"'));

  BoxLink withParams(Map<String, String> captured) =>
      BoxLink(module, path, query, captured);

  @override
  String toString() {
    final p = [module, ...path].map(Uri.encodeComponent).join('/');
    return query.isEmpty ? p : '$p?${Uri(queryParameters: query).query}';
  }

  @override
  bool operator ==(Object other) =>
      other is BoxLink && other.toString() == toString();

  @override
  int get hashCode => toString().hashCode;
}
