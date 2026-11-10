// Every web module the app composes: core's own (signals) first, then the installed features.
// Read lazily (inside functions), like the generated list: a module-scope read joins the import
// cycle every view takes part in.
import type { WebFeature } from './feature.ts'
import { canAccessArea } from './lib/access.ts'
import { WEB_FEATURE_LIST, WEB_ROUTES } from './generated/features.ts'
import signals from './signals/index.tsx'

export const CORE_WEB_FEATURES = [signals] as const satisfies readonly WebFeature[]
export const ALL_WEB_FEATURES: readonly WebFeature[] = [...CORE_WEB_FEATURES, ...WEB_FEATURE_LIST]

/** The features whose area the signed-in principal reads (lib/access.ts): only these contribute
 *  nav, settings, top-bar controls, slots and onSession starters. A feature's id is its area. */
export function readableWebFeatures(): readonly WebFeature[] {
  return ALL_WEB_FEATURES.filter((f) => canAccessArea(f.id))
}
// Core's signals live in Settings and bring no routes of their own.
export const ALL_WEB_ROUTES = WEB_ROUTES
