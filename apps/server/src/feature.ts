// The server feature contract. Features live in features/<id>/server/.
// Register their entry modules in src/generated/features.ts, maintained alongside the source.
// See docs/core/SEAM.md for the runtime contracts and dependency direction.

import type { Type } from '@nestjs/common'
import type { McpAuthExtension } from '@silkweave/box-core'

export interface ServerFeature {
  id: string
  /** The Nest module. Imported into AppModule verbatim - controllers, providers, lifecycle. */
  module: Type<unknown>
  /**
   * Top-level page paths this feature serves besides its id (`/goals` for planning), so request
   * diagnostics may name them. The id itself always counts.
   */
  routeRoots?: readonly string[]
  /**
   * OAuth sign-in for people's own MCP clients on `/mcp` (core mcp-auth.ts). At most one feature
   * supplies it; read once while the app module builds the `/mcp` adapter.
   */
  mcpAuth?: () => McpAuthExtension
}

export function defineServerFeature<const T extends ServerFeature>(feature: T): T {
  return feature
}
