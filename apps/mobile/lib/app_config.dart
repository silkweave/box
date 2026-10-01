// This Box's identity in the app. Owned by the Box: copy the values from the
// root box.json `brand` block so the phone and the web agree. The native app
// name and bundle id are separate (docs/MOBILE.md, "Identity").
import 'package:box_mobile/box_mobile.dart';

const appConfig = BoxAppConfig(
  name: 'Silkweave Box', // brand.name
  wordmark: 'silkweave', // brand.wordmark
  suffix: 'box', // brand.suffix
  accent: null, // brand.themeColor as Color(0xFF......); null keeps the Box indigo
  logoAsset: 'assets/brand-logo.png',
  // The Box's address, fixed for every build: sign-in then asks only for the
  // token. Leave empty to ask for it; scripts/build.sh compiles in the Box's
  // server.dashboardUrl instead, so this rarely needs a value.
  serverUrl: '',
  // Add a sentence when the Box is only reachable over a VPN, e.g.
  // 'Check that Tailscale is connected.'
  unreachableHint: null,
);
