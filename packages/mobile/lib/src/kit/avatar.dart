import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../theme/theme.dart';

/// A user avatar: the profile image when the directory has one, else a
/// deterministic initials chip - tint hashed from the user id over the web
/// app's palette order (accent/success/info/warning/danger/muted).
///
/// The directory stores `users.image` in TWO shapes and both are live in real
/// data, so neither may be treated as the special case:
///   * an ordinary `https://...` URL, and
///   * a `data:image/webp;base64,...` URI, written by the web app's own
///     downscale-and-square-crop step (`apps/web/src/lib/image.ts`).
/// `Image.network` cannot render the second one, which is why this widget
/// resolves the provider itself instead of handing the string to one loader.
class BoxAvatar extends StatelessWidget {
  const BoxAvatar({
    super.key,
    required this.id,
    this.name,
    this.imageUrl,
    this.size = 32,
  });

  /// An avatar for a directory entry.
  BoxAvatar.user(BoxUser user, {Key? key, double size = 32})
    : this(
        key: key,
        id: user.id,
        name: user.display,
        imageUrl: user.avatarUrl,
        size: size,
      );

  final String id;
  final String? name;

  /// `users.image` from the directory. Null, an http(s) URL, or a data URI.
  final String? imageUrl;

  final double size;

  /// Decoded data-URI bytes, memoised by the URI string.
  ///
  /// These URIs run to ~14KB of base64 each and a busy room rebuilds a sender's
  /// avatar on every frame of a scroll, so decoding in `build` would re-run
  /// base64 over the whole directory continuously. The map is bounded by the
  /// number of people who have an image, so it never needs eviction.
  static final Map<String, Uint8List?> _dataUriCache = {};

  static Uint8List? _decodeDataUri(
    String uri,
  ) => _dataUriCache.putIfAbsent(uri, () {
    final comma = uri.indexOf(',');
    // Only base64 payloads are produced by the web app; a percent-encoded data
    // URI would need a different decode, so treat it as "no image" and fall
    // back to initials rather than rendering a broken box.
    if (comma < 0 || !uri.substring(0, comma).contains(';base64')) return null;
    try {
      return base64Decode(uri.substring(comma + 1));
    } catch (_) {
      return null;
    }
  });

  ImageProvider? _provider() {
    final u = imageUrl?.trim();
    if (u == null || u.isEmpty) return null;
    if (u.startsWith('data:')) {
      final bytes = _decodeDataUri(u);
      return bytes == null ? null : MemoryImage(bytes);
    }
    if (u.startsWith('http://') || u.startsWith('https://')) {
      return NetworkImage(u);
    }
    // Anything else (a bare path, say) is not a shape the directory produces
    // today. Falling back is honest; guessing a base URL would not be.
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final chip = _initialsChip(context);
    final provider = _provider();
    if (provider == null) return chip;
    return ClipOval(
      child: SizedBox(
        width: size,
        height: size,
        child: Image(
          image: provider,
          width: size,
          height: size,
          fit: BoxFit.cover,
          // The initials carry every failure mode: a dead CDN, an offline
          // handset, a corrupt data URI. An avatar is chrome, so it must never
          // be able to leave a hole in a message row.
          errorBuilder: (_, _, _) => chip,
          // ...and they stand in while the image decodes, so a scroll shows a
          // tinted chip resolving into a face rather than a blank gap.
          frameBuilder: (_, child, frame, wasSynchronouslyLoaded) =>
              frame == null && !wasSynchronouslyLoaded ? chip : child,
        ),
      ),
    );
  }

  Widget _initialsChip(BuildContext context) {
    final c = context.colors;
    final tints = [
      (c.accent, c.accent.withValues(alpha: 0.15)),
      (c.success, c.success.withValues(alpha: 0.15)),
      (c.info, c.info.withValues(alpha: 0.15)),
      (c.warning, c.warning.withValues(alpha: 0.20)),
      (c.danger, c.danger.withValues(alpha: 0.15)),
      (c.fg3, c.surfaceHover),
    ];
    var hash = 0;
    for (final u in id.codeUnits) {
      hash = (hash * 31 + u) & 0x7fffffff;
    }
    final (fg, bg) = tints[hash % tints.length];
    final label = _initials(name ?? id);
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
      child: Text(
        label,
        style: TextStyle(
          color: fg,
          fontSize: size * 0.38,
          fontWeight: FontWeight.w600,
          height: 1,
        ),
      ),
    );
  }

  static String _initials(String from) {
    final parts = from
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
        .toUpperCase();
  }
}
