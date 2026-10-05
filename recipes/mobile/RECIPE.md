# Mobile app

A native iOS and Android app for the team, branded as the Box's own: sign in with an access token and use the Box from a phone. It starts as a shell with sign-in, Settings and a welcome page, and grows a tab for each recipe whose mobile module the Box adds.

## Highlights

- Flutter app for iOS and Android with the Box's own name, bundle id, icons and server address
- Sign-in with a personal access token, the same bearer that MCP clients use
- Flat tab navigation and link routing, so notification taps and cross-screen jumps open the right page
- Live data from the Box's change feed, with a boot that always ends in a visible state
- Simulator and device builds from the checkout, with release builds that compile in the Box's address

## Code ships with core

The framework (`packages/mobile`) and the app (`apps/mobile`) are managed core paths: every Box carries
them, and this recipe has no `features/mobile/`. Adapting it makes that shipped app the Box's own and
proves it runs. Feature screens arrive as each recipe's `mobile` powerup, which requires this recipe.
See [docs/MOBILE.md](../../docs/MOBILE.md).
