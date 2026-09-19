// The server feature contract. Features live in features/<id>/server/.
// Register their entry modules in src/generated/features.ts, maintained alongside the source.
// See docs/core/SEAM.md for the runtime contracts and dependency direction.

import type { Type } from '@nestjs/common'

export interface ServerFeature {
  id: string
  /** The Nest module. Imported into AppModule verbatim - controllers, providers, lifecycle. */
  module: Type<unknown>
}

export function defineServerFeature<const T extends ServerFeature>(feature: T): T {
  return feature
}
