import 'package:flutter/widgets.dart';

/// The Box's identity in the app: name, wordmark, accent and logo.
///
/// Lives in `apps/mobile/lib/app_config.dart`, owned by the Box. Copy the
/// values from `box.json` `brand` so the phone and the web agree.
@immutable
class BoxAppConfig {
  const BoxAppConfig({
    required this.name,
    this.wordmark,
    this.suffix,
    this.accent,
    this.logoAsset,
    this.serverUrl = '',
    this.unreachableHint,
  });

  /// Display name (`brand.name`), used in titles and copy.
  final String name;

  /// Wordmark and its muted suffix (`brand.wordmark`, `brand.suffix`). When
  /// null, [name] is shown instead.
  final String? wordmark;
  final String? suffix;

  /// `brand.themeColor`. Null keeps the Box indigo.
  final Color? accent;

  /// A square logo in the APP's assets (e.g. `assets/brand-logo.png`). Null
  /// shows a tinted initial.
  final String? logoAsset;

  /// The Box's address, fixed for this build: the app always talks to it and
  /// the sign-in screen asks only for the access token. Empty lets the person
  /// enter the address. A build's `--dart-define=BOX_SERVER_URL=...` takes its
  /// place; `scripts/build.sh` sets that from the Box's `server.dashboardUrl`.
  final String serverUrl;

  /// One sentence added to the "can't reach the server" screen, for a Box that
  /// is only reachable over a VPN: "Check that Tailscale is connected."
  final String? unreachableHint;
}
